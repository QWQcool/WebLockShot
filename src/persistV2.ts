import type { ProductInput } from './domain/product.ts'
import type { Script } from './domain/script.ts'
import type { VisualPlan } from './domain/sellVisual.ts'
import type { ShotJob } from './domain/shotJob.ts'
import { readGenerateSession } from './persist.ts'
import type { Story } from './types.ts'
import {
  IDB_REF_PREFIX,
  deleteAsset,
  getAssetObjectUrl,
  idbRefToId,
  isIdbRef,
  putDataUrlAsset,
} from './persist/assetStore.ts'

export const PIPELINE_SESSION_V2_KEY = 'weblockshot.pipeline.v2' as const

export type PipelineSessionV2 = {
  version: 2
  id: string
  activeStep: number
  productInput?: ProductInput
  selectedTemplateId?: string
  script?: Script
  story?: Story
  visualPlans?: VisualPlan[]
  jobs?: ShotJob[]
  updatedAt: number
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // 禁用或受限环境
  }
  return null
}

/** dataURL 内容地址 id（去重：同内容同 id，便于 IndexedDB 复用与后续清理） */
function dataUrlAssetId(dataUrl: string): string {
  let hash = 0
  for (let i = 0; i < dataUrl.length; i++) {
    hash = (hash << 5) - hash + dataUrl.charCodeAt(i)
    hash |= 0
  }
  const size = dataUrl.length
  return `img_${Math.abs(hash).toString(36)}_${size}`
}

/** 仅对 dataURL 形态的大资产外移；http/相对路径/blob: 不动 */
function isHeavyDataUrl(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith('data:') && value.length > 4096
}

export type ExtractedAsset = { id: string; dataUrl: string }

export type ExtractionResult = {
  /** 持久化到 localStorage 的瘦身副本（大资产替换为 idbref:// 索引） */
  sanitized: PipelineSessionV2
  /** 需要写入 IndexedDB 的资产列表 */
  assets: ExtractedAsset[]
}

/**
 * 纯函数：抽取会话中所有 base64 dataURL 大资产（商品图/视频预览/分镜参考图），
 * 替换为 idbref:// 索引，localStorage 只存轻量索引。
 * blob: URL 刷新后必死，直接置空避免死链持久化。
 */
export function extractHeavyAssets(session: PipelineSessionV2): ExtractionResult {
  const assets: ExtractedAsset[] = []
  const idByUrl = new Map<string, string>()

  const refFor = (dataUrl: string): string => {
    let id = idByUrl.get(dataUrl)
    if (!id) {
      id = dataUrlAssetId(dataUrl)
      idByUrl.set(dataUrl, id)
      assets.push({ id, dataUrl })
    }
    return `${IDB_REF_PREFIX}${id}`
  }

  const sanitizeMedia = (value: string | undefined): string | undefined => {
    if (value !== undefined && isHeavyDataUrl(value)) return refFor(value)
    if (value !== undefined && value.startsWith('blob:')) return undefined // blob: 刷新即失效，不留死链
    return value
  }

  const sanitized: PipelineSessionV2 = { ...session }

  if (session.productInput) {
    const productInput: ProductInput = {
      ...session.productInput,
      imagePreview: sanitizeMedia(session.productInput.imagePreview),
      videoPreview: sanitizeMedia(session.productInput.videoPreview),
    }
    sanitized.productInput = productInput
  }

  if (session.visualPlans?.length) {
    sanitized.visualPlans = session.visualPlans.map((plan): VisualPlan => {
      const ref = plan.referenceImage ? sanitizeMedia(plan.referenceImage) : undefined
      return ref === plan.referenceImage ? plan : { ...plan, referenceImage: ref }
    })
  }

  // jobs.asset.url 若是 blob: 则刷新后失效，标记 expired 供 UI 显示失效占位
  if (session.jobs?.length) {
    sanitized.jobs = session.jobs.map((job): ShotJob => {
      if (job.asset?.url?.startsWith('blob:')) {
        return { ...job, asset: { ...job.asset, urlExpired: true } }
      }
      return job
    })
  }

  return { sanitized, assets }
}

/**
 * 纯函数（注入式 resolver）：把会话中的 idbref:// 索引恢复为可用资源，
 * 无法恢复的引用置空；blob: 资产标记 expired（进程重启后 objectURL 必失效）。
 */
