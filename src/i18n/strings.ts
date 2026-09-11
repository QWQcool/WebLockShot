/**
 * 界面文案字典（CANVAS_PLAN.md §9 I1：中英双语，默认中文零回归）。
 *
 * 设计取舍：
 * - **默认中文**：`DEFAULT_LANGUAGE = 'zh'`，未显式切换时行为与改造前完全一致（零回归）。
 * - **单一来源**：中文是源字典，英文是 `Record<keyof typeof ZH, string>`——**少一个键就编译不过**，
 *   配合 `src/i18n/__tests__/i18n.test.ts` 的键对齐断言，杜绝「漏译静默回退」。
 * - **纯函数**：不依赖 React / DOM，`node --test` 可直接跑。
 * - **范围（诚实标注）**：本文件覆盖「顶栏 / 工具条 / 节点面板 / 对话栏 / 开场层 / 设置面板骨架」。
 *   节点内部业务控件、Skill 市场 / 记忆图谱 / 连接器 / 3D 台的深度文案仍为中文，
 *   属于后续可增量补齐的部分（见 docs/i18n.md）。
 */
import { CANVAS_NODE_KINDS, type CanvasNodeKind } from '../canvas/contract.ts'

export const LANGUAGES = ['zh', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = 'zh'

/** 中文源字典（键即契约） */
const ZH = {
  'app.brand': 'WebLockShot · Agent 创意画布',
  'app.subtitle': 'Agent 创意画布 · 自由创作空间',

  'mode.aria': '工作模式',
  'mode.sell': '🎯 带货工作台',
  'mode.drama': '🎭 剧情短剧',
  'mode.canvas': '🎨 Agent 画布',

  'project.aria': '画布项目',
  'project.new': '＋ 新项目',
  'project.newTitle': '新建画布项目（独立存储，切换不串数据）',
  'project.delete': '🗑 删除项目',
  'project.deleteTitle': '删除当前项目（至少保留一个）',
  'project.nameAria': '画布名称',
  'project.newPrompt': '新项目名称：',
  'project.defaultName': '项目 {n}',
  'project.deleteConfirm': '删除项目「{name}」？该项目的画布内容将一并删除。',

  'toolbar.exportSkill': '📦 导出 Skill',
  'toolbar.exportSkillNeedTwo': '框选 ≥2 个画布节点后可导出 Skill 包（产物/大资产字段自动剥离）',
  'toolbar.exportSkillReady': '导出选中的 {n} 个节点为 Skill 包（JSON 下载）',
  'toolbar.importSkill': '📥 导入 Skill',
  'toolbar.importSkillTitle':
    '导入 Skill 包 JSON：校验通过后整批上画布（可一键撤销），入口节点高亮「填新输入」',
  'toolbar.clear': '🧹 清空画布',
  'toolbar.memory': '🧠 记忆图谱',
  'toolbar.memoryTitle': '记忆图谱：真实回流记录可视化（暗色全屏视图，摆样例数据为零）',
  'toolbar.market': '🧩 Skill 市场',
  'toolbar.marketTitle': 'Skill 市场：已安装/官方内置统一管理（安装/启停/卸载/发布到本地）',
  'toolbar.connectors': '🔌 连接器',
  'toolbar.connectorsTitle': '连接器：推荐连接器目录 + 自定义添加（本期仅接口 + 协议层 mock，未接入）',
  'toolbar.scenes': '🎬 创作场景',
  'toolbar.scenesTitle': '创作场景：六类创作场景卡片（点击预填对话栏 / 一键编排，复用 B6 编排路由）',
  'toolbar.mcpReady': '🤖 MCP 已就绪',
  'toolbar.mcpReadyTitle': 'MCP 反向驱动已就绪：本地 Agent 可读取画布拓扑并建节点/连线',
  'toolbar.savedAt': '已保存 {time}',
  'toolbar.langTitle': '切换界面语言（中 / 英，持久化；默认中文）',

  'palette.aria': 'Agent 节点面板',
  'palette.title': 'Agent 节点',
  'palette.tip': '点击添加节点到画布中央；尚未实现的节点会如实标注（占位，不装可用）。',

  'node.badge.ready': '就绪',
  'node.badge.pending': '待接通',
  'node.badge.unimplemented': '未实现',
  'node.lockedNote': '该节点尚未实现：当前仅作流程占位，点击不会产生内容。',
  'node.skillInputHint': 'Skill 导入：此节点的输入未填写，请补全后再运行',
  'node.fillNewInput': '📥 填新输入：',
  'node.asset.empty': '尚无产物：连入「视频生成」节点出片后自动写入',

  'chat.aria': '对话栏：一句话生成 Brief 节点',
  'chat.placeholder': '描述你想要什么，Agent 帮你上画布…',
  'chat.placeholderBusy': '🤖 Agent 正在布置画布，请稍候…',
  'chat.send': '发送 ↗',
  'chat.sendBusy': '🤖 编排中…',
  'chat.collapse': '收起对话栏',
  'chat.collapseTitle': '收起对话栏（露出底部工具条）',
  'chat.expand': '💬 对话',

  'canvas.emptyHint':
    '对话栏一句话 → 自动布置节点与连线 · 节点内可直接生成脚本 / 分镜 / 出片 · 3D 运镜台本地渲染不耗积分 · 水印与生产环境约 5 秒停渲染为 tldraw 免费版限制',

  'orch.busy': '🤖 Agent 正在布置画布，请稍候…',
  'orch.llm': '✓ LLM 编排',
  'orch.demo': '🧪 演示编排 · 非真实 LLM',
  'orch.placed': '：已布置 {n} 个节点、{e} 条连线',
  'orch.degraded': '（LLM 编排不合格，已降级演示）',
  'orch.failed': '⚠️ 编排失败：{msg}',
  'orch.undo': '↩️ 撤销本次编排',
  'orch.imported': '✓ 已导入 Skill「{name}」：{n} 节点 / {e} 边 · 入口节点请「填新输入」（其余参数延续），产物需重新生成',

  'onboarding.title': 'Agent 创意画布',
  'onboarding.subtitle': '一句话描述你想要什么，Agent 帮你把创作流程摆上画布',
  'onboarding.tabsAria': '创作场景',
  'onboarding.inputPlaceholder': '描述你的创作需求，例如：给「填入商品」拍一条 30 秒竖屏带货短视频…',
  'onboarding.inputHint': 'Enter 发送 · Shift+Enter 换行 · 无 LLM Key 时走「演示编排 · 非真实 LLM」并如实标注',
  'onboarding.send': '↗ 发送',
  'onboarding.connectorsLabel': '🔌 将你的常用应用接入',
  'onboarding.connectorTitle': '{name}（未接入 · 点击查看连接器面板）',
  'onboarding.connectorAria': '{name}（未接入）',
  'onboarding.connectorsMore': '全部连接器 →',
  'onboarding.enter': '进入画布 →',
  'onboarding.moreScenes': '更多创作场景 →',
  'onboarding.actionsNote': '首次进入显示本页；之后折叠为底部对话栏',

  'settings.title': 'API 与模型接入设置',
  'settings.langSection': '0. 界面语言（Language）',
  'settings.langZh': '中文',
  'settings.langEn': 'English',
  'settings.langHint': '语言切换即时生效并持久化；默认中文，不影响任何业务数据。',
  'settings.sectionLlm': '1. 大语言模型（LLM）配置（提示词扩写 & 编导审稿）',
  'settings.sectionVideo': '2. 视频生成引擎（Media Provider）',
  'settings.sectionMemory': '3. 记忆（回流偏好 · 结构化胜率）',

  'node.brief.label': '需求 Brief',
  'node.brief.hint': '一句话需求：想做什么、给谁看、突出什么（对话栏可直接生成）',
  'node.product.label': '素材导入',
  'node.product.hint': '商品图 / 参考图 / 视频 / 链接统一入口（本地读取，直接产出图片产物卡）',
  'node.image.label': '图像生成',
  'node.image.hint': '尚未实现：规划中的 ComfyUI 文生图 / 图生图（当前为占位节点，不装可用）',
  'node.script.label': '脚本创编',
  'node.script.hint': 'ScriptWriter + Critic 双智体：带货口播 / 剧情台词 / 品牌叙事（连入 Brief 或手动输入需求）',
  'node.storyboard.label': '分镜预演',
  'node.storyboard.hint': '连入 script 节点后一键生成 6 镜分镜，内嵌 9:16 GSAP 预演（本地预演 · 非成片）',
  'node.generate.label': '视频生成',
  'node.generate.hint': '连入 storyboard 后逐镜生成（ExecutorEngine 串行队列，钱包事务原样生效）',
  'node.asset.label': '产物卡',
  'node.asset.hint': '单镜出片产物（视频卡，大资产入 IndexedDB），可连线送入成片交付',
  'node.edit.label': '局部重绘',
  'node.edit.hint': '连入产物卡（图片/视频单帧）后笔刷 / 框选涂抹重绘区，导出 mask PNG 供重绘',
  'node.stage3d.label': '3D 运镜台',
  'node.stage3d.hint': '已开放：摆角色 / 调机位 / 录关键帧，全程本地渲染不耗积分',
  'node.deliver.label': '成片交付',
  'node.deliver.hint': '产物送入剪映草稿三轨对齐链路 / 直接导出',

  'template.ecommerce.label': '带货短视频',
  'template.brand.label': '品牌视觉',
  'template.drama.label': '短剧分镜',
  'template.game.label': '游戏宣传',
  'template.app.label': 'App 界面',

  'onboardingTab.brand-design.label': '品牌设计',
  'onboardingTab.film-creative.label': '影视创意',
  'onboardingTab.ecommerce-ad.label': '电商广告',
  'onboardingTab.interactive-game.label': '互动游戏',
  'onboardingTab.web-app.label': '网页应用',

  'error.title': '界面渲染异常',
  'error.body': '本次渲染已中止，避免整页白屏。你的画布内容与本地数据不会因此丢失。',
  'error.where': '出问题的区域：{area}',
  'error.detail': '技术细节：{msg}',
  'error.retry': '↻ 重试',
  'error.reload': '↻ 重新加载页面',

  'tldraw.gate.title': '⚠️ tldraw 编辑器已停止渲染（第三方许可限制，非本项目缺陷）',
  'tldraw.gate.body':
    '当前是生产环境（https 且非本地地址）且未配置 tldraw license key。按 tldraw 许可条款，编辑器会在约 5 秒后停止渲染：画布与 tldraw 自带工具条会消失，但你的画布数据仍保存在本地（IndexedDB / localStorage 未受影响），刷新或配置授权后可继续编辑。',
  'tldraw.gate.devNote': '本地开发与本地预览（http 协议，或 localhost / 127.0.0.1）不受影响。',
  'tldraw.gate.fix':
    '官方解决路径：构建时注入 VITE_TLDRAW_LICENSE_KEY（需自行向 tldraw 购买授权），或替换为 MIT 许可的画布引擎。本项目不提供任何绕过许可校验 / 去水印的手段，详见 NOTICE。',
  'tldraw.gate.dismiss': '知道了',
} as const

export type MessageKey = keyof typeof ZH

/** 英文译文字典：键必须与中文源字典完全一致（缺键即编译错误） */
const EN: Record<MessageKey, string> = {
  'app.brand': 'WebLockShot · Agent Canvas',
  'app.subtitle': 'Agent Canvas · free-form creative space',

  'mode.aria': 'Workspace mode',
  'mode.sell': '🎯 Commerce Studio',
  'mode.drama': '🎭 Drama Studio',
  'mode.canvas': '🎨 Agent Canvas',

  'project.aria': 'Canvas project',
  'project.new': '+ New project',
  'project.newTitle': 'Create a canvas project (isolated storage, no data bleed between projects)',
  'project.delete': '🗑 Delete project',
  'project.deleteTitle': 'Delete the current project (at least one project is always kept)',
  'project.nameAria': 'Canvas name',
  'project.newPrompt': 'New project name:',
  'project.defaultName': 'Project {n}',
  'project.deleteConfirm': 'Delete project “{name}”? Its canvas content will be deleted as well.',

  'toolbar.exportSkill': '📦 Export Skill',
  'toolbar.exportSkillNeedTwo':
    'Box-select at least 2 canvas nodes to export a Skill package (artifacts / heavy assets are stripped)',
  'toolbar.exportSkillReady': 'Export the selected {n} nodes as a Skill package (JSON download)',
  'toolbar.importSkill': '📥 Import Skill',
  'toolbar.importSkillTitle':
    'Import a Skill package (JSON): after validation the whole batch is placed on the canvas (single undo), entry nodes highlight “fill new input”',
  'toolbar.clear': '🧹 Clear canvas',
  'toolbar.memory': '🧠 Memory graph',
  'toolbar.memoryTitle': 'Memory graph: visualization of real feedback records (dark full-screen view, never seeded with sample data)',
  'toolbar.market': '🧩 Skill Market',
  'toolbar.marketTitle': 'Skill Market: manage installed and built-in Skills (install / enable / uninstall / publish locally)',
  'toolbar.connectors': '🔌 Connectors',
  'toolbar.connectorsTitle': 'Connectors: recommended catalog + custom entries (interface + protocol mock only in this phase, not wired up)',
  'toolbar.scenes': '🎬 Scene Gallery',
  'toolbar.scenesTitle': 'Scene Gallery: six creative-scene cards (prefill the chat bar, or orchestrate in one click via the B6 route)',
  'toolbar.mcpReady': '🤖 MCP ready',
  'toolbar.mcpReadyTitle': 'MCP reverse driving is ready: a local Agent can read the canvas topology and create nodes/edges',
  'toolbar.savedAt': 'Saved {time}',
  'toolbar.langTitle': 'Switch interface language (Chinese / English, persisted; Chinese is the default)',

  'palette.aria': 'Agent node palette',
  'palette.title': 'Agent nodes',
  'palette.tip':
    'Click to add a node at the center of the canvas; nodes that are not implemented yet are honestly labeled (placeholder, not usable).',

  'node.badge.ready': 'Ready',
  'node.badge.pending': 'Pending wiring',
  'node.badge.unimplemented': 'Not implemented',
  'node.lockedNote': 'This node is not implemented yet: it is a placeholder in the flow and produces nothing.',
  'node.skillInputHint': 'Skill import: this node still needs input — fill it in before running',
  'node.fillNewInput': '📥 Fill new input: ',
  'node.asset.empty': 'No artifact yet: it is written automatically once the upstream “Video generation” node renders',

  'chat.aria': 'Chat bar: one sentence becomes a Brief node',
  'chat.placeholder': 'Describe what you want and the Agent will lay it out on the canvas…',
  'chat.placeholderBusy': '🤖 The Agent is laying out the canvas, please wait…',
  'chat.send': 'Send ↗',
  'chat.sendBusy': '🤖 Orchestrating…',
  'chat.collapse': 'Collapse chat bar',
  'chat.collapseTitle': 'Collapse the chat bar (reveals the bottom toolbar)',
  'chat.expand': '💬 Chat',

  'canvas.emptyHint':
    'One sentence in the chat bar lays out nodes and edges · nodes generate scripts / storyboards / shots in place · the 3D camera stage renders locally at no cost · the watermark and the ~5s stop in production come from the tldraw free tier',

  'orch.busy': '🤖 The Agent is laying out the canvas, please wait…',
  'orch.llm': '✓ LLM orchestration',
  'orch.demo': '🧪 Demo orchestration · not a real LLM',
  'orch.placed': ': placed {n} nodes and {e} edges',
  'orch.degraded': ' (LLM plan failed validation, fell back to demo)',
  'orch.failed': '⚠️ Orchestration failed: {msg}',
  'orch.undo': '↩️ Undo this orchestration',
  'orch.imported': '✓ Imported Skill “{name}”: {n} nodes / {e} edges · fill new input on entry nodes (other params carry over); artifacts must be regenerated',

  'onboarding.title': 'Agent Canvas',
  'onboarding.subtitle': 'Describe what you want in one sentence and the Agent lays the creative flow out on the canvas',
  'onboarding.tabsAria': 'Creative scenes',
  'onboarding.inputPlaceholder':
    'Describe your creative need, e.g. “shoot a 30-second vertical commerce video for {product}…”',
  'onboarding.inputHint':
    'Enter to send · Shift+Enter for a new line · without an LLM key it runs “demo orchestration · not a real LLM” and says so',
  'onboarding.send': '↗ Send',
  'onboarding.connectorsLabel': '🔌 Connect your everyday apps',
  'onboarding.connectorTitle': '{name} (not connected · click to open the connector panel)',
  'onboarding.connectorAria': '{name} (not connected)',
  'onboarding.connectorsMore': 'All connectors →',
  'onboarding.enter': 'Enter canvas →',
  'onboarding.moreScenes': 'More creative scenes →',
  'onboarding.actionsNote': 'Shown on first visit; afterwards it collapses into the bottom chat bar',

  'settings.title': 'API & Model Settings',
  'settings.langSection': '0. Interface language',
  'settings.langZh': '中文',
  'settings.langEn': 'English',
  'settings.langHint': 'The switch applies immediately and is persisted; Chinese stays the default and no business data is affected.',
  'settings.sectionLlm': '1. Large language model (LLM) — prompt expansion & script review',
  'settings.sectionVideo': '2. Video generation engine (Media Provider)',
  'settings.sectionMemory': '3. Memory (feedback preferences · structured win rates)',

  'node.brief.label': 'Requirement Brief',
  'node.brief.hint': 'One-sentence requirement: what to make, for whom, what to highlight (the chat bar can create it directly)',
  'node.product.label': 'Asset import',
  'node.product.hint': 'Single entry for product images / references / videos / links (read locally, produces image artifact cards)',
  'node.image.label': 'Image generation',
  'node.image.hint': 'Not implemented yet: planned ComfyUI text-to-image / image-to-image (placeholder node, not usable)',
  'node.script.label': 'Script writing',
  'node.script.hint': 'ScriptWriter + Critic duo: commerce voice-over / drama lines / brand narrative (connect a Brief or type the requirement)',
  'node.storyboard.label': 'Storyboard preview',
  'node.storyboard.hint': 'Connect a script node to generate a 6-shot storyboard with an embedded 9:16 GSAP preview (local preview · not a final render)',
  'node.generate.label': 'Video generation',
  'node.generate.hint': 'Connect a storyboard to render shot by shot (ExecutorEngine serial queue, wallet transactions apply as-is)',
  'node.asset.label': 'Artifact card',
  'node.asset.hint': 'Single-shot output (video card; heavy assets go to IndexedDB) that can be wired into delivery',
  'node.edit.label': 'Local repaint',
  'node.edit.hint': 'Connect an artifact card (image / video frame), paint the region with brush or lasso, export a mask PNG for repainting',
  'node.stage3d.label': '3D camera stage',
  'node.stage3d.hint': 'Available: place characters / set cameras / record keyframes; fully local rendering, no credits',
  'node.deliver.label': 'Delivery',
  'node.deliver.hint': 'Send artifacts into the CapCut/Jianying three-track alignment pipeline, or export directly',

  'template.ecommerce.label': 'Commerce short video',
  'template.brand.label': 'Brand visuals',
  'template.drama.label': 'Drama storyboard',
  'template.game.label': 'Game promo',
  'template.app.label': 'App UI',

  'onboardingTab.brand-design.label': 'Brand design',
  'onboardingTab.film-creative.label': 'Film & creative',
  'onboardingTab.ecommerce-ad.label': 'Commerce ads',
  'onboardingTab.interactive-game.label': 'Interactive games',
  'onboardingTab.web-app.label': 'Web apps',

  'error.title': 'Interface render error',
  'error.body': 'This render was aborted to avoid a blank page. Your canvas content and local data are not lost.',
  'error.where': 'Failing area: {area}',
  'error.detail': 'Technical detail: {msg}',
  'error.retry': '↻ Retry',
  'error.reload': '↻ Reload page',

  'tldraw.gate.title': '⚠️ tldraw editor stopped rendering (third-party license limit, not a bug in this project)',
  'tldraw.gate.body':
    'This is a production environment (https, non-local address) without a tldraw license key. Under the tldraw license the editor stops rendering after about 5 seconds: the canvas and tldraw’s own toolbars disappear, but your canvas data stays in local storage (IndexedDB / localStorage are untouched) and can be edited again after a reload or once a license is configured.',
  'tldraw.gate.devNote': 'Local development and local preview (http, or localhost / 127.0.0.1) are unaffected.',
  'tldraw.gate.fix':
    'Official paths forward: inject VITE_TLDRAW_LICENSE_KEY at build time (you must obtain a license from tldraw), or replace the canvas engine with an MIT-licensed one. This project does not ship any way to bypass license checks or remove the watermark — see NOTICE.',
  'tldraw.gate.dismiss': 'Got it',
}

const DICTS: Record<Language, Record<MessageKey, string>> = { zh: ZH, en: EN }

/** 中英键集合（供测试与工具断言键对齐） */
export const MESSAGE_KEYS = Object.keys(ZH) as MessageKey[]
export const EN_MESSAGE_KEYS = Object.keys(EN) as MessageKey[]

/**
 * 取文案：命中语言字典 → 命中中文源（英文缺键兜底）→ 原样返回键名（便于发现漏配）。
 * `{name}` 占位符由 params 替换；未提供的占位符原样保留（不静默清空）。
 */
export function t(
  lang: Language,
  key: MessageKey,
  params?: Record<string, string | number>
): string {
  const dict = DICTS[lang] ?? ZH
  const raw = dict[key] ?? ZH[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  )
}

/** 节点标签键（kind → 字典键） */
export function nodeLabelKey(kind: CanvasNodeKind): MessageKey {
  return `node.${kind}.label` as MessageKey
}

/** 节点提示键（kind → 字典键） */
export function nodeHintKey(kind: CanvasNodeKind): MessageKey {
  return `node.${kind}.hint` as MessageKey
}

/** 节点可用性徽标键（节点卡片徽标与左侧面板阶段标签共用同一口径） */
export function nodeAvailabilityKey(availability: 'ready' | 'pending' | 'locked'): MessageKey {
  if (availability === 'ready') return 'node.badge.ready'
  return availability === 'pending' ? 'node.badge.pending' : 'node.badge.unimplemented'
}

export function nodeLabel(lang: Language, kind: CanvasNodeKind): string {
  return t(lang, nodeLabelKey(kind))
}

export function nodeHint(lang: Language, kind: CanvasNodeKind): string {
  return t(lang, nodeHintKey(kind))
}

/** 对话栏场景模板标签（id → 字典键，未知 id 原样返回） */
export function templateLabel(lang: Language, id: string): string {
  const key = `template.${id}.label` as MessageKey
  return MESSAGE_KEYS.includes(key) ? t(lang, key) : id
}

/** 开场层场景 tab 标签（id → 字典键，未知 id 原样返回） */
export function onboardingTabLabel(lang: Language, id: string): string {
  const key = `onboardingTab.${id}.label` as MessageKey
  return MESSAGE_KEYS.includes(key) ? t(lang, key) : id
}

/** 节点文案覆盖率自检：每个 kind 都必须有中英标签与提示（供测试与开发期断言） */
export function nodeMessageKeysCovered(): { missing: string[] } {
  const missing: string[] = []
  for (const kind of CANVAS_NODE_KINDS) {
    for (const key of [nodeLabelKey(kind), nodeHintKey(kind)]) {
      if (!MESSAGE_KEYS.includes(key) || !EN_MESSAGE_KEYS.includes(key)) missing.push(key)
    }
  }
  return { missing }
}
