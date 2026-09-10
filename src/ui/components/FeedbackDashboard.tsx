import React, { useCallback, useEffect, useState } from 'react'
import {
  addFeedbackRecord,
  computeWinRates,
  getAllFeedbackRecords,
  type FeedbackRecord,
  type WinRateAggregate,
} from '../../domain/feedback.ts'
import { readMemoryEnabled } from '../../domain/memoryPrefs.ts'
import { STRUCTURE_TEMPLATES } from '../../prompts/library/structures.ts'

/**
 * 回流看板 (Feedback Dashboard)
 *
 * 用户手动录入平台数据（3秒完播率/完播率/转化）→ IndexedDB →
 * 按结构 / 钩子 / 品类聚合胜率（纯 CSS 条形图，不引重量级图表库）。
 * 胜率数据经 getWinRateLookup 注入 ScriptWriter，实现采样加权闭环。
 */

type Props = {
  isOpen: boolean
  onClose: () => void
}

const EMPTY_AGG: WinRateAggregate = {
  byTemplate: new Map(),
  byHook: new Map(),
  byCategory: new Map(),
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

function BarRow({ label, stat }: { label: string; stat: { trials: number; wins: number; winRate: number } }) {
  return (
    <div className="fb-bar-row" title={`${label}: ${stat.wins}/${stat.trials} 次胜出 (Laplace 平滑)`}>
      <span className="fb-bar-label" title={label}>
        {label}
      </span>
      <div className="fb-bar-track">
        <div className="fb-bar-fill" style={{ width: `${Math.round(stat.winRate * 100)}%` }} />
      </div>
      <span className="fb-bar-value">
        {pct(stat.winRate)}
        <small>({stat.trials}样本)</small>
      </span>
    </div>
  )
}

export const FeedbackDashboard: React.FC<Props> = ({ isOpen, onClose }) => {
  const [records, setRecords] = useState<FeedbackRecord[]>([])
  const [agg, setAgg] = useState<WinRateAggregate>(EMPTY_AGG)
  const [saveTip, setSaveTip] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // 表单状态
  const [videoTitle, setVideoTitle] = useState('')
  const [templateId, setTemplateId] = useState(STRUCTURE_TEMPLATES[0].id)
  const [hookIndex, setHookIndex] = useState(0)
  const [category, setCategory] = useState('')
  const [view3sRate, setView3sRate] = useState(35)
  const [completionRate, setCompletionRate] = useState(20)
  const [conversions, setConversions] = useState(0)

  const refresh = useCallback(() => {
    void getAllFeedbackRecords().then((rs) => {
      setRecords(rs)
      setAgg(computeWinRates(rs))
    })
  }, [])

  useEffect(() => {
    if (isOpen) refresh()
  }, [isOpen, refresh])

  if (!isOpen) return null

  // E1 记忆采集开关（记忆图谱右上角同一持久化键）：渲染期派生读取；
  // 提交时 handleSubmit 内再次直读，双重确保关闭态不写入（父组件重渲染时刷新）
  const memoryEnabled = readMemoryEnabled()

  const selectedTemplate = STRUCTURE_TEMPLATES.find((t) => t.id === templateId)
  const hookType = selectedTemplate?.hookTypes?.[hookIndex]

  const handleSubmit = () => {
    setFormError(null)
    if (!readMemoryEnabled()) {
      setFormError('记忆采集已关闭（记忆图谱右上角开关可重新开启），本次录入未写入')
      return
    }
    if (!videoTitle.trim()) {
      setFormError('请填写视频标题')
      return
    }
    void addFeedbackRecord({
      videoTitle: videoTitle.trim(),
      templateId,
      hookIndex,
      hookType,
      category: category.trim() || undefined,
      view3sRate: view3sRate / 100,
      completionRate: completionRate / 100,
      conversions: conversions > 0 ? conversions : undefined,
    })
      .then(() => {
        setSaveTip('已录入，胜率看板已更新')
        setVideoTitle('')
        refresh()
        setTimeout(() => setSaveTip(null), 3000)
      })
      .catch((err) => {
        setFormError(`录入失败: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  const templateRows = Array.from(agg.byTemplate.entries()).sort((a, b) => b[1].winRate - a[1].winRate)
  const hookRows = Array.from(agg.byHook.entries()).sort((a, b) => b[1].winRate - a[1].winRate)
  const categoryRows = Array.from(agg.byCategory.entries()).sort((a, b) => b[1].winRate - a[1].winRate)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card feedback-dashboard-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '860px', width: '94%' }}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-icon">📊</span>
            <div>
              <h3>回流看板（数据反馈闭环）</h3>
              <p className="modal-sub">
                手动录入平台真实数据，按结构 / 钩子 / 品类聚合胜率；ScriptWriter 将按真实胜率加权采样钩子
              </p>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {!memoryEnabled && (
            <div className="fb-alert" role="status" data-testid="memory-disabled-notice">
              ⏸️ 记忆采集已关闭：新回流记录不会写入，已有记录保留。可在记忆图谱右上角开关重新开启。
            </div>
          )}
          {/* 录入表单 */}
          <div className="fb-form-grid">
            <label className="fb-field fb-field-wide">
              <span>视频标题 *</span>
              <input
                type="text"
                value={videoTitle}
                onChange={(e) => setVideoTitle(e.target.value)}
                placeholder="例如：负离子吹风机 3 分钟速干实测"
              />
            </label>
            <label className="fb-field">
              <span>结构模板</span>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {STRUCTURE_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="fb-field">
              <span>命中钩子</span>
              <select value={hookIndex} onChange={(e) => setHookIndex(Number(e.target.value))}>
                {selectedTemplate?.hookSamples.map((h, i) => (
                  <option key={i} value={i}>
                    #{i + 1} {selectedTemplate.hookTypes?.[i] ? `[${selectedTemplate.hookTypes[i]}] ` : ''}
                    {h.slice(0, 14)}…
                  </option>
                ))}
              </select>
            </label>
            <label className="fb-field">
              <span>商品种类</span>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="如：美妆护肤"
              />
            </label>
            <label className="fb-field">
              <span>3秒完播率 (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={view3sRate}
                onChange={(e) => setView3sRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              />
            </label>
            <label className="fb-field">
              <span>完播率 (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={completionRate}
                onChange={(e) => setCompletionRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              />
            </label>
            <label className="fb-field">
              <span>转化数</span>
              <input
                type="number"
                min={0}
                value={conversions}
                onChange={(e) => setConversions(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>

          {formError && <div className="fb-alert error">⚠️ {formError}</div>}
          {saveTip && <div className="fb-alert ok">✓ {saveTip}</div>}

          <button type="button" className="fb-submit-btn" onClick={handleSubmit}>
            📥 录入回流数据
          </button>

          {/* 胜率看板 */}
          <div className="fb-board-grid">
            <div className="fb-board-section">
              <h4>🏆 结构胜率</h4>
              {templateRows.length === 0 ? (
                <p className="fb-empty">暂无数据，先录入几条回流吧</p>
              ) : (
                templateRows.map(([id, stat]) => {
                  const name = STRUCTURE_TEMPLATES.find((t) => t.id === id)?.name || id
                  return <BarRow key={id} label={name} stat={stat} />
                })
              )}
            </div>

            <div className="fb-board-section">
              <h4>🪝 钩子胜率 Top</h4>
              {hookRows.length === 0 ? (
                <p className="fb-empty">暂无数据</p>
              ) : (
                hookRows.slice(0, 6).map(([key, stat]) => {
                  const [tid, idx] = key.split('#')
                  const tpl = STRUCTURE_TEMPLATES.find((t) => t.id === tid)
                  const label = `${tpl?.name || tid} · 钩子${Number(idx) + 1}`
                  return <BarRow key={key} label={label} stat={stat} />
                })
              )}
            </div>

            <div className="fb-board-section">
              <h4>🛍️ 品类胜率</h4>
              {categoryRows.length === 0 ? (
                <p className="fb-empty">暂无数据（录入时填写商品种类即可）</p>
              ) : (
                categoryRows.map(([cat, stat]) => <BarRow key={cat} label={cat} stat={stat} />)
              )}
            </div>
          </div>

          {/* 最近录入 */}
          <div className="fb-recent">
            <h4>🗒️ 最近录入 ({records.length})</h4>
            {records.length === 0 ? (
              <p className="fb-empty">暂无记录</p>
            ) : (
              <ul className="fb-recent-list">
                {records
                  .slice()
                  .reverse()
                  .slice(0, 8)
                  .map((r) => (
                    <li key={r.id}>
                      <span className="fb-recent-title">{r.videoTitle}</span>
                      <span className="fb-recent-meta">
                        3s完播 {pct(r.view3sRate)} · 完播 {pct(r.completionRate)}
                        {r.conversions != null ? ` · 转化 ${r.conversions}` : ''}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <span style={{ fontSize: '0.75rem', color: 'var(--wls-text-muted)' }}>
            胜率 = Laplace 平滑 (wins+1)/(trials+2)，3秒完播率 ≥ 30% 记为胜出；数据存 IndexedDB 本地
          </span>
          <button type="button" className="btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
