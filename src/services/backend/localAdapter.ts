import { readGenerateSession } from '../../persist.ts'
import type { PipelineSessionV2 } from '../../persistV2.ts'
import {
  loadCanvasDocFrom,
  saveCanvasDocTo,
  clearCanvasDocFrom,
} from '../../canvas/canvasStore.ts'
import {
  deleteAsset,
  getAssetObjectUrl,
  idbRefToId,
  isIdbRef,
  putDataUrlAsset,
} from '../../persist/assetStore.ts'
import { extractHeavyAssets, hydratePipelineSession } from '../../persist/sessionAssets.ts'
import type { BackendAdapter, StorageQuota } from './types.ts'

/**
 * 本地默认模式 Adapter：包装现有 localStorage + IndexedDB 持久化逻辑。
 *
 * 行为与历史 persistV2 实现完全一致（硬性验收标准）：
 * - 保存：先 IndexedDB 落大资产，成功后才写 localStorage 索引（串行链保证落盘顺序）；
 * - 读取：优先 v2 会话，兼容桥接 v1 旧剧情会话；
 * - 水合：idbref:// 恢复为 objectURL，blob: 标记 expired。
 */

export const PIPELINE_SESSION_V2_KEY = 'weblockshot.pipeline.v2' as const

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

/** 多次连续保存通过串行链保证落盘顺序（沿用原 persistV2 行为） */
let pendingSave: Promise<void> = Promise.resolve()

async function saveLocalSession(session: PipelineSessionV2): Promise<void> {
  const storage = getStorage()
  if (!storage) return

  // 大资产外移：localStorage 只存 idbref:// 索引，避免配额爆炸
  const { sanitized, assets } = extractHeavyAssets(session)

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
}

function loadLocalSessionSync(): PipelineSessionV2 | null {
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
      const bridgedStory = {
        ...v1.envelope,
        shots: v1.shots,
      }
      return {
        version: 2,
        id: `bridged-${v1.id}`,
        activeStep: 3, // 默认落在分镜预演步
        story: bridgedStory,
        updatedAt: v1.startedAt,
      } satisfies PipelineSessionV2
    }
  } catch {
    // 忽略 v1 读取错误
  }

  return null
}

function clearLocalSession(): void {
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

/** 真实浏览器 resolver：从 IndexedDB 取 blob 并生成 objectURL */
function idbResolver(id: string): Promise<string | null> {
  return getAssetObjectUrl(id)
}

export function createLocalAdapter(): BackendAdapter {
  return {
    mode: 'local',

    saveSession(session: PipelineSessionV2): Promise<void> {
      // 沿用原串行链：多次连续保存按调用顺序落盘
      pendingSave = pendingSave
        .then(() => saveLocalSession(session))
        .catch((err) => {
          console.warn('保存 PipelineSessionV2 失败:', err)
        })
      return pendingSave
    },

    loadSession(): Promise<PipelineSessionV2 | null> {
      return Promise.resolve(loadLocalSessionSync())
    },

    loadSessionSync(): PipelineSessionV2 | null {
      return loadLocalSessionSync()
    },

    async loadHydratedSession(): Promise<PipelineSessionV2 | null> {
      const session = loadLocalSessionSync()
      if (!session) return null
      return hydratePipelineSession(session, idbResolver)
    },

    clearSession(): Promise<void> {
      clearLocalSession()
      return Promise.resolve()
    },

    async getQuota(): Promise<StorageQuota | null> {
      try {
        if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
          const est = await navigator.storage.estimate()
          return { usageBytes: est.usage ?? null, quotaBytes: est.quota ?? null }
        }
      } catch {
        // 配额查询失败不致命
      }
      return null
    },

    saveCanvasDoc(doc) {
      return saveCanvasDocTo(getStorage(), doc)
    },

    loadCanvasDoc() {
      return loadCanvasDocFrom(getStorage())
    },

    clearCanvasDoc() {
      clearCanvasDocFrom(getStorage())
    },
  }
}
