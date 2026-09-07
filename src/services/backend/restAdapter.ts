import type { PipelineSessionV2 } from '../../persistV2.ts'
import { createLocalAdapter } from './localAdapter.ts'
import type { BackendAdapter, ErrorReport, StorageQuota, SubmitTaskRequest } from './types.ts'

/**
 * REST 后端 Adapter（预留实现）：把会话持久化转发到 VITE_BACKEND_URL 指向的伴生 server。
 *
 * - 对应 server 端点：PUT/GET/DELETE /api/sessions/:id、GET /api/quota（预留）；
 * - 网络级失败（fetch 拒绝 / 5xx）→ 自动降级为 localAdapter，
 *   仅 console.warn 一次（不打日志噪音），后续操作直接走本地；
 * - 4xx 属于业务错误，不触发降级（由调用方处理）。
 */

export type RestAdapterDeps = {
  fetchImpl?: typeof fetch
  /** 降级时使用的本地 adapter（默认创建标准 local adapter，测试可注入替身） */
  fallback?: BackendAdapter
  onDegrade?: (reason: string) => void
}

export function createRestAdapter(baseUrl: string, deps: RestAdapterDeps = {}): BackendAdapter {
  const base = baseUrl.replace(/\/$/, '')
  const fetchImpl = deps.fetchImpl ?? fetch
  const fallback = deps.fallback ?? createLocalAdapter()

  let degraded = false
  const warnDegrade = (() => {
    let warned = false
    return (reason: string) => {
      degraded = true
      deps.onDegrade?.(reason)
      if (!warned) {
        warned = true
        console.warn(`[Backend] REST 后端不可达(${reason})，自动降级为本地存储模式。`)
      }
    }
  })()

  const sessionUrl = (id: string): string =>
    `${base}/api/sessions/${encodeURIComponent(id || 'default')}`

  const isNetworkFailure = (err: unknown): boolean =>
    err instanceof TypeError || (err instanceof Error && err.name === 'FetchError')

  return {
    mode: 'rest',

    async saveSession(session: PipelineSessionV2): Promise<void> {
      if (degraded) return fallback.saveSession(session)
      try {
        const resp = await fetchImpl(sessionUrl(session.id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: session }),
        })
        if (resp.status >= 500) throw new TypeError(`server ${resp.status}`)
        if (!resp.ok) {
          // 业务错误（4xx）不降级、不本地兜底：调用方无需感知，本次保存被后端拒绝即跳过
          console.warn(`[Backend] 保存会话被后端拒绝(${resp.status})，已跳过（4xx 不兜底，未降级）。`)
        }
      } catch (err) {
        if (isNetworkFailure(err)) warnDegrade(err instanceof Error ? err.message : 'network')
        return fallback.saveSession(session)
      }
    },

    async loadSession(): Promise<PipelineSessionV2 | null> {
      if (degraded) return fallback.loadSession()
      try {
        const resp = await fetchImpl(sessionUrl('default'), { method: 'GET' })
        if (resp.status === 404) return null
        if (resp.status >= 500) throw new TypeError(`server ${resp.status}`)
        if (!resp.ok) return null
        const body = (await resp.json()) as { data?: PipelineSessionV2 }
        return body?.data ?? null
      } catch (err) {
        if (isNetworkFailure(err)) warnDegrade(err instanceof Error ? err.message : 'network')
        return fallback.loadSession()
      }
    },

    async loadHydratedSession(): Promise<PipelineSessionV2 | null> {
      // 远端返回的会话即为可用形态（无 idbref 索引），无需水合
      return this.loadSession()
    },

    async clearSession(): Promise<void> {
      if (degraded) return fallback.clearSession()
      try {
        const resp = await fetchImpl(sessionUrl('default'), { method: 'DELETE' })
        if (resp.status >= 500) throw new TypeError(`server ${resp.status}`)
      } catch (err) {
        if (isNetworkFailure(err)) warnDegrade(err instanceof Error ? err.message : 'network')
        return fallback.clearSession()
      }
    },

    async getQuota(): Promise<StorageQuota | null> {
      if (degraded) return fallback.getQuota()
      try {
        const resp = await fetchImpl(`${base}/api/quota`, { method: 'GET' })
        if (!resp.ok) return null
        const body = (await resp.json()) as { usageBytes?: number | null; quotaBytes?: number | null }
        return { usageBytes: body?.usageBytes ?? null, quotaBytes: body?.quotaBytes ?? null }
      } catch (err) {
        if (isNetworkFailure(err)) warnDegrade(err instanceof Error ? err.message : 'network')
        return fallback.getQuota()
      }
    },

    /** 预留：提交任务到远端队列 */
    async submitTask(req: SubmitTaskRequest): Promise<{ taskId: string }> {
      const resp = await fetchImpl(`${base}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })
      if (!resp.ok) {
        throw new Error(`提交任务失败 (HTTP ${resp.status})`)
      }
      const body = (await resp.json()) as { taskId?: string }
      if (!body?.taskId) throw new Error('后端未返回 taskId')
      return { taskId: body.taskId }
    },

    /** 预留：错误上报 */
    async reportError(report: ErrorReport): Promise<void> {
      try {
        await fetchImpl(`${base}/api/errors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
        })
      } catch {
        // 上报失败静默，不影响主流程
      }
    },
  }
}
