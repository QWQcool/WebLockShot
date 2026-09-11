/**
 * 运行历史（P1 · S4）纯函数层 —— 与 UI 解耦，node --test 直接覆盖。
 *
 * 职责：
 * - **持久输出引用解析**（TODO P1 第 3 条）：画布 Mock 出片的 `record.outputRef` 是 `blob:`
 *   （刷新即失效），持久引用在**节点 meta.artifacts**（出片后 blob 已转存 idbref://）。
 *   故：`record.outputRef` 为非 blob: 的持久引用 → 直接采用；否则用 `nodeId + shotId` 回查节点 meta。
 * - 展示格式化（耗时 / 费用 / 状态）。
 * - 汇总（抽屉头部：总次数 / 成功 / 失败 / 净消耗 / 已退回）。
 * - 退款徽章判定（S3 观察项：0 币无可退，不应显示「已退款」）。
 */
import type { RunRecord, RunStatus } from '../domain/runRecord.ts'

/** 持久输出引用判定：`idbref://` 或 http(s) 直链；`blob:` / `data:` 跨刷新失效，不算持久 */
export function isDurableOutputRef(ref: string | undefined | null): ref is string {
  return (
    typeof ref === 'string' &&
    (ref.startsWith('idbref://') || ref.startsWith('http://') || ref.startsWith('https://'))
  )
}

export type ResolvedOutput = {
  /** 可用的持久引用（无则为 undefined） */
  ref?: string
  /** 来源：record = 记录自带；node-meta = 从节点 meta.artifacts 回查；none = 拿不到 */
  source: 'record' | 'node-meta' | 'none'
  /** 记录里的引用存在但为 `blob:`（刷新后失效，UI 需如实提示而非当持久引用用） */
  staleBlob: boolean
}

/**
 * 解析一条记录的**持久**输出引用（纯函数，回查函数注入以便单测）：
 * 1. `record.outputRef` 已是持久引用 → 直接采用（真实 provider 的 http URL 走这条）；
 * 2. 否则用 `nodeId + shotId` 回查节点 meta.artifacts（画布演示出片走这条）；
 * 3. 都拿不到 → `none`（UI 如实显示「产物引用已失效」，不伪造）。
 */
export function resolveRunOutputRef(
  record: Pick<RunRecord, 'outputRef' | 'nodeId' | 'shotId'>,
  lookupNodeArtifactRef?: (nodeId: string, shotId?: string) => string | undefined
): ResolvedOutput {
  const staleBlob = typeof record.outputRef === 'string' && record.outputRef.startsWith('blob:')
  if (isDurableOutputRef(record.outputRef)) {
    return { ref: record.outputRef, source: 'record', staleBlob: false }
  }
  if (record.nodeId && lookupNodeArtifactRef) {
    const fromMeta = lookupNodeArtifactRef(record.nodeId, record.shotId)
    if (isDurableOutputRef(fromMeta)) return { ref: fromMeta, source: 'node-meta', staleBlob }
  }
  return { source: 'none', staleBlob }
}

/** 耗时展示：undefined → 「—」；<1s → 「123 ms」；<60s → 「1.2 s」；否则「1 分 05 秒」 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`
}

/** 费用展示：0 → 「0 灵感币（未扣费）」；否则「10 灵感币」 */
export function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return '0 灵感币（未扣费）'
  return `${cost} 灵感币`
}

export function runStatusLabel(status: RunStatus): string {
  if (status === 'succeeded') return '成功'
  if (status === 'failed') return '失败'
  return '进行中'
}

/**
 * 是否展示「已退款」徽章。
 * S3 观察项修正（UI 侧兜底）：`walletManager.refund` 对 `amount<=0` 直接返回 true（无款项可退），
 * 因此「0 币失败」不应显示成「已退款」。数据层已同时修正（`refundRun` 仅 `amount>0` 才置真），
 * 这里再兜一层，保证任何来源的记录都不会把 0 币渲染成已退款。
 */
export function showsRefundBadge(record: Pick<RunRecord, 'cost' | 'refunded'>): boolean {
  return record.cost > 0 && record.refunded
}

export type RunHistorySummary = {
  total: number
  succeeded: number
  failed: number
  /** 实际净消耗（未被退回的灵感币合计） */
  charged: number
  /** 已退回的灵感币合计 */
  refunded: number
}

/** 汇总（抽屉头部）：用于「总 N 次 · 成功 X · 失败 Y · 净消耗 A 币 · 已退回 B 币」 */
export function summarizeRuns(records: RunRecord[]): RunHistorySummary {
  let succeeded = 0
  let failed = 0
  let charged = 0
  let refunded = 0
  for (const r of records) {
    if (r.status === 'succeeded') succeeded++
    else if (r.status === 'failed') failed++
    if (showsRefundBadge(r)) refunded += r.cost
    else charged += r.cost
  }
  return { total: records.length, succeeded, failed, charged, refunded }
}

/** 节点 id 短展示（`shape:wls-abc123` → `wls-abc123`） */
export function shortNodeId(nodeId: string | undefined): string {
  if (!nodeId) return '未关联节点'
  const i = nodeId.indexOf(':')
  return i >= 0 ? nodeId.slice(i + 1) : nodeId
}