export async function hydratePipelineSession(
  session: PipelineSessionV2,
  resolver: (id: string) => Promise<string | null>
): Promise<PipelineSessionV2> {
  const result: PipelineSessionV2 = { ...session }

  const resolveRef = async (value: string | undefined): Promise<string | undefined> => {
    if (isIdbRef(value)) {
      return (await resolver(idbRefToId(value))) || undefined
    }
    return value
  }

  if (session.productInput) {
    result.productInput = {
      ...session.productInput,
      imagePreview: await resolveRef(session.productInput.imagePreview),
      videoPreview: await resolveRef(session.productInput.videoPreview),
    }
  }

  if (session.visualPlans?.length) {
    const plans: VisualPlan[] = []
    for (const plan of session.visualPlans) {
      plans.push({ ...plan, referenceImage: await resolveRef(plan.referenceImage) })
    }
    result.visualPlans = plans
  }

  if (session.jobs?.length) {
    result.jobs = session.jobs.map((job) => {
      if (job.asset?.url?.startsWith('blob:')) {
        return { ...job, asset: { ...job.asset, urlExpired: true } }
      }
      return job
    })
  }

  return result
}

/** 真实浏览器 resolver：从 IndexedDB 取 blob 并生成 objectURL */
function idbResolver(id: string): Promise<string | null> {
  return getAssetObjectUrl(id)
}

/**
 * 保存会话（写入顺序：先 IndexedDB 落资产，成功后才写 localStorage 索引），
 * 避免出现「索引存在但资产缺失」的悬空引用。多次连续保存通过串行链保证落盘顺序。
 */
let pendingSave: Promise<void> = Promise.resolve()

export function savePipelineSession(session: PipelineSessionV2): void {
  const storage = getStorage()
  if (!storage) return

  // 大资产外移：localStorage 只存 idbref:// 索引，避免配额爆炸
  const { sanitized, assets } = extractHeavyAssets(session)

  pendingSave = pendingSave
    .then(async () => {
      // 1. 先把资产落 IndexedDB（失败则放弃本次索引写入，保持上次一致状态）
      for (const asset of assets) {
        const ref = await putDataUrlAsset(asset.id, asset.dataUrl)
        if (!ref) {
          console.warn('[Persist] 资产落 IndexedDB 失败，跳过本次索引写入:', asset.id)
          return
        }
      }
      // 2. 资产就绪后才写 localStorage 索引
      storage.setItem(
        PIPELINE_SESSION_V2_KEY,
        JSON.stringify({ ...sanitized, updatedAt: Date.now() })
      )
    })
    .catch((err) => {
      console.warn('保存 PipelineSessionV2 失败:', err)
    })
}

export function loadPipelineSession(): PipelineSessionV2 | null {
  const storage = getStorage()
  if (!storage) return null

  // 1. 优先读取 v2 会话
  try {
    const raw = storage.getItem(PIPELINE_SESSION_V2_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version === 2) {
        return parsed as PipelineSessionV2
      }
    }
  } catch (err) {
    console.warn('解析 PipelineSessionV2 失败:', err)
  }

  // 2. 兼容读取 v1 旧剧情会话并桥接为 v2
  try {
    const v1 = readGenerateSession()
    if (v1 && v1.shots.length > 0 && v1.envelope) {
      const bridgedStory: Story = {
        ...v1.envelope,
        shots: v1.shots,
      }
      return {
        version: 2,
        id: `bridged-${v1.id}`,
        activeStep: 3, // 默认落在分镜预演步
        story: bridgedStory,
        updatedAt: v1.startedAt,
      }
    }
  } catch {
    // 忽略 v1 读取错误
  }

  return null
}

/**
 * 加载并水合会话：idbref 恢复为 objectURL，blob: 标记 expired。
 * UI 应在 useEffect 中调用并回写状态。
 */
export async function loadAndHydratePipelineSession(): Promise<PipelineSessionV2 | null> {
  const session = loadPipelineSession()
  if (!session) return null
  return hydratePipelineSession(session, idbResolver)
}

export function clearPipelineSession(): void {
  const storage = getStorage()
  if (!storage) return
  try {
    // 同步清理 IndexedDB 中的资产（尽力而为）
    const raw = storage.getItem(PIPELINE_SESSION_V2_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as PipelineSessionV2
        const ids = new Set<string>()
        const collect = (v: string | undefined) => {
          if (isIdbRef(v)) ids.add(idbRefToId(v))
        }
        collect(parsed.productInput?.imagePreview)
        collect(parsed.productInput?.videoPreview)
        parsed.visualPlans?.forEach((p) => collect(p.referenceImage))
        void Promise.all(Array.from(ids).map(deleteAsset))
      } catch {}
    }
    storage.removeItem(PIPELINE_SESSION_V2_KEY)
  } catch {}
}
