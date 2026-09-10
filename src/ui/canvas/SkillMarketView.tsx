import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  CANVAS_NODE_META,
  OFFICIAL_SKILLS,
  SKILL_MANIFEST_VERSION,
  parseOrchestrationPlan,
  filterOrchestrationParams,
  buildDemoOrchestrationPlan,
  routeOrchestrationScene,
  validateSkillManifestDetailed,
  type OrchestrationPlan,
  type SkillManifest,
} from '../../canvas/contract.ts'
import { orchestrationPlanToSkillManifest } from '../../canvas/planToSkill.ts'
import {
  installSkill,
  readSkillLibrary,
  setSkillEnabled,
  uninstallSkill,
  type InstalledSkill,
  type SkillSource,
} from '../../canvas/skillLibrary.ts'
import { chatCompletionsText } from '../../ai/client.ts'
import { TOKEN_STORAGE_KEY, type TokenConfig } from '../../types.ts'
import './skillMarket.css'

/**
 * E2 Skill 市场（CANVAS_PLAN.md §9 E2，Miora 图5 1:1 回炉）
 *
 * 诚实红线：
 * - 无真实社区市场 → 卡片**不显示下载量**，官方卡以「官方」徽章替代；
 * - 「发布 Skill」= 导出该 Skill 的 manifest JSON 到本机（复用 S1 导出语义），
 *   UI 如实标注「发布到本地」，绝不虚构社区发布通道；
 * - 全部数据来自本地已安装库与内置 OFFICIAL_SKILLS，零虚构生态数据。
 *
 * toggle 启停语义（dev 裁量）：停用的官方 Skill 从画布工具条快捷入口消失
 * （由父组件按库状态过滤），不影响画布上已布置的节点。
 */

type Props = {
  onClose: () => void
  /** 布置到画布（复用 S2 applySkillImport 链路）；未提供时「布置」按钮不渲染 */
  onDeploy?: (manifest: SkillManifest) => void
  /** 库发生任何变化（安装/卸载/启停）后通知父组件刷新官方快捷按钮 */
  onChanged?: () => void
}

type FilterKey = 'all' | 'official' | 'import' | 'conversation'

const SOURCE_BADGE: Record<SkillSource, string> = {
  official: '官方',
  import: '导入',
  conversation: '对话创建',
}

