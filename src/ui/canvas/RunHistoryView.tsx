import React, { useCallback, useEffect, useState } from 'react'
import type { RunRecord } from '../../domain/runRecord.ts'
import {
  clearRunRecords,
  listRunRecords,
  peekRunRecords,
  subscribeRunRecords,
} from '../../persist/runStore.ts'
import {
  formatCost,
  formatDuration,
  resolveRunOutputRef,
  runStatusLabel,
  shortNodeId,
  showsRefundBadge,
  summarizeRuns,
  type ResolvedOutput,
} from '../../canvas/runHistory.ts'
import './runHistory.css'

/**
 * P1 · S4：运行历史抽屉（TODO.md P1 第 3~5 条）。
 *
 * - 数据来源：S3 的 `src/persist/runStore.ts`（执行器单一收口写入，滚动保留最近 200 条）；
 * - 首帧用 `peekRunRecords()` 同步渲染（免 await），随后 `listRunRecords()` 校准 + `subscribeRunRecords` 增量；
 * - 每条显示 **状态 / 耗时 / 费用（灵感币）/ 是否退款 / 失败原因**，点开看输入输出摘要；
 * - **与钱包打通**：直接显示该次消耗的灵感币与是否发生退款（本项目独有的差异化信息）；
 * - **诚实标注**：`demo === true`（演示引擎 Mock）标注「演示 · 非真实生成」；
 *   0 币无可退时不显示「已退款」（`showsRefundBadge`）；
 * - **持久输出引用**：`record.outputRef` 为 blob: 时回查节点 meta（见 `resolveRunOutputRef`），
 *   拿不到就如实显示「已失效」，不伪造。
 */

type Props = {
  onClose: () => void
  /** 持久输出引用回查：nodeId(+shotId) → 节点 meta.artifacts 的 idbref://（画布出片后已转存） */
  resolveDurableRef?: (nodeId: string, shotId?: string) => string | undefined
}

function describeOutput(out: ResolvedOutput): string {
  if (out.ref) {
    return out.source === 'node-meta' ? `${out.ref}（取自节点 meta 的持久引用）` : out.ref
  }
  if (out.staleBlob) return '产物引用已失效（演示产物为 blob:，刷新后失效）'
  return '无输出引用'
}

