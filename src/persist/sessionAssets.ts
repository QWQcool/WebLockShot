import type { ProductInput } from '../domain/product.ts'
import type { VisualPlan } from '../domain/sellVisual.ts'
import type { ShotJob } from '../domain/shotJob.ts'
import type { PipelineSessionV2 } from '../persistV2.ts'
import { IDB_REF_PREFIX, idbRefToId, isIdbRef } from './assetStore.ts'

/**
 * PipelineSessionV2 大资产抽取 / 水合纯函数集合。
 *
 * 从 persistV2.ts 拆出，供 persistV2 与 BackendAdapter(local) 共用；
 * 本模块只含纯函数与类型，不触碰任何存储 API。
 */

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
