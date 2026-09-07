import type { ProductInput } from './domain/product.ts'
import type { Script } from './domain/script.ts'
import type { VisualPlan } from './domain/sellVisual.ts'
import type { ShotJob } from './domain/shotJob.ts'
import type { Story } from './types.ts'
import { getBackendAdapter, PIPELINE_SESSION_V2_KEY } from './services/backend/index.ts'
import type { StorageQuota } from './services/backend/types.ts'

// 纯函数实现已拆分到 persist/sessionAssets.ts，此处 re-export 保持既有导入路径兼容
export { extractHeavyAssets, hydratePipelineSession } from './persist/sessionAssets.ts'
export type { ExtractedAsset, ExtractionResult } from './persist/sessionAssets.ts'
export { PIPELINE_SESSION_V2_KEY }

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

/**
 * 会话持久化入口：统一经 BackendAdapter 访问（M1a 预留层）。
 *
 * - 默认（VITE_BACKEND_URL 为空）= localAdapter，行为与历史实现完全一致；
 * - 配置了 REST 后端 = restAdapter，失败自动降级 local。
 * 对外 API 保持同步签名兼容（loadPipelineSession / clearPipelineSession），
 * rest 模式请使用 loadPipelineSessionAsync。
 */

/** 保存会话（fire-and-forget，沿用历史语义；local 模式内部串行落盘） */
export function savePipelineSession(session: PipelineSessionV2): void {
  void getBackendAdapter().saveSession(session)
}

/**
 * 同步读取会话原始快照（兼容现有同步调用点）。
 * rest 模式无同步语义，返回 null —— 请改用 loadPipelineSessionAsync。
 */
export function loadPipelineSession(): PipelineSessionV2 | null {
  const adapter = getBackendAdapter()
  if (adapter.loadSessionSync) {
    return adapter.loadSessionSync()
  }
  return null
}

/** 异步读取会话原始快照（local / rest 模式通用） */
export async function loadPipelineSessionAsync(): Promise<PipelineSessionV2 | null> {
  return getBackendAdapter().loadSession()
}

/**
 * 加载并水合会话：local 模式下 idbref 恢复为 objectURL，blob: 标记 expired。
 * UI 应在 useEffect 中调用并回写状态。
 */
export async function loadAndHydratePipelineSession(): Promise<PipelineSessionV2 | null> {
  return getBackendAdapter().loadHydratedSession()
}

/** 清空会话（local：同步清索引 + 异步清 IndexedDB 资产；rest：DELETE 远端） */
export function clearPipelineSession(): void {
  void getBackendAdapter().clearSession()
}

/** 存储配额查询（local：navigator.storage.estimate；rest：/api/quota）；不可用返回 null */
export async function getStorageQuota(): Promise<StorageQuota | null> {
  try {
    return await getBackendAdapter().getQuota()
  } catch {
    return null
  }
}