export const RunHistoryView: React.FC<Props> = ({ onClose, resolveDurableRef }) => {
  // 首帧同步读缓存（免 await 闪烁）；随后异步校准 + 订阅增量
  const [records, setRecords] = useState<RunRecord[]>(() => peekRunRecords())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listRunRecords().then((list) => {
      if (!cancelled) setRecords(list)
    })
    const unsub = subscribeRunRecords((list) => setRecords(list))
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleClear = useCallback(() => {
    setClearing(true)
    void clearRunRecords().finally(() => setClearing(false))
  }, [])

  const summary = summarizeRuns(records)

  return (
    <div className="rh-root" data-testid="run-history" role="dialog" aria-label="运行历史">
      <div className="rh-backdrop" onClick={onClose} />
      <aside className="rh-drawer">
        <header className="rh-header">
          <div className="rh-header-left">
            <h2>🕘 运行历史</h2>
            <span className="rh-header-sub" data-testid="rh-summary">
              总 {summary.total} 次 · 成功 {summary.succeeded} · 失败 {summary.failed} · 净消耗{' '}
              {summary.charged} 币 · 已退回 {summary.refunded} 币
            </span>
          </div>
          <div className="rh-header-actions">
            <button
              type="button"
              className="rh-btn rh-btn--ghost"
              data-testid="rh-clear"
              disabled={clearing || records.length === 0}
              onClick={handleClear}
            >
              🧹 清空
            </button>
            <button
              type="button"
              className="rh-btn"
              data-testid="rh-close"
              aria-label="关闭运行历史"
              onClick={onClose}
            >
              ✕ 关闭
            </button>
          </div>
        </header>

        <p className="rh-honest" role="note">
          记录由执行器（ExecutorEngine）单一收口落库，滚动保留最近 200 条；演示引擎（Mock）产生的记录
          已标注「演示 · 非真实生成」。演示产物是 <code>blob:</code> 引用，刷新后失效——这里优先展示
          节点内持久化的 <code>idbref://</code> 引用。
        </p>

        {records.length === 0 ? (
          <div className="rh-empty" data-testid="rh-empty">
            暂无运行记录。去画布连好「脚本 → 分镜 → 出片」跑一次，这里就会出现每次动作的
            状态 / 耗时 / 费用 / 是否退款。
          </div>
        ) : (
          <ul className="rh-list" data-testid="rh-list">
            {records.map((r) => {
              const expanded = expandedId === r.id
              const out = resolveRunOutputRef(r, resolveDurableRef)
              return (
                <li key={r.id} className={`rh-row rh-row--${r.status}`} data-testid="rh-row">
                  <button
                    type="button"
                    className="rh-row-main"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                  >
                    <span className={`rh-status rh-status--${r.status}`}>{runStatusLabel(r.status)}</span>
                    <span className="rh-kind">{r.kind}</span>
                    <span className="rh-node">{shortNodeId(r.nodeId)}</span>
                    <span className="rh-meta">
                      <span className="rh-meta-item">⏱ 耗时 {formatDuration(r.durationMs)}</span>
                      <span className="rh-meta-item">💰 {formatCost(r.cost)}</span>
                      {showsRefundBadge(r) && (
                        <span className="rh-badge rh-badge--refund" data-testid="rh-refund-badge">
                          ↩ 已退款
                        </span>
                      )}
                      {r.demo && (
                        <span className="rh-badge rh-badge--demo" data-testid="rh-demo-badge">
                          演示 · 非真实生成
                        </span>
                      )}
                    </span>
                  </button>

                  {expanded && (
                    <div className="rh-detail" data-testid="rh-detail">
                      <div className="rh-detail-row">
                        <span>动作类型</span>
                        <b>{r.kind}</b>
                      </div>
                      <div className="rh-detail-row">
                        <span>关联节点</span>
                        <b>{r.nodeId ?? '未关联节点'}</b>
                      </div>
                      {r.shotId && (
                        <div className="rh-detail-row">
                          <span>分镜</span>
                          <b>{r.shotId}</b>
                        </div>
                      )}
                      {r.provider && (
                        <div className="rh-detail-row">
                          <span>供应商</span>
                          <b>
                            {r.provider}
                            {r.demo ? '（演示引擎）' : ''}
                          </b>
                        </div>
                      )}
                      <div className="rh-detail-row">
                        <span>开始 → 结束</span>
                        <b>
                          {new Date(r.startedAt).toLocaleString()} →{' '}
                          {r.endedAt ? new Date(r.endedAt).toLocaleString() : '进行中'}
                        </b>
                      </div>
                      <div className="rh-detail-row">
                        <span>耗时</span>
                        <b>{formatDuration(r.durationMs)}</b>
                      </div>
                      <div className="rh-detail-row">
                        <span>费用</span>
                        <b>{formatCost(r.cost)}</b>
                      </div>
                      <div className="rh-detail-row">
                        <span>退款</span>
                        <b>
                          {showsRefundBadge(r)
                            ? '已发生退款（原路退回）'
                            : r.cost > 0
                              ? '未退款（正常核销）'
                              : '无款项可退'}
                        </b>
                      </div>
                      {typeof r.attempt === 'number' && (
                        <div className="rh-detail-row">
                          <span>尝试次数</span>
                          <b>第 {r.attempt + 1} 次</b>
                        </div>
                      )}
                      {r.error && (
                        <div className="rh-detail-row rh-detail-row--error">
                          <span>失败原因</span>
                          <b data-testid="rh-error">{r.error}</b>
                        </div>
                      )}
                      <div className="rh-detail-row">
                        <span>输出引用</span>
                        <b className="rh-detail-ref" data-testid="rh-output">
                          {describeOutput(out)}
                        </b>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </aside>
    </div>
  )
}
