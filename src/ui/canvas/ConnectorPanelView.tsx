import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CONNECTOR_CATEGORIES,
  RECOMMENDED_CONNECTORS,
  addCustomConnector,
  connectorListResponseSchema,
  describeConnectorStatus,
  mergeConnectorEntries,
  readCustomConnectors,
  removeCustomConnector,
  type ConnectorCategory,
  type ConnectorEntry,
  type CustomConnector,
} from '../../canvas/connectors.ts'
import './connectorPanel.css'

/**
 * D4 连接器面板（CANVAS_PLAN.md §6.3 / §9 D4，Miora 图6 1:1）。
 *
 * 诚实红线（与 connectors.ts 同口径）：
 * - 卡片照常展示（图6 形态），但状态一律如实标注「⚠️ 接口就绪 · 未接入」；
 * - 纯前端模式（无伴生服务）顶部另标「无功能可用」；
 * - 点击「＋」不会假装连上：有伴生服务时调用占位 auth 路由并把服务端如实 501 文案回显，
 *   无伴生服务时本地如实说明——绝不伪造「已连接 / 已同步」；
 * - 品牌 Logo 不随仓库分发：图标为**首字母字形 + 品牌近似底色**。
 *
 * 视觉：cp- 前缀浅色主题全隔离，不污染画布/工作台基调。
 */

type Props = {
  onClose: () => void
}

type CompanionState =
  | { phase: 'probing' }
  | { phase: 'off' } // 无伴生服务（纯前端模式）
  | { phase: 'online'; mode: 'interface' | 'ready' }

const CATEGORY_TINT: Record<ConnectorCategory, string> = {
  效率办公: '#e8f1ff',
  开发工具: '#eef0ff',
  营销推广: '#e6f7f0',
}