export const SkillMarketView: React.FC<Props> = ({ onClose, onDeploy, onChanged }) => {
  const [entries, setEntries] = useState<InstalledSkill[]>(() => readSkillLibrary())
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createText, setCreateText] = useState('')
  const [creating, setCreating] = useState(false)
  const [createMode, setCreateMode] = useState<'llm' | 'demo' | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const installedNames = useMemo(
    () => new Set(entries.map((e) => e.manifest.name.trim())),
    [entries]
  )
  const notInstalled = useMemo(
    () => OFFICIAL_SKILLS.filter((s) => !installedNames.has(s.manifest.name.trim())),
    [installedNames]
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (filter !== 'all' && e.source !== filter) return false
      if (!q) return true
      return (
        e.manifest.name.toLowerCase().includes(q) ||
        describeChain(e.manifest).toLowerCase().includes(q)
      )
    })
  }, [entries, filter, search])

  const sync = useCallback((next: InstalledSkill[]) => {
    setEntries(next)
    onChanged?.()
  }, [onChanged])

  const handleInstallOfficial = useCallback(
    (officialId: string) => {
      const skill = OFFICIAL_SKILLS.find((s) => s.id === officialId)
      if (!skill) return
      const r = installSkill(entries, skill.manifest, 'official')
      if (!r.ok) {
        setNotice({ kind: 'err', text: r.reason })
        return
      }
      sync(r.entries)
      setNotice({ kind: 'ok', text: `✓ 已安装「${skill.manifest.name}」（官方内置，无下载量统计）` })
    },
    [entries, sync]
  )

  const handleUploadFile = useCallback(
    async (file: File) => {
      try {
        const raw: unknown = JSON.parse(await file.text())
        const check = validateSkillManifestDetailed(raw)
        if (!check.ok) {
          setNotice({ kind: 'err', text: `⛔ 安装失败：${check.reason}` })
          return
        }
        const r = installSkill(entries, check.manifest, 'import')
        if (!r.ok) {
          setNotice({ kind: 'err', text: r.reason })
          return
        }
        sync(r.entries)
        setNotice({ kind: 'ok', text: `✓ 已安装「${check.manifest.name}」（来源：文件导入）` })
      } catch (err) {
        setNotice({
          kind: 'err',
          text: `⛔ 安装失败：${err instanceof Error ? err.message : '文件不是合法 JSON'}`,
        })
      }
    },
    [entries, sync]
  )

  const handleToggle = useCallback(
    (entry: InstalledSkill) => {
      const next = setSkillEnabled(entries, entry.id, !entry.enabled)
      if (next) sync(next)
    },
    [entries, sync]
  )

  const handleUninstall = useCallback(
    (entry: InstalledSkill) => {
      const next = uninstallSkill(entries, entry.id)
      if (next) {
        sync(next)
        setNotice({ kind: 'ok', text: `✓ 已卸载「${entry.manifest.name}」（画布上已布置的节点不受影响）` })
      }
    },
    [entries, sync]
  )

  /** 「发布 Skill」= 下载 manifest JSON 到本机（S1 导出语义，无社区通道） */
  const handlePublish = useCallback(
    (entry: InstalledSkill) => {
      try {
        const blob = new Blob([JSON.stringify(entry.manifest, null, 2)], {
          type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${entry.manifest.name.replace(/[\\/:*?"<>|]/g, '_')}.wls-skill.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setNotice({
          kind: 'ok',
          text: `✓ 「${entry.manifest.name}」已发布到本地（下载 Skill 包）· 当前无社区发布通道`,
        })
        setPublishOpen(false)
      } catch (err) {
        setNotice({
          kind: 'err',
          text: `发布失败：${err instanceof Error ? err.message : '未知错误'}`,
        })
      }
    },
    []
  )

  /** 通过对话创建技能：与画布对话栏 B6 同源编排（真实 LLM / 演示降级 + 诚实标注）→ manifest 入库 */
  const handleCreate = useCallback(async () => {
    const text = createText.trim()
    if (!text || creating) return
    setCreating(true)
    setNotice(null)
    try {
      let token: TokenConfig | null = null
      try {
        const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
        if (raw) token = JSON.parse(raw) as TokenConfig
      } catch {}
      const hasKey = Boolean(token?.apiKey?.trim())
      const scene = routeOrchestrationScene(text)

      let plan: OrchestrationPlan | null = null
      let mode: 'llm' | 'demo' = 'demo'
      if (hasKey && token) {
        // 与 B6 编排同一 system 约束（kind 枚举 / brief 首节点 / scriptScene 枚举）
        const systemPrompt = `你是创意画布的编排助手。根据用户需求输出一个严格 JSON 对象（不加 Markdown 围栏）：
{
  "title": "编排主题（20字内）",
  "nodes": [{ "kind": "节点类型", "params": { } }],
  "edges": [{ "from": 0, "to": 1 }]
}
硬约束：
1. kind 只能取：brief, product, script, storyboard, generate, deliver；
2. nodes 数量 2~5 个，第一个节点必须是 brief，其 params.text 为用户需求的完整原文；
3. edges 用 nodes 数组下标连线，from 不得等于 to；
4. script 节点 params.scriptScene 只能取：ecommerce（带货）/ brand（品牌） / drama（短剧）之一；
5. 其余节点 params 留空对象。`
        for (let attempt = 0; attempt < 2; attempt++) {
          const raw = await chatCompletionsText(token, [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ])
          const parsed = parseOrchestrationPlan(raw)
          if (parsed) {
            plan = {
              title: parsed.title,
              nodes: parsed.nodes.map((n) => ({
                kind: n.kind,
                params: filterOrchestrationParams(n.kind, n.params),
              })),
              edges: parsed.edges,
            }
            mode = 'llm'
            break
          }
        }
      }
      if (!plan) plan = buildDemoOrchestrationPlan(text, scene)
      setCreateMode(mode)

      const conv = orchestrationPlanToSkillManifest(plan, plan.title || text)
      if (!conv.ok) {
        setNotice({ kind: 'err', text: `⛔ 转换失败：${conv.reason}` })
        return
      }
      const r = installSkill(entries, conv.manifest, 'conversation')
      if (!r.ok) {
        setNotice({ kind: 'err', text: r.reason })
        return
      }
      sync(r.entries)
      setCreateOpen(false)
      setCreateText('')
      setNotice({
        kind: 'ok',
        text:
          `✓ 已创建并安装「${conv.manifest.name}」：${conv.manifest.nodes.length} 节点 / ${conv.manifest.edges.length} 边 · ` +
          (mode === 'llm' ? 'LLM 编排' : '🧪 演示编排 · 非真实 LLM（0 Key 演示模式）'),
      })
    } catch (err) {
      setNotice({
        kind: 'err',
        text: `创建失败：${err instanceof Error ? err.message : '未知错误'}`,
      })
    } finally {
      setCreating(false)
    }
  }, [createText, creating, entries, sync])

  const cardIcon = (manifest: SkillManifest, fallback: string): string => {
    const first = manifest.nodes[0]
    return first ? CANVAS_NODE_META[first.kind].icon : fallback
  }

  const publishCandidates = publishOpen ? entries : []

  return (
    <div className="sm-root" data-testid="skill-market-view" role="dialog" aria-label="Skill 市场">
      <div className="sm-header">
        <div className="sm-header-left">
          <h2>Skills</h2>
          <input
            type="text"
            className="sm-search"
            placeholder="搜索 Skill"
            aria-label="搜索 Skill"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="sm-header-actions">
          <button
            type="button"
            className="sm-btn"
            data-testid="sm-upload"
            onClick={() => uploadInputRef.current?.click()}
          >
            ⬆ 上传 skill
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="选择 Skill 包文件"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleUploadFile(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="sm-btn"
            data-testid="sm-create-toggle"
            onClick={() => setCreateOpen((v) => !v)}
          >
            💬 通过对话创建技能
          </button>
          <button
            type="button"
            className="sm-btn sm-btn--primary"
            data-testid="sm-publish"
            title="发布到本地（下载 Skill 包 JSON）· 当前无社区发布通道"
            onClick={() => {
              if (entries.length === 0) {
                setNotice({ kind: 'err', text: '还没有已安装的 Skill，先安装或创建一个' })
                return
              }
              setPublishOpen((v) => !v)
            }}
          >
            🚀 发布 Skill
          </button>
          <button type="button" className="sm-btn sm-btn--close" data-testid="sm-close" aria-label="关闭 Skill 市场" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {/* 来源过滤 chips（真实来源分组，非虚构「市场安装」） */}
      <div className="sm-filters" role="tablist" aria-label="来源过滤">
        {(
          [
            ['all', '全部'],
            ['official', '官方'],
            ['conversation', '对话创建'],
            ['import', '导入'],
          ] as [FilterKey, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={`sm-chip${filter === key ? ' active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && (
        <div
          className={`sm-notice ${notice.kind}`}
          role="status"
          data-testid="sm-notice"
        >
          {notice.text}
          <button type="button" className="sm-notice-close" aria-label="关闭提示" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      {createOpen && (
        <div className="sm-create-panel" data-testid="sm-create-panel">
          <label className="sm-create-label" htmlFor="sm-create-input">
            描述你想要的创作流，Agent 编排后沉淀为可复用 Skill：
          </label>
          <textarea
            id="sm-create-input"
            className="sm-create-textarea"
            value={createText}
            maxLength={500}
            placeholder="例如：帮我校服新品做一条带货短视频，从卖点讲解到成片交付"
            onChange={(e) => setCreateText(e.target.value)}
          />
          <div className="sm-create-row">
            <span className="sm-create-hint">
              {(() => {
                try {
                  const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
                  const token = raw ? (JSON.parse(raw) as TokenConfig) : null
                  return token?.apiKey?.trim()
                    ? '已配置 LLM Key：将真实编排生成'
                    : '未配置 LLM Key：走演示编排（诚实标注，可后续在画布验证）'
                } catch {
                  return '未配置 LLM Key：走演示编排'
                }
              })()}
            </span>
            <button
              type="button"
              className="sm-btn sm-btn--primary"
              data-testid="sm-create-submit"
              disabled={creating || !createText.trim()}
              onClick={() => void handleCreate()}
            >
              {creating ? '🤖 编排中…' : '生成 Skill'}
            </button>
          </div>
          {createMode && (
            <small className="sm-create-hint">
              上次生成模式：{createMode === 'llm' ? 'LLM 编排' : '🧪 演示编排 · 非真实 LLM'}
            </small>
          )}
        </div>
      )}

      {publishOpen && (
        <div className="sm-publish-panel" data-testid="sm-publish-panel">
          <div className="sm-section-title">选择要发布（下载到本地）的 Skill：</div>
          {publishCandidates.map((e) => (
            <button
              key={e.id}
              type="button"
              className="sm-publish-item"
              onClick={() => handlePublish(e)}
            >
              {cardIcon(e.manifest, '🧩')} {e.manifest.name}
              <span className="sm-publish-meta">
                {e.manifest.nodes.length} 节点 · v{SKILL_MANIFEST_VERSION}
              </span>
            </button>
          ))}
          <small className="sm-create-hint">发布 = 下载 Skill 包到本机 · 当前无社区发布通道（诚实标注）</small>
        </div>
      )}

      {/* 已安装分区 */}
      <section className="sm-section">
        <h3 className="sm-section-title">已安装（{entries.length}）</h3>
        {visible.length === 0 ? (
          <p className="sm-empty" data-testid="sm-installed-empty">
            {entries.length === 0
              ? '还没有已安装的 Skill：可从下方官方内置安装、上传 Skill 包，或通过对话创建'
              : '没有符合过滤条件的已安装 Skill'}
          </p>
        ) : (
          <div className="sm-grid">
            {visible.map((e) => (
              <article key={e.id} className={`sm-card${e.enabled ? '' : ' disabled'}`} data-testid="sm-installed-card">
                <div className="sm-card-head">
                  <span className="sm-card-icon" aria-hidden>
                    {cardIcon(e.manifest, '🧩')}
                  </span>
                  <div className="sm-card-title-wrap">
                    <h4 className="sm-card-title">{e.manifest.name}</h4>
                    <span className="sm-card-version">v{SKILL_MANIFEST_VERSION}</span>
                    {e.source === 'official' && <span className="sm-badge sm-badge--official">官方</span>}
                    {e.source !== 'official' && (
                      <span className="sm-badge">{SOURCE_BADGE[e.source]}</span>
                    )}
                  </div>
                  {/* toggle 启停：停用 = 从画布官方快捷入口消失（不影响已布置节点） */}
                  <button
                    type="button"
                    className={`sm-toggle${e.enabled ? ' on' : ''}`}
                    role="switch"
                    aria-checked={e.enabled}
                    aria-label={`${e.enabled ? '停用' : '启用'} ${e.manifest.name}`}
                    data-testid="sm-card-toggle"
                    onClick={() => handleToggle(e)}
                  >
                    <span className="sm-toggle-knob" aria-hidden />
                  </button>
                </div>
                <p className="sm-card-desc">{describeChain(e.manifest)}</p>
                <div className="sm-card-actions">
                  {onDeploy && (
                    <button
                      type="button"
                      className="sm-card-btn sm-card-btn--primary"
                      data-testid="sm-card-deploy"
                      onClick={() => {
                        onDeploy(e.manifest)
                      }}
                    >
                      ⬆ 布置到画布
                    </button>
                  )}
                  <button
                    type="button"
                    className="sm-card-btn"
                    title="发布到本地（下载 Skill 包 JSON）"
                    onClick={() => handlePublish(e)}
                  >
                    📤 发布到本地
                  </button>
                  <button
                    type="button"
                    className="sm-card-btn sm-card-btn--danger"
                    data-testid="sm-card-uninstall"
                    onClick={() => handleUninstall(e)}
                  >
                    🗑 卸载
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 未安装分区：官方内置（无下载量字段——诚实红线） */}
      <section className="sm-section">
        <h3 className="sm-section-title">未安装（{notInstalled.length}）</h3>
        {notInstalled.length === 0 ? (
          <p className="sm-empty">官方内置 Skill 已全部安装</p>
        ) : (
          <div className="sm-grid">
            {notInstalled.map((s) => (
              <article key={s.id} className="sm-card" data-testid="sm-notinstalled-card">
                <div className="sm-card-head">
                  <span className="sm-card-icon" aria-hidden>
                    {s.icon}
                  </span>
                  <div className="sm-card-title-wrap">
                    <h4 className="sm-card-title">{s.manifest.name}</h4>
                    <span className="sm-card-version">v{SKILL_MANIFEST_VERSION}</span>
                    <span className="sm-badge sm-badge--official">官方 · 内置</span>
                  </div>
                  <button
                    type="button"
                    className="sm-install-btn"
                    data-testid={`sm-install-${s.id}`}
                    title={`安装「${s.manifest.name}」到本机库（官方内置，无下载量统计）`}
                    onClick={() => handleInstallOfficial(s.id)}
                  >
                    ＋
                  </button>
                </div>
                <p className="sm-card-desc">{s.manifest.name}：{s.description}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="sm-footnote" data-testid="sm-footnote">
        本地 Skill 库 · 无社区市场与下载量 · 「发布」= 下载 Skill 包到本机 · 启停仅控制画布快捷入口
      </div>
    </div>
  )
}

/** 卡片描述：节点链 label（真实 manifest 内容，非编造文案） */
function describeChain(manifest: SkillManifest): string {
  const labels = manifest.nodes
    .map((n) => CANVAS_NODE_META[n.kind]?.label ?? n.kind)
    .join(' → ')
  return `${labels}（${manifest.nodes.length} 节点 · ${manifest.edges.length} 连线）`
}
