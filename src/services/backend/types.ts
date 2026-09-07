import type { PipelineSessionV2 } from '../../persistV2.ts'

/**
 * BackendAdapter 预留层接口（「预留接口做好不用」原则的核心）。
 *
 * 所有服务端能力 = 配置开关 + 本地默认模式：
 * - VITE_BACKEND_URL 为空 → getBackendAdapter() 返回 localAdapter，
 *   行为与纯前端现状（localStorage + IndexedDB）完全一致；
 * - 真实部署只是填配置（VITE_BACKEND_URL 指向伴生 server 或云后端），
 *   rest 模式请求失败时自动降级回 local，不阻塞用户。
 */

/** 存储配额信息（local 模式来自 navigator.storage.estimate，rest 模式来自后端 /api/quota） */
export type StorageQuota = {
  usageBytes: number | null
  quotaBytes: number | null
}

/** 预留：向远端提交生成任务的请求载荷（本地模式不使用） */
export type SubmitTaskRequest = {
  clientTaskId: string
  providerId: string
  prompt: string
  durationSec: number
  payload?: Record<string, unknown>
}

/** 预留：错误上报载荷（SENTRY_DSN / 后端 /api/errors 均为预留） */
export type ErrorReport = {
  message: string
  stack?: string
  context?: Record<string, unknown>
}

export interface BackendAdapter {
  /** 'local' = 浏览器本地（现状）；'rest' = 远端后端（预留） */
  readonly mode: 'local' | 'rest'

  /** 保存会话（local：大资产外移 IndexedDB + localStorage 索引；rest：PUT /api/sessions/:id） */
  saveSession(session: PipelineSessionV2): Promise<void>

  /** 异步读取会话原始快照 */
  loadSession(): Promise<PipelineSessionV2 | null>

  /**
   * 同步读取会话原始快照。仅 local adapter 支持（localStorage 同步语义），
   * 用于兼容现有同步调用点（如 useState 惰性初始化）；rest 模式为 undefined。
   */
  loadSessionSync?(): PipelineSessionV2 | null

  /**
   * 读取并水合会话：local 模式将 idbref:// 恢复为 objectURL、blob: 标记 expired；
   * rest 模式等价于 loadSession（远端返回即可用 URL）。
   */
  loadHydratedSession(): Promise<PipelineSessionV2 | null>

  /** 清空会话（local：同步清 localStorage 索引 + 异步清 IndexedDB 资产） */
  clearSession(): Promise<void>

  /** 存储配额查询；不可用时返回 null */
  getQuota(): Promise<StorageQuota | null>

  /** 预留：提交生成任务到远端队列（未实现为 undefined，调用方需判空） */
  submitTask?(req: SubmitTaskRequest): Promise<{ taskId: string }>

  /** 预留：错误上报（未实现为 undefined） */
  reportError?(report: ErrorReport): Promise<void>
}