export const ConnectorPanelView: React.FC<Props> = ({ onClose }) => {
  const [custom, setCustom] = useState<CustomConnector[]>(() => readCustomConnectors())
  const [remote, setRemote] = useState<ConnectorEntry[] | null>(null)
  const [companion, setCompanion] = useState<CompanionState>({ phase: 'probing' })
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)
  // D8：MCP 反向驱动能力（可选依赖探测结果）
  const [mcp, setMcp] = useState<{ ready: boolean; guidance?: string } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<{ name: string; category: ConnectorCategory; description: string }>({
    name: '',
    category: '效率办公',
    description: '',
  })

  // 伴生服务探测：/healthz connectors 能力位（不可达 = 纯前端模式，卡片照常展示但无功能）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/healthz', { method: 'GET' })
        if (!res.ok) throw new Error('healthz not ok')
        const body = (await res.json()) as Record<string, unknown>
        if (cancelled) return
        if (body.connectors === 'interface' || body.connectors === 'ready') {
          setCompanion({ phase: 'online', mode: body.connectors })
          try {
            const listRes = await fetch('/api/connectors', { method: 'GET' })
            if (listRes.ok) {
              const parsed = connectorListResponseSchema.safeParse(await listRes.json())
              if (!cancelled && parsed.success) setRemote(parsed.data.connectors)
            }
          } catch {
            // 目录拉取失败：回退本地官方目录（诚实降级）
          }
        } else {
          setCompanion({ phase: 'off' })
        }
        // D8：MCP 状态（未装 SDK 时服务端返回 guidance 原文，UI 如实展示）
        try {
          const s = await fetch('/api/mcp/status', { method: 'GET' })
          if (s.ok) {
            const b = (await s.json()) as Record<string, unknown>
            if (!cancelled) {
              setMcp({
                ready: b.ready === true,
                guidance: typeof b.guidance === 'string' ? b.guidance : undefined,
              })
            }
          }
        } catch {
          // 探测失败按未就绪处理（诚实降级）
        }
      } catch {
        if (!cancelled) setCompanion({ phase: 'off' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const entries = useMemo(() => mergeConnectorEntries(remote, custom), [remote, custom])
  const recommended = useMemo(
    () => entries.filter((e) => RECOMMENDED_CONNECTORS.some((r) => r.id === e.id)),
    [entries]
  )
  const customEntries = useMemo(
    () => entries.filter((e) => !RECOMMENDED_CONNECTORS.some((r) => r.id === e.id)),
    [entries]
  )

  const visualOf = useCallback((id: string) => {
    const r = RECOMMENDED_CONNECTORS.find((c) => c.id === id)
    if (r) return { glyph: r.glyph, tint: r.tint }
    return { glyph: '＋', tint: '#e9eef2' }
  }, [])

  /** 点击「＋」：如实反馈（有伴生服务则调用占位 auth 路由回显服务端文案） */
  const handleConnect = useCallback(
    async (entry: ConnectorEntry) => {
      if (companion.phase !== 'online') {
        setNotice({
          kind: 'info',
          text: `「${entry.name}」未接入：当前为纯前端模式（未探测到伴生服务），本期仅接口 + 协议层 mock，无功能可用。`,
        })
        return
      }
      try {
        const res = await fetch(`/api/connectors/${encodeURIComponent(entry.id)}/auth`, { method: 'POST' })
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
        setNotice({
          kind: 'info',
          text:
            typeof body.error === 'string'
              ? body.error
              : `「${entry.name}」授权未接入（HTTP ${res.status}）——本期仅接口 + 协议层 mock。`,
        })
      } catch {
        setNotice({ kind: 'err', text: `「${entry.name}」授权请求失败：伴生服务不可达` })
      }
    },
    [companion]
  )

  const handleAdd = useCallback(() => {
    const r = addCustomConnector(undefined, form)
    if (!r.ok) {
      setNotice({ kind: 'err', text: `⛔ ${r.reason}` })
      return
    }
    setCustom(r.connectors)
    setForm({ name: '', category: '效率办公', description: '' })
    setAddOpen(false)
    setNotice({ kind: 'ok', text: `✓ 已添加自定义连接器「${form.name.trim()}」（本地保存，未接入）` })
  }, [form])

  const handleRemove = useCallback((id: string, name: string) => {
    setCustom(removeCustomConnector(undefined, id))
    setNotice({ kind: 'ok', text: `已移除自定义连接器「${name}」` })
  }, [])

  /** D8 正向标杆连接器：GitHub 拉取 Issue（PAT 只存伴生服务侧；未配置则如实 401 提示） */
  const handleGithubRun = useCallback(async () => {
    const repo = window.prompt('GitHub 仓库（owner/name）：', '')
    if (!repo) return
    try {
      const res = await fetch('/api/connectors/github/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'list-issues', repo: repo.trim() }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setNotice({ kind: 'err', text: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` })
        return
      }
      const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : []
      const first = items[0] && typeof items[0].title === 'string' ? items[0].title : '—'
      setNotice({
        kind: 'ok',
        text: `✓ 已拉取 ${repo} 的 ${items.length} 条 open Issue（首条：${first}）`,
      })
    } catch {
      setNotice({ kind: 'err', text: 'GitHub 请求失败：伴生服务不可达' })
    }
  }, [])

  return (
    <div className="cp-root" data-testid="connector-panel">
      <header className="cp-header">
        <div className="cp-header-left">
          <h2>🔌 连接器</h2>
          <span className="cp-mode-tag" data-testid="cp-mode">
            {companion.phase === 'probing'
              ? '探测伴生服务中…'
              : companion.phase === 'off'
                ? '纯前端模式 · 无功能可用'
                : companion.mode === 'ready'
                  ? '伴生服务在线 · 已接入'
                  : '伴生服务在线 · 仅接口'}
          </span>
        </div>
        <button type="button" className="cp-btn cp-btn--close" data-testid="cp-close" onClick={onClose}>
          ✕ 关闭
        </button>
      </header>

      <p className="cp-honest" role="note">
        ⚠️ 本期连接器<strong>仅接口 + 协议层 mock</strong>（不引 <code>@modelcontextprotocol/sdk</code>
        、不接真实第三方）：卡片可浏览，点击「＋」不会真正连接。真实接入需实际部署伴生服务并安装 SDK
        （可选依赖）。
      </p>

      {notice && (
        <div className={`cp-notice cp-notice--${notice.kind}`} role="status" data-testid="cp-notice">
          {notice.text}
        </div>
      )}

      <section className="cp-section">
        <div className="cp-section-head">
          <h3>推荐连接器</h3>
          <button
            type="button"
            className="cp-btn"
            data-testid="cp-add-toggle"
            onClick={() => setAddOpen((v) => !v)}
          >
            ＋ 添加自定义连接器
          </button>
        </div>

        {addOpen && (
          <div className="cp-add-form" data-testid="cp-add-form">
            <input
              className="cp-input"
              placeholder="连接器名称（必填，≤40 字）"
              aria-label="自定义连接器名称"
              maxLength={40}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <select
              className="cp-select"
              aria-label="自定义连接器分类"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ConnectorCategory }))}
            >
              {CONNECTOR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className="cp-input cp-input--wide"
              placeholder="描述（可选，≤120 字）"
              aria-label="自定义连接器描述"
              maxLength={120}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <button type="button" className="cp-btn cp-btn--primary" data-testid="cp-add-submit" onClick={handleAdd}>
              添加
            </button>
          </div>
        )}

        <div className="cp-grid" data-testid="cp-grid">
          {recommended.map((entry) => {
            const v = visualOf(entry.id)
            return (
              <article className="cp-card" key={entry.id} data-testid={`cp-card-${entry.id}`}>
                <span className="cp-card-icon" style={{ background: v.tint }} aria-hidden>
                  {v.glyph}
                </span>
                <div className="cp-card-main">
                  <div className="cp-card-title">
                    <span className="cp-card-name">{entry.name}</span>
                    <span className="cp-card-category" style={{ background: CATEGORY_TINT[entry.category as ConnectorCategory] ?? '#eef1f4' }}>
                      {entry.category}
                    </span>
                  </div>
                  <p className="cp-card-desc">{entry.description}</p>
                  <span className={`cp-card-status cp-card-status--${entry.status}`}>
                    {describeConnectorStatus(entry.status)}
                  </span>
                  {entry.id === 'github' && mcp?.ready && (
                    <button
                      type="button"
                      className="cp-card-run"
                      data-testid="cp-github-run"
                      title="拉取指定仓库的 open Issue（PAT 存伴生服务侧 WLS_GITHUB_TOKEN）"
                      onClick={() => void handleGithubRun()}
                    >
                      📥 拉取 Issue
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="cp-card-plus"
                  aria-label={`连接 ${entry.name}`}
                  data-testid={`cp-connect-${entry.id}`}
                  onClick={() => void handleConnect(entry)}
                >
                  ＋
                </button>
              </article>
            )
          })}
        </div>
      </section>

      {customEntries.length > 0 && (
        <section className="cp-section">
          <div className="cp-section-head">
            <h3>自定义连接器</h3>
            <span className="cp-section-note">本地保存 · 未接入</span>
          </div>
          <div className="cp-grid" data-testid="cp-custom-grid">
            {customEntries.map((entry) => (
              <article className="cp-card" key={entry.id} data-testid={`cp-custom-${entry.id}`}>
                <span className="cp-card-icon" style={{ background: '#e9eef2' }} aria-hidden>
                  ＋
                </span>
                <div className="cp-card-main">
                  <div className="cp-card-title">
                    <span className="cp-card-name">{entry.name}</span>
                    <span className="cp-card-category" style={{ background: CATEGORY_TINT[entry.category as ConnectorCategory] ?? '#eef1f4' }}>
                      {entry.category}
                    </span>
                  </div>
                  <p className="cp-card-desc">{entry.description || '（无描述）'}</p>
                  <span className="cp-card-status cp-card-status--interface">
                    {describeConnectorStatus(entry.status)}
                  </span>
                </div>
                <button
                  type="button"
                  className="cp-card-plus cp-card-plus--danger"
                  aria-label={`移除 ${entry.name}`}
                  data-testid={`cp-remove-${entry.id}`}
                  onClick={() => handleRemove(entry.id, entry.name)}
                >
                  ✕
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* D8 MCP 反向驱动（可选依赖）：未装 = 安装指引；装了 = 本地 Agent 可驱动画布 */}
      <section className="cp-section">
        <div className="cp-section-head">
          <h3>MCP 反向驱动（可选依赖）</h3>
          <span className="cp-section-note" data-testid="cp-mcp-state">
            {mcp === null ? '探测中…' : mcp.ready ? '已就绪' : '未启用'}
          </span>
        </div>
        <div className="cp-mcp" data-testid="cp-mcp">
          {mcp?.ready ? (
            <>
              <p className="cp-mcp-ok">
                ✅ 已检测到 <code>@modelcontextprotocol/sdk</code>：本地 Agent（Codex / Claude Code 等）可
                <strong>读取画布拓扑</strong>并<strong>建节点 / 连线</strong>，画布每 2 秒同步一次。
              </p>
              <p className="cp-mcp-line">
                工具：<code>canvas_read_topology</code> · <code>canvas_apply_ops</code> · 端点{' '}
                <code>/api/mcp/*</code>（详见 <code>docs/mcp.md</code>）
              </p>
            </>
          ) : (
            <>
              <p className="cp-mcp-warn">
                {mcp?.guidance ??
                  '未检测到可选依赖 @modelcontextprotocol/sdk：反向驱动画布不可用（默认零依赖行为不变）。'}
              </p>
              <p className="cp-mcp-line">
                启用：<code>npm i @modelcontextprotocol/sdk</code> 后重启伴生服务（正向标杆连接器 GitHub
                另需 <code>WLS_GITHUB_TOKEN</code>）
              </p>
            </>
          )}
        </div>
      </section>

      <footer className="cp-footer">
        连接器协议层 mock 单测见 <code>server/connectors.test.mjs</code>；三类目标形态文档见{' '}
        <code>docs/connectors.md</code>。
      </footer>
    </div>
  )
}
