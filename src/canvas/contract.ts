import { z } from 'zod'
import { ScriptSchema } from '../domain/script.ts'
import { VisualPlanSchema, type VisualPlan } from '../domain/sellVisual.ts'
import { MOTION_IDS, PROP_IDS, SHOT_SIZES } from '../types.ts'

/**
 * CanvasDoc 数据契约（CANVAS_PLAN.md §3，一期冻结，只扩不破）。
 *
 * - 画布文档作为新的一种 session 实体持久化（localStorage 索引 + BackendAdapter 可选方法）；
 * - 节点业务 payload 一律走 zod 校验，非法数据拒绝入画布（不合格则整体拒绝，不半渲染）；
 * - 大资产（视频/图 blob）一期不进画布文档，节点 meta 只存轻量 JSON。
 */

export const CANVAS_DOC_KEY = 'weblockshot.canvas.v1' as const

export const CANVAS_NODE_KINDS = [
  'brief',
  'product',
  'image',
  'script',
  'storyboard',
  'generate',
  'asset',
  'edit',
  'stage3d',
  'deliver',
] as const

export type CanvasNodeKind = (typeof CANVAS_NODE_KINDS)[number]

/**
 * 对话栏快捷场景模板（对齐 Miora 图1 底部模板入口，定位多元化创意工作室而非只做电商带货）。
 * 一期 A：点击回填对话栏输入框；一期 B：接通 LLM 后按场景路由 Agent 编排。
 */
export const CANVAS_SCENE_TEMPLATES: { id: string; label: string; icon: string; prompt: string }[] = [
  {
    id: 'ecommerce',
    label: '带货短视频',
    icon: '🛒',
    prompt: '给「填入商品」拍一条 30 秒竖屏带货短视频：3 秒钩子开场、突出核心卖点、结尾引导下单',
  },
  {
    id: 'brand',
    label: '品牌视觉',
    icon: '🎨',
    prompt: '为一个新消费品牌设计一套视觉：Logo 方向、主视觉海报、社媒头图，风格统一可延展',
  },
  {
    id: 'drama',
    label: '短剧分镜',
    icon: '🎞️',
    prompt: '把一句话故事拆成 6 镜竖屏短剧分镜：人物、冲突、最后一镜留钩子',
  },
  {
    id: 'game',
    label: '游戏宣传',
    icon: '🎮',
    prompt: '为独立游戏做一支 20 秒宣传 PV：世界观快剪、技能特写、上架日期收尾',
  },
  {
    id: 'app',
    label: 'App 界面',
    icon: '📱',
    prompt: '设计一个记账 App 的核心三屏：首页、统计、设置，走清新插画风',
  },
]

/** 节点元数据：身份色条 / 图标 / 展示名 / 开放阶段（灰态节点点击给出诚实说明） */
export const CANVAS_NODE_META: Record<
  CanvasNodeKind,
  { label: string; icon: string; phase: '1A' | '1B' | '2' | '3'; accent: string; hint: string }
> = {
  brief: {
    label: '需求 Brief',
    icon: '🗒️',
    phase: '1A',
    accent: '#7ec8e3',
    hint: '一句话需求：想做什么、给谁看、突出什么（对话栏可直接生成）',
  },
  product: {
    label: '素材导入',
    icon: '📥',
    phase: '1B',
    accent: '#39c5bb',
    hint: '商品图 / 参考图 / 视频 / 链接统一入口（本地读取，直接产出图片产物卡）',
  },
  image: {
    label: '图像生成',
    icon: '🖼️',
    phase: '2',
    accent: '#ff7eb6',
    // 措辞校正（2026-09-11）：二期已收官但 image 节点未落地，原「二期开放」措辞会让用户以为
    // 该能力已随二期上线——如实改为「尚未实现」，不再引用已过去的期数。
    hint: '尚未实现：规划中的 ComfyUI 文生图 / 图生图（当前为占位节点，不装可用）',
  },
  script: {
    label: '脚本创编',
    icon: '📝',
    phase: '1B',
    accent: '#39c5bb',
    hint: 'ScriptWriter + Critic 双智体：带货口播 / 剧情台词 / 品牌叙事（连入 Brief 或手动输入需求）',
  },
  storyboard: {
    label: '分镜预演',
    icon: '🎞️',
    phase: '1B',
    accent: '#39c5bb',
    hint: '连入 script 节点后一键生成 6 镜分镜，内嵌 9:16 GSAP 预演（本地预演 · 非成片）',
  },
  generate: {
    label: '视频生成',
    icon: '⚙️',
    phase: '1B',
    accent: '#7ec8e3',
    hint: '连入 storyboard 后逐镜生成（ExecutorEngine 串行队列，钱包事务原样生效）',
  },
  asset: {
    label: '产物卡',
    icon: '🎬',
    phase: '1B',
    accent: '#7ec8e3',
    hint: '单镜出片产物（视频卡，大资产入 IndexedDB），可连线送入成片交付',
  },
  edit: {
    label: '局部重绘',
    icon: '🖌️',
    phase: '2',
    accent: '#ff7eb6',
    hint: '连入产物卡（图片/视频单帧）后笔刷 / 框选涂抹重绘区，导出 mask PNG 供重绘',
  },
  stage3d: {
    label: '3D 运镜台',
    icon: '🎥',
    phase: '3',
    accent: '#2aa8a0',
    // 措辞校正（2026-09-11）：D1~D7 已落地，节点**已可用**，原「三期开放」措辞
    // 会让用户以为尚未开放（与节点内可用的「进入 3D 运镜台」按钮自相矛盾）。
    hint: '已开放：摆角色 / 调机位 / 录关键帧，全程本地渲染不耗积分',
  },
  deliver: {
    label: '成片交付',
    icon: '✨',
    phase: '1B',
    accent: '#39c5bb',
    hint: '产物送入剪映草稿三轨对齐链路 / 直接导出',
  },
}

/** 节点可用性：'ready' 已实现 / 'pending' 待接通 / 'locked' 尚未实现（占位） */
export function nodeAvailability(kind: CanvasNodeKind): 'ready' | 'pending' | 'locked' {
  // B2 script / B3 storyboard / B4 generate+asset / B5 product+deliver / A1 edit 蜕壳接通
  // D1~D7 stage3d 蜕壳接通（2026-09-11 校正：节点早已可用，此前仍按 phase='3' 判为 locked，
  // 导致「已能进入 3D 运镜台」的节点被打上「3 期开放 / 仅摆放占位」的自相矛盾标注）
  if (
    kind === 'script' ||
    kind === 'storyboard' ||
    kind === 'generate' ||
    kind === 'asset' ||
    kind === 'product' ||
    kind === 'deliver' ||
    kind === 'edit' ||
    kind === 'stage3d'
  ) {
    return 'ready'
  }
  const phase = CANVAS_NODE_META[kind].phase
  if (phase === '1A') return 'ready'
  if (phase === '1B') return 'pending'
  return 'locked'
}

/** B6：已蜕壳（ready）的节点集合——LLM/演示编排只允许创建这些 kind（灰态节点不允许被编排创建） */
export const READY_NODE_KINDS: readonly CanvasNodeKind[] = CANVAS_NODE_KINDS.filter(
  (k) => nodeAvailability(k) === 'ready'
)

/** B6：各 ready 节点允许被编排预填的 meta 参数键白名单（按各自 payload 契约收窄） */
export const ORCHESTRATION_PARAM_KEYS: Record<string, readonly string[]> = {
  brief: ['text'],
  product: ['title'],
  script: ['scriptScene'],
  storyboard: [],
  generate: [],
  deliver: [],
  asset: [],
}

/* ------------------------------------------------------------------ *
 * B2 脚本创编节点契约（CANVAS_PLAN.md §9 B2）
 * ------------------------------------------------------------------ */

/** script 节点契约路由（三选一，对应结构库既有模板，不新写结构） */
export const CANVAS_SCRIPT_SCENES = ['ecommerce', 'drama', 'brand'] as const
export type CanvasScriptScene = (typeof CANVAS_SCRIPT_SCENES)[number]

export const SCRIPT_SCENE_LABEL: Record<CanvasScriptScene, string> = {
  ecommerce: '带货短视频',
  drama: '剧情短剧',
  brand: '品牌叙事',
}

/** 场景 → 结构库模板路由（模板 id 来自 src/prompts/library/structures.ts 的 STRUCTURE_TEMPLATES） */
export const SCRIPT_SCENE_TEMPLATE_ID: Record<CanvasScriptScene, string> = {
  ecommerce: 't1_pain_opening', // 痛点提问开场：经典带货转化结构
  drama: 't4_story_insert', // 短剧反转植入：剧情叙事
  brand: 't2_contrast_reveal', // 效果强烈反差：品牌视觉叙事
}

/** Critic 评审结果的 meta 载荷（对齐 CriticReviewResult 字段） */
export const scriptCriticMetaSchema = z.object({
  score: z.number().min(0).max(100),
  passed: z.boolean(),
  summary: z.string(),
  strengths: z.array(z.string()),
  suggestions: z.array(z.string()),
})

/**
 * script 节点生成结果的 meta 载荷（B2）：
 * Script 直接复用 src/domain/script.ts 的 zod 契约；demo=true 表示无 Key 演示模式
 * （本地规则引擎产物，评分非真实 LLM 质检，UI 必须如实标注）。
 */
export const scriptMetaPayloadSchema = z.object({
  scriptScene: z.enum(CANVAS_SCRIPT_SCENES),
  script: ScriptSchema,
  critic: scriptCriticMetaSchema,
  demo: z.boolean(),
  /** 生成时使用的需求文本快照（上游 Brief 或手动输入），用于「上游已更新」同步提示 */
  upstreamText: z.string().max(2000),
  /** S3：生成时注入了记忆胜率加权（有历史数据）——「📊 本条建议来自你的历史数据」徽章依据 */
  memoryApplied: z.boolean().optional(),
})
export type ScriptMetaPayload = z.infer<typeof scriptMetaPayloadSchema>

/** 读取：从 shape meta 解析脚本生成结果（缺失/非法返回 null，不半渲染） */
export function readScriptMetaPayload(meta: unknown): ScriptMetaPayload | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const parsed = scriptMetaPayloadSchema.safeParse(meta)
  return parsed.success ? parsed.data : null
}

/** 写入：生成结果经 zod 校验后合并进 meta（校验失败返回 null 拒写，不合格则整体失败） */
export function writeScriptMetaPayload(
  baseMeta: Record<string, unknown>,
  payload: ScriptMetaPayload
): Record<string, unknown> | null {
  const parsed = scriptMetaPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  return { ...baseMeta, ...parsed.data }
}

/** 场景读取：meta.scriptScene 非法或缺省时回退 'ecommerce' */
export function scriptSceneOf(meta: unknown): CanvasScriptScene {
  const scene =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? (meta as Record<string, unknown>).scriptScene
      : undefined
  return CANVAS_SCRIPT_SCENES.includes(scene as CanvasScriptScene)
    ? (scene as CanvasScriptScene)
    : 'ecommerce'
}

/**
 * 上游 Brief 文本 → ScriptWriter 输入（纯函数）：
 * 首段（按换行/分号切分）为商品或主题标题，其余段落按逗号细分拆为卖点（最多 5 条）；
 * 无独立段落时从标题内拆逗号短语作为卖点。
 */
export function briefTextToWriterInput(text: string): {
  productTitle: string
  sellingPoints: string[]
} {
  const normalized = text.trim()
  if (!normalized) return { productTitle: '', sellingPoints: [] }
  const segments = normalized
    .split(/[\n；;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const productTitle = (segments[0] ?? normalized).slice(0, 80)
  let sellingPoints = segments
    .slice(1)
    .flatMap((s) => s.split(/[，,]/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 5)
  if (sellingPoints.length === 0) {
    sellingPoints = productTitle
      .split(/[，,]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s !== productTitle)
      .slice(0, 5)
  }
  return { productTitle, sellingPoints }
}

/* ------------------------------------------------------------------ *
 * B3 分镜预演节点契约（CANVAS_PLAN.md §9 B3）
 * ------------------------------------------------------------------ */

/** Story/Shot 的 meta 载荷校验（对齐 src/types.ts Story 契约；types.ts 为纯类型故在此补 zod） */
export const storyMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  input: z.object({
    theme: z.string(),
    character: z.string(),
    conflict: z.string(),
    hook: z.string(),
  }),
  characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
      anchor: z.string(),
    })
  ),
  setting: z.object({
    place: z.string(),
    time: z.string(),
    light: z.string(),
  }),
  shots: z
    .array(
      z.object({
        id: z.string().min(1),
        // 字面量联合（非 range number）：与 src/types.ts Shot['order'] 类型对齐，可直接传给 ShotStage
        order: z.union([
          z.literal(1),
          z.literal(2),
          z.literal(3),
          z.literal(4),
          z.literal(5),
          z.literal(6),
        ]),
        purpose: z.string(),
        shotSize: z.enum(SHOT_SIZES),
        motionId: z.enum(MOTION_IDS),
        durationSec: z.number().min(2).max(5),
        cast: z.array(z.string()),
        line: z.string(),
        lineSpeaker: z.string().optional(),
        prop: z.enum(PROP_IDS).optional(),
      })
    )
    .length(6),
})

/** storyboard 节点生成结果的 meta 载荷：story（6 镜）+ 上游脚本摘要（上游变更检测用） */
export const storyboardMetaPayloadSchema = z.object({
  story: storyMetaSchema,
  /** 生成时上游 Script 的摘要指纹（djb2），用于「上游脚本已更新」提示 */
  scriptDigest: z.string(),
  /** 生成时上游脚本的 logline 快照（供 UI 展示来源） */
  scriptLogline: z.string().max(200),
})
export type StoryboardMetaPayload = z.infer<typeof storyboardMetaPayloadSchema>

/** 读取：从 shape meta 解析分镜结果（缺失/非法返回 null，不半渲染） */
export function readStoryboardMetaPayload(meta: unknown): StoryboardMetaPayload | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const parsed = storyboardMetaPayloadSchema.safeParse(meta)
  return parsed.success ? parsed.data : null
}

/**
 * 写入：分镜结果经 zod 校验后合并进 meta（校验失败返回 null 拒写）。
 * 来源互斥：写入 script→6 镜模式时剔除「3D 台自由分镜」痕迹键
 * （shotPlan / stage3dDigest / stage3dSource，见 stage3dFrames.ts）。
 */
export function writeStoryboardMetaPayload(
  baseMeta: Record<string, unknown>,
  payload: StoryboardMetaPayload
): Record<string, unknown> | null {
  const parsed = storyboardMetaPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  const cleaned = { ...baseMeta }
  delete cleaned.shotPlan
  delete cleaned.stage3dDigest
  delete cleaned.stage3dSource
  return { ...cleaned, ...parsed.data }
}

/** 脚本摘要指纹（djb2，纯函数）：上游脚本任何字段变化都会改变指纹，驱动「重新生成分镜」提示 */
export function scriptDigest(script: unknown): string {
  let hash = 5381
  for (const ch of JSON.stringify(script)) {
    hash = ((hash << 5) + hash + ch.charCodeAt(0)) | 0
  }
  return (hash >>> 0).toString(36)
}

/* ------------------------------------------------------------------ *
 * B4 出片生成节点 + 产物卡契约（CANVAS_PLAN.md §9 B4）
 * ------------------------------------------------------------------ */

/** 产物条目状态：与 domain/shotJob.ts ShotJob.status / FSM 四态严格一致 */
export const ARTIFACT_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number]

/** 单镜产物条目（generate 节点产物列表 + 持久化） */
export const artifactSchema = z.object({
  shotId: z.string().min(1),
  order: z.number().int().min(1).max(6),
  status: z.enum(ARTIFACT_STATUSES),
  /** 仅 succeeded 有值：idbref:// 引用（IndexedDB 大资产）或 http(s) 直链；blob: 不持久化 */
  url: z.string().optional(),
  error: z.string().optional(),
})
export type Artifact = z.infer<typeof artifactSchema>

/** generate 节点 meta 载荷：产物列表（仅终态，生成中不写 meta，刷新如实回 idle） */
export const generateMetaPayloadSchema = z.object({
  providerId: z.literal('mock'),
  artifacts: z.array(artifactSchema).max(6),
  storyDigest: z.string(),
  /** B5：生成时的 Story 快照（deliver 打包剪映草稿所需，沿边读取） */
  story: storyMetaSchema.optional(),
})
export type GenerateMetaPayload = z.infer<typeof generateMetaPayloadSchema>

export function readGenerateMetaPayload(meta: unknown): GenerateMetaPayload | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const parsed = generateMetaPayloadSchema.safeParse(meta)
  return parsed.success ? parsed.data : null
}

export function writeGenerateMetaPayload(
  baseMeta: Record<string, unknown>,
  payload: GenerateMetaPayload
): Record<string, unknown> | null {
  const parsed = generateMetaPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  return { ...baseMeta, ...parsed.data }
}

/** 可持久化产物引用：idbref:// 或 http(s) 直链（blob: 跨刷新失效，禁止入档）——asset/product/版本条目共用 */
const persistentUrlSchema = z
  .string()
  .refine(
    (u) => u.startsWith('idbref://') || u.startsWith('http://') || u.startsWith('https://'),
    { message: '产物 url 只允许 idbref:// 引用或 http(s) 直链（blob: 跨刷新失效，禁止持久化）' }
  )

/** A2：重绘版本条目（版本堆叠卡，最新在前） */
export const assetVersionSchema = z.object({
  url: persistentUrlSchema,
  /** 产生该版本的重绘指令（如实记录版本链） */
  instruction: z.string().max(500),
  /** true = 离线演示重绘（客户端色彩变换），UI 必须标「🧪 演示重绘 · 非真实生成」 */
  demo: z.boolean(),
  createdAt: z.number().finite().positive(),
})
export type AssetVersion = z.infer<typeof assetVersionSchema>

/** 产物卡（kind='asset'）meta 载荷：大资产只存引用（idbref://），blob URL 绝不入档 */
export const assetMetaPayloadSchema = z.object({
  /** B5：扩展 'image'（素材导入产物：上传图片 / 视频抽帧） */
  type: z.enum(['video', 'image']),
  url: z
    .string()
    .refine((u) => u.startsWith('idbref://') || u.startsWith('http://') || u.startsWith('https://'), {
      message: '产物卡 url 只允许 idbref:// 引用或 http(s) 直链（blob: 跨刷新失效，禁止持久化）',
    }),
  shotId: z.string().min(1),
  createdAt: z.number().finite().positive(),
  title: z.string().max(120).optional(),
  /** A2：原始素材 url（首次重绘时固化，作为版本回退终点） */
  baseUrl: persistentUrlSchema.optional(),
  /** A2：重绘版本堆叠（最新在前），上限 20 条，超出截断最旧并如实提示 */
  versions: z.array(assetVersionSchema).max(20).optional(),
})
export type AssetMetaPayload = z.infer<typeof assetMetaPayloadSchema>

export function readAssetMetaPayload(meta: unknown): AssetMetaPayload | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const parsed = assetMetaPayloadSchema.safeParse(meta)
  return parsed.success ? parsed.data : null
}

export function writeAssetMetaPayload(
  baseMeta: Record<string, unknown>,
  payload: AssetMetaPayload
): Record<string, unknown> | null {
  const parsed = assetMetaPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  return { ...baseMeta, ...parsed.data }
}

/* ------------------------------------------------------------------ *
 * A2：重绘版本堆叠纯函数（node --test 可跑）
 * ------------------------------------------------------------------ */

/** 版本堆叠上限：超出截断最旧并如实提示（契约层同步 .max(20) 拒绝） */
export const ASSET_VERSIONS_MAX = 20

export type AssetVersionSlot = { url: string; demo: boolean; instruction: string | null }

/** 版本槽位序列（时间序）：槽 0 = 原始素材（baseUrl，不可变），槽 1..N = 重绘版本由旧到新 */
export function assetVersionSlots(payload: AssetMetaPayload): AssetVersionSlot[] {
  const slots: AssetVersionSlot[] = [{ url: payload.baseUrl ?? payload.url, demo: false, instruction: null }]
  for (const v of [...(payload.versions ?? [])].reverse()) {
    slots.push({ url: v.url, demo: v.demo, instruction: v.instruction })
  }
  return slots
}

/** 当前显示槽位下标（meta.url 与槽位 url 匹配；不匹配时回退原始素材槽） */
export function assetCurrentSlotIndex(payload: AssetMetaPayload): number {
  const idx = assetVersionSlots(payload).findIndex((s) => s.url === payload.url)
  return idx >= 0 ? idx : 0
}

/**
 * 版本切换纯函数：dir = -1 向旧版本 / +1 向新版本；越界返回 null（不回绕，UI 禁用按钮）。
 * 返回值直接作为新的 meta.url。
 */
export function switchAssetVersion(payload: AssetMetaPayload, dir: -1 | 1): string | null {
  const slots = assetVersionSlots(payload)
  const next = assetCurrentSlotIndex(payload) + dir
  if (next < 0 || next >= slots.length) return null
  return slots[next].url
}

/**
 * 追加重绘版本（最新在前）：首次重绘固化 baseUrl（原始素材），meta.url 指向新版本。
 * 超出 ASSET_VERSIONS_MAX 截断最旧并返回截断数（调用方如实提示）。
 * 校验失败（如 blob: url）返回 null 拒写——不合格则整体失败。
 */
export function appendAssetVersion(
  baseMeta: Record<string, unknown>,
  entry: { url: string; instruction: string; demo: boolean; createdAt: number }
): { meta: Record<string, unknown>; truncated: number } | null {
  const current = readAssetMetaPayload(baseMeta)
  if (!current) return null
  const versions = [
    { url: entry.url, instruction: entry.instruction, demo: entry.demo, createdAt: entry.createdAt },
    ...(current.versions ?? []),
  ]
  const truncated = Math.max(0, versions.length - ASSET_VERSIONS_MAX)
  const merged = writeAssetMetaPayload(
    { ...baseMeta },
    {
      ...current,
      baseUrl: current.baseUrl ?? current.url,
      url: entry.url,
      versions: versions.slice(0, ASSET_VERSIONS_MAX),
    }
  )
  if (!merged) return null
  return { meta: merged, truncated }
}

/**
 * addNode 初始摆放纵坐标（纯函数）：避开底部对话栏浮层（B4 任务 0）。
 * 理想位置为视口垂直居中；若节点底边侵入「对话栏避让带」（视口底部 safeBandPx）则整体上移。
 */
export function initialNodeY(
  viewportCenterY: number,
  nodeHeight: number,
  viewportBottomY: number,
  safeBandPx = 150,
  jitterPx = 0
): number {
  const ideal = viewportCenterY - nodeHeight / 2 + jitterPx
  const safeBottom = viewportBottomY - safeBandPx
  return ideal + nodeHeight > safeBottom ? safeBottom - nodeHeight : ideal
}

/* ------------------------------------------------------------------ *
 * B5：素材导入（product）+ 成片交付（deliver）节点契约
 * ------------------------------------------------------------------ */

/** product 节点单条导入记录 */
export const productImportItemSchema = z.object({
  kind: z.enum(['image', 'link', 'video-frame']),
  url: persistentUrlSchema,
  name: z.string().max(120).optional(),
  createdAt: z.number().finite().positive(),
})
export type ProductImportItem = z.infer<typeof productImportItemSchema>

/** product 节点 meta 载荷：商品标题 + 导入历史 */
export const productMetaPayloadSchema = z.object({
  title: z.string().max(120),
  /** 生成时上游 Brief 文本快照（沿 B2/B3 模式做变更提示） */
  upstreamText: z.string().max(2000),
  imports: z.array(productImportItemSchema).max(50),
})
export type ProductMetaPayload = z.infer<typeof productMetaPayloadSchema>

export function readProductMetaPayload(meta: unknown): ProductMetaPayload | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const parsed = productMetaPayloadSchema.safeParse(meta)
  return parsed.success ? parsed.data : null
}

export function writeProductMetaPayload(
  baseMeta: Record<string, unknown>,
  payload: ProductMetaPayload
): Record<string, unknown> | null {
  const parsed = productMetaPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  return { ...baseMeta, ...parsed.data }
}

/** deliver 节点 meta 载荷：打包动作的持久化痕迹（zip 本体走浏览器下载，不入档） */
export const deliverMetaPayloadSchema = z.object({
  lastPackagedAt: z.number().finite().positive().optional(),
  videoCount: z.number().int().min(0).optional(),
  /** 图片类产物不入剪映视频轨的数量（如实记录跳过数） */
  imageSkipped: z.number().int().min(0).optional(),
})
export type DeliverMetaPayload = z.infer<typeof deliverMetaPayloadSchema>

export function readDeliverMetaPayload(meta: unknown): DeliverMetaPayload | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const parsed = deliverMetaPayloadSchema.safeParse(meta)
  return parsed.success ? parsed.data : null
}

export function writeDeliverMetaPayload(
  baseMeta: Record<string, unknown>,
  payload: DeliverMetaPayload
): Record<string, unknown> | null {
  const parsed = deliverMetaPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  return { ...baseMeta, ...parsed.data }
}

/* ------------------------------------------------------------------ *
 * A1：局部重绘（edit）节点契约（CANVAS_PLAN.md §9 A1）
 * ------------------------------------------------------------------ */

/** mask PNG 大资产引用：只允许 idbref://（blob: 跨刷新失效，禁止入档） */
const maskRefSchema = z.string().refine((u) => u.startsWith('idbref://'), {
  message: 'maskRef 只允许 idbref:// 引用（mask PNG 与源图同尺寸落 IndexedDB，blob: 禁止持久化）',
})

/**
 * edit 节点 meta 载荷（A1）：
 * - sourceRef = 涂抹时的源图引用（asset 卡 url，idbref/http(s)）；mask 与源图配对，
 *   上游更换后旧 mask 不再适用（UI 据此提示重新涂抹）；
 * - sourceType = 'image'（图片产物）| 'video-frame'（视频单帧定格，非时序修复，UI 诚实标注）；
 * - instruction = A2 预留字段（自然语言修改指令），本片只做契约占位。
 */
export const editMetaPayloadSchema = z.object({
  maskRef: maskRefSchema,
  sourceRef: persistentUrlSchema,
  sourceType: z.enum(['image', 'video-frame']),
  instruction: z.string().max(500).optional(),
})
export type EditMetaPayload = z.infer<typeof editMetaPayloadSchema>

/** 读取：从 shape meta 解析 edit 载荷（缺失/非法返回 null，不半渲染） */
export function readEditMetaPayload(meta: unknown): EditMetaPayload | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const parsed = editMetaPayloadSchema.safeParse(meta)
  return parsed.success ? parsed.data : null
}

/** 写入：edit 载荷经 zod 校验后合并进 meta（校验失败返回 null 拒写，不合格则整体失败） */
export function writeEditMetaPayload(
  baseMeta: Record<string, unknown>,
  payload: EditMetaPayload
): Record<string, unknown> | null {
  const parsed = editMetaPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  return { ...baseMeta, ...parsed.data }
}

const nodeIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)

export const canvasNodeSchema = z.object({
  id: nodeIdSchema,
  kind: z.enum(CANVAS_NODE_KINDS),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
  meta: z.record(z.string(), z.unknown()).default({}),
})
export type CanvasNode = z.infer<typeof canvasNodeSchema>

export const canvasEdgeSchema = z.object({
  id: nodeIdSchema,
  from: nodeIdSchema,
  to: nodeIdSchema,
})
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>

export const canvasDocSchema = z.object({
  version: z.literal(1),
  id: nodeIdSchema,
  name: z.string().min(1).max(120),
  nodes: z.array(canvasNodeSchema).max(200),
  edges: z.array(canvasEdgeSchema).max(400),
  updatedAt: z.number().finite().nonnegative(),
})
export type CanvasDoc = z.infer<typeof canvasDocSchema>

/** 校验 + 白名单清洗：非法输入返回 null（诚实拒绝，不半渲染） */
export function validateCanvasDoc(raw: unknown): CanvasDoc | null {
  const parsed = canvasDocSchema.safeParse(raw)
  if (!parsed.success) return null
  const doc = parsed.data

  // 边引用完整性：指向不存在节点的边直接丢弃
  const nodeIds = new Set(doc.nodes.map((n) => n.id))
  const edges = doc.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
  if (edges.length !== doc.edges.length) {
    return { ...doc, edges }
  }
  return doc
}

export function createEmptyCanvasDoc(name = '未命名画布'): CanvasDoc {
  return {
    version: 1,
    id: `canvas-${Date.now().toString(36)}`,
    name,
    nodes: [],
    edges: [],
    updatedAt: Date.now(),
  }
}

/** 新节点 id（同时用作 tldraw shape id 的一部分，保证双向无损映射） */
export function createNodeId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `n${Date.now().toString(36)}${rand}`
}

export const CANVAS_NODE_SHAPE_TYPE = 'wls-node' as const
/** tldraw shape id ↔ CanvasNode id（`shape:wls-<nodeId>` 双向无损） */
export function nodeIdToShapeId(nodeId: string): string {
  return `shape:wls-${nodeId}`
}
export function shapeIdToNodeId(shapeId: string): string | null {
  return shapeId.startsWith('shape:wls-') ? shapeId.slice('shape:wls-'.length) : null
}

/** 序列化纯函数：节点 → tldraw shape partial（不依赖 tldraw 运行时，node --test 可跑） */
export type WlsNodeShapePartial = {
  id: string
  type: typeof CANVAS_NODE_SHAPE_TYPE
  x: number
  y: number
  props: {
    w: number
    h: number
    kind: CanvasNodeKind
    meta: Record<string, unknown>
  }
}

export function canvasNodeToShapePartial(node: CanvasNode): WlsNodeShapePartial {
  return {
    id: nodeIdToShapeId(node.id),
    type: CANVAS_NODE_SHAPE_TYPE,
    x: node.x,
    y: node.y,
    props: { w: node.w, h: node.h, kind: node.kind, meta: node.meta },
  }
}

/** 反序列化纯函数：tldraw shape 快照（最小结构） → CanvasNode（非法 kind 拒绝） */
export type WlsShapeSnapshot = {
  id: string
  type: string
  x: number
  y: number
  props: { w?: number; h?: number; kind?: string; meta?: unknown }
}

export function shapeSnapshotToCanvasNode(shape: WlsShapeSnapshot): CanvasNode | null {
  const nodeId = shapeIdToNodeId(shape.id)
  if (!nodeId) return null
  const kindCheck = z.enum(CANVAS_NODE_KINDS).safeParse(shape.props.kind)
  if (!kindCheck.success) return null
  const w = typeof shape.props.w === 'number' && Number.isFinite(shape.props.w) ? shape.props.w : 260
  const h = typeof shape.props.h === 'number' && Number.isFinite(shape.props.h) ? shape.props.h : 160
  const meta =
    shape.props.meta && typeof shape.props.meta === 'object' && !Array.isArray(shape.props.meta)
      ? (shape.props.meta as Record<string, unknown>)
      : {}
  const node = canvasNodeSchema.safeParse({
    id: nodeId,
    kind: kindCheck.data,
    x: shape.x,
    y: shape.y,
    w,
    h,
    meta,
  })
  return node.success ? node.data : null
}

/** 边提取纯函数：箭头绑定信息 → CanvasEdge（自环 / 非法引用由调用方经 validateCanvasDoc 兜底过滤） */
export type ArrowBindingSnapshot = {
  arrowId: string
  startShapeId: string | null
  endShapeId: string | null
}

/**
 * 箭头 → 边：id 按箭头 id 直接映射并清洗为 nodeIdSchema 合法字符（`e` + 去掉 `arrow:` 前缀后的字母数字）。
 * 注意：tldraw 真实箭头 id 形如 `shape:AbC123`（含冒号），必须清洗，否则整份文档会被
 * canvasEdgeSchema 拒绝、落盘静默失败。
 * 恢复路径物化的箭头（`shape:earrow-<edgeId>`）直接取回边 id，保证「保存→刷新→恢复→再保存」跨刷新稳定。
 * 同向多箭头去重时取 id 最小者为代表，且输出按 id 排序——
 * 保证同一组箭头无论遍历顺序如何，多次序列化得到的边 id 与顺序完全一致（id 稳定）。
 */
export function arrowSnapshotsToEdges(
  arrows: ArrowBindingSnapshot[],
  shapeIdToNode: (shapeId: string) => string | null
): CanvasEdge[] {
  const best = new Map<string, CanvasEdge>()
  for (const arrow of arrows) {
    if (!arrow.startShapeId || !arrow.endShapeId) continue
    const from = shapeIdToNode(arrow.startShapeId)
    const to = shapeIdToNode(arrow.endShapeId)
    if (!from || !to || from === to) continue
    const id = arrowIdToEdgeId(arrow.arrowId)
    const key = `${from}->${to}`
    const existing = best.get(key)
    if (!existing || id < existing.id) {
      best.set(key, { id, from, to })
    }
  }
  return Array.from(best.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 物化箭头 shape id 前缀：由 doc.edges 恢复画布时使用（区别于 tldraw 随机箭头 id） */
export const WLS_ARROW_SHAPE_PREFIX = 'shape:earrow-' as const

/** 边 id → 箭头 shape id（确定性映射，跨刷新稳定） */
export function edgeIdToArrowShapeId(edgeId: string): string {
  return `${WLS_ARROW_SHAPE_PREFIX}${edgeId}`
}

/** 箭头 shape id → 边 id（仅物化箭头可逆；用户手绘箭头返回 null） */
export function arrowShapeIdToEdgeId(arrowId: string): string | null {
  return arrowId.startsWith(WLS_ARROW_SHAPE_PREFIX)
    ? arrowId.slice(WLS_ARROW_SHAPE_PREFIX.length)
    : null
}

/** 用户手绘箭头 id → 边 id（清洗为 nodeIdSchema 合法字符；不保证与物化箭头互逆） */
export function rawArrowIdToEdgeId(arrowId: string): string {
  const raw = arrowId.replace(/^arrow:/, '')
  return `e${raw.replace(/[^A-Za-z0-9_-]/g, '')}`
}

function arrowIdToEdgeId(arrowId: string): string {
  return arrowShapeIdToEdgeId(arrowId) ?? rawArrowIdToEdgeId(arrowId)
}

/** 边 → 箭头物化参数（纯函数，node --test 可跑）：箭头从 from 节点中心指向 to 节点中心 */
export type EdgeArrowMaterial = {
  arrowShapeId: string
  x: number
  y: number
  start: { x: number; y: number }
  end: { x: number; y: number }
  bindings: { toShapeId: string; terminal: 'start' | 'end' }[]
}

export function edgeToArrowMaterial(
  edge: Pick<CanvasEdge, 'id' | 'from' | 'to'>,
  fromNode: Pick<CanvasNode, 'id' | 'x' | 'y' | 'w' | 'h'>,
  toNode: Pick<CanvasNode, 'id' | 'x' | 'y' | 'w' | 'h'>
): EdgeArrowMaterial | null {
  if (edge.from === edge.to) return null
  const fromCx = fromNode.x + fromNode.w / 2
  const fromCy = fromNode.y + fromNode.h / 2
  const toCx = toNode.x + toNode.w / 2
  const toCy = toNode.y + toNode.h / 2
  const dx = toCx - fromCx
  const dy = toCy - fromCy
  // 两节点中心重合时给一个最小可见向量，避免零长箭头
  const end = dx === 0 && dy === 0 ? { x: 0, y: 1 } : { x: dx, y: dy }
  return {
    arrowShapeId: edgeIdToArrowShapeId(edge.id),
    x: fromCx,
    y: fromCy,
    start: { x: 0, y: 0 },
    end,
    bindings: [
      { toShapeId: nodeIdToShapeId(edge.from), terminal: 'start' },
      { toShapeId: nodeIdToShapeId(edge.to), terminal: 'end' },
    ],
  }
}

/**
 * 边类型兼容契约（CANVAS_PLAN.md §9 B1）：每类节点允许的下游集合。
 * 拓扑语义：数据流自上游向下游（A 的产物 → B 的输入），deliver 为终点。
 */
export const CANVAS_EDGE_COMPAT: Record<CanvasNodeKind, readonly CanvasNodeKind[]> = {
  brief: ['product', 'script', 'image'],
  // S2（§5.2 v1.4 增补）：解锁 product → generate 单图直出通道——generate 节点在
  // 仅有 product 上游（无 storyboard）时进入「单图直出 · 演示引擎」模式（商品标题作提示词）
  product: ['script', 'image', 'generate'],
  image: ['edit', 'deliver'],
  script: ['storyboard'],
  storyboard: ['generate'],
  generate: ['asset', 'deliver'],
  // A1：产物卡可连入局部重绘（源图 / 视频单帧定格）
  asset: ['deliver', 'edit'],
  edit: ['deliver'],
  stage3d: ['storyboard', 'generate'],
  deliver: [],
}

/** 连线校验纯函数：合法返回 ok；非法返回中文原因（供画布内提示条展示） */
export function validateEdgeKind(
  from: CanvasNodeKind,
  to: CanvasNodeKind
): { ok: true } | { ok: false; reason: string } {
  if (from === to) {
    return { ok: false, reason: `${CANVAS_NODE_META[from].label}不能连接自身：数据流自上游向下游` }
  }
  if (CANVAS_EDGE_COMPAT[from].includes(to)) return { ok: true }
  if (from === 'deliver') {
    return { ok: false, reason: '成片交付是流程终点，产物不再流向下游节点' }
  }
  return {
    ok: false,
    reason: `${CANVAS_NODE_META[from].label}不能直连${CANVAS_NODE_META[to].label}：数据流自上游向下游`,
  }
}

/* ------------------------------------------------------------------ *
 * B6：对话栏 LLM 编排契约（CANVAS_PLAN.md §9 B6）
 * ------------------------------------------------------------------ */

/** 编排场景（关键词路由结果；brand/game/app 共用 brand 叙事脚本契约） */
export const ORCHESTRATION_SCENES = ['ecommerce', 'brand', 'drama', 'game', 'app'] as const
export type OrchestrationScene = (typeof ORCHESTRATION_SCENES)[number]

/** 编排节点建议（LLM 输出/演示生成的最小单元） */
export const orchestrationNodeSchema = z.object({
  kind: z.enum(READY_NODE_KINDS as unknown as [CanvasNodeKind, ...CanvasNodeKind[]]),
  params: z.record(z.string(), z.unknown()).default({}),
})
export type OrchestrationNode = z.infer<typeof orchestrationNodeSchema>

/** 编排连线建议：from/to 为 nodes 数组下标 */
export const orchestrationEdgeSchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
})

/** 编排拓扑建议整体契约：kind 必须 ready、节点 2~9、边 ≤12、下标有效且不指自身 */
export const orchestrationPlanSchema = z
  .object({
    title: z.string().max(120).default(''),
    nodes: z.array(orchestrationNodeSchema).min(2).max(9),
    edges: z.array(orchestrationEdgeSchema).max(12),
  })
  .refine(
    (plan) =>
      plan.edges.every(
        (e) => e.from !== e.to && e.from < plan.nodes.length && e.to < plan.nodes.length
      ),
    { message: '编排连线下标越界或自环' }
  )
export type OrchestrationPlan = z.infer<typeof orchestrationPlanSchema>

/** 解析 LLM 编排建议（剥 Markdown 围栏 → zod 校验）；不合法返回 null（调用方降级演示） */
export function parseOrchestrationPlan(raw: string): OrchestrationPlan | null {
  try {
    const cleaned = raw
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()
    const parsed = orchestrationPlanSchema.safeParse(JSON.parse(cleaned))
    if (parsed.success) return parsed.data
    console.warn('[Orchestration] LLM 编排建议未通过 zod 校验:', parsed.error.issues.slice(0, 5))
    return null
  } catch (err) {
    console.warn('[Orchestration] LLM 编排输出不是合法 JSON:', err)
    return null
  }
}

/**
 * 编排节点参数白名单过滤（纯函数）：
 * 只保留 ORCHESTRATION_PARAM_KEYS 中该 kind 允许的键，并按最小契约校验取值——
 * brief.text / product.title 必须非空字符串（截断 2000/120），script.scriptScene 必须合法枚举。
 */
export function filterOrchestrationParams(
  kind: CanvasNodeKind,
  params: Record<string, unknown>
): Record<string, unknown> {
  const allowed = ORCHESTRATION_PARAM_KEYS[kind] ?? []
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    const v = params[key]
    if (key === 'text' || key === 'title') {
      if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, key === 'text' ? 2000 : 120)
    } else if (key === 'scriptScene') {
      if (
        typeof v === 'string' &&
        CANVAS_SCRIPT_SCENES.includes(v as CanvasScriptScene)
      ) {
        out[key] = v
      }
    }
  }
  return out
}

/**
 * 对话栏文本场景关键词路由（纯函数，确定性）：命中优先级从上到下，未命中回退 ecommerce。
 * brand/game/app 三类共用 brand 叙事脚本契约（scriptScene 枚举仅三选一）。
 */
export function routeOrchestrationScene(text: string): OrchestrationScene {
  const t = text.toLowerCase()
  if (/(app|界面|记账|小程序|桌面端)/.test(t)) return 'app'
  if (/(游戏|pv|关卡|独立游戏)/.test(t)) return 'game'
  if (/(短剧|剧情|台词|反转|人物|故事)/.test(t)) return 'drama'
  if (/(品牌|视觉|logo|海报|社媒|风格)/.test(t)) return 'brand'
  return 'ecommerce'
}

/** 场景 → script 契约路由（复用 B2 的 SCRIPT_SCENE_TEMPLATE_ID 语义） */
export function sceneToScriptScene(scene: OrchestrationScene): 'ecommerce' | 'drama' | 'brand' {
  if (scene === 'drama') return 'drama'
  if (scene === 'ecommerce') return 'ecommerce'
  return 'brand'
}

/**
 * 演示编排拓扑生成（纯函数，确定性，node --test 可跑）：
 * 用户原文落 Brief，后续按场景映射 ready 节点链 brief→script→storyboard→generate→deliver，
 * 节点参数按各自 meta 契约预填（script 的场景 select、brief 的原文等）。
 */
export function buildDemoOrchestrationPlan(
  text: string,
  scene: OrchestrationScene
): OrchestrationPlan {
  const briefText = text.trim().slice(0, 2000)
  const scriptScene = sceneToScriptScene(scene)
  return {
    title: briefText.slice(0, 60),
    nodes: [
      { kind: 'brief', params: { text: briefText } },
      { kind: 'script', params: { scriptScene } },
      { kind: 'storyboard', params: {} },
      { kind: 'generate', params: {} },
      { kind: 'deliver', params: {} },
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
    ],
  }
}

/* ------------------------------------------------------------------ *
 * S1：Skill manifest 契约（CANVAS_PLAN.md §5.2 / §9 S1）
 * ------------------------------------------------------------------ */

export const SKILL_MANIFEST_VERSION = 1

/** 槽位 id 前缀：manifest 节点用槽位 id（slot-1、slot-2…）而非画布节点 id（跨设备可复用） */
export const SKILL_SLOT_ID_PREFIX = 'slot-'

/**
 * Skill 参数槽位白名单（按 kind 收窄）：与 ORCHESTRATION_PARAM_KEYS 同源语义但更严格——
 * manifest 只允许这三类参数槽位，其余 meta 字段（产物 url / maskRef / imports / upstreamText
 * 等设备本地引用与运行痕迹）一律剥离或拒绝，绝不入 manifest。
 */
export const SKILL_PARAM_KEYS: Record<string, readonly string[]> = {
  brief: ['text'],
  product: ['title'],
  script: ['scriptScene'],
  storyboard: [],
  generate: [],
  deliver: [],
  asset: [],
  edit: [],
  image: [],
  stage3d: [],
}

/** 参数槽位展示名（inputs 声明的 label 用） */
export const SKILL_PARAM_LABELS: Record<string, string> = {
  text: '需求文本',
  title: '商品标题',
  scriptScene: '脚本场景',
}

/** manifest 节点：槽位 id + kind（仅 ready 节点）+ 相对坐标（左上角归一化到 0,0）+ 白名单参数 */
export const skillNodeSchema = z.object({
  slot: z.string().regex(/^slot-[1-9]\d*$/, { message: '槽位 id 必须形如 slot-1、slot-2' }),
  kind: z.enum(READY_NODE_KINDS as unknown as [CanvasNodeKind, ...CanvasNodeKind[]]),
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
  params: z.record(z.string(), z.unknown()).default({}),
})

export const skillManifestSchema = z.object({
  version: z.literal(SKILL_MANIFEST_VERSION),
  name: z.string().min(1).max(120),
  nodes: z.array(skillNodeSchema).min(2).max(50),
  edges: z
    .array(z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }))
    .max(100),
  /** 输入槽位声明：入口节点中需要用户填新内容的参数（S2 导入时高亮提示「填新输入」） */
  inputs: z.array(
    z.object({
      slot: z.string().min(1),
      paramKey: z.string().min(1),
      label: z.string().min(1).max(60),
    })
  ),
  /** 输出声明：子拓扑的终点节点（无出边） */
  outputs: z.array(z.object({ slot: z.string().min(1), label: z.string().min(1).max(60) })),
})
export type SkillNode = z.infer<typeof skillNodeSchema>
export type SkillInput = z.infer<typeof skillManifestSchema>['inputs'][number]
export type SkillOutput = z.infer<typeof skillManifestSchema>['outputs'][number]
export type SkillManifest = z.infer<typeof skillManifestSchema>

/** 产物引用污染判定（纯函数）：manifest 参数值中出现的设备本地引用一律视为非法 */
function paramValueContaminated(v: unknown): boolean {
  if (typeof v !== 'string') return false
  return v.includes('idbref://') || v.startsWith('blob:')
}

/**
 * Skill manifest 深度校验（整体拒绝，不半渲染），失败时给中文原因（S2 导入 UI 直接展示）：
 * 1. zod 形状校验（缺 name / 空 nodes / 非法 slot 格式直接拒）；
 * 2. name 不得纯空白（O2）；
 * 3. slot id 唯一且恰好为 slot-1..N；
 * 4. params 严格白名单：键必须在 SKILL_PARAM_KEYS[kind] 内、**值必须是字符串（O1：数值/对象一律拒）**、
 *    值不得含 idbref:// / blob: 产物引用、scriptScene 必须是合法枚举；
 *    （text/title 的 trim 非空与截断由导入落 meta 层 filterOrchestrationParams 兜底，空串允许=等用户填）
 * 5. 边下标有效、无自环、无重复、两端 kind 兼容（复用 validateEdgeKind）；
 * 6. inputs/outputs 的 slot 引用有效。
 */
export type SkillManifestCheck =
  | { ok: true; manifest: SkillManifest }
  | { ok: false; reason: string }

export function validateSkillManifestDetailed(raw: unknown): SkillManifestCheck {
  const parsed = skillManifestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue && issue.path.length > 0 ? issue.path.join('.') : ''
    return {
      ok: false,
      reason: `Skill 包结构不合法${path ? `（字段 ${path}）` : ''}：${issue?.message ?? '未知错误'}`,
    }
  }
  const m = parsed.data

  // O2：name 纯空白拒绝（导出路径已 trim，导入路径由本检查兜底）
  if (!m.name.trim()) return { ok: false, reason: 'Skill 包缺少有效名称（name 为纯空白）' }

  // slot 唯一且恰好 slot-1..N（与 nodes 顺序无关，集合必须精确匹配）
  const slotSet = new Set(m.nodes.map((n) => n.slot))
  if (slotSet.size !== m.nodes.length) {
    return { ok: false, reason: 'Skill 包节点槽位 id 重复' }
  }
  for (let i = 0; i < m.nodes.length; i++) {
    if (!slotSet.has(`${SKILL_SLOT_ID_PREFIX}${i + 1}`)) {
      return { ok: false, reason: `Skill 包槽位不连续：缺少 ${SKILL_SLOT_ID_PREFIX}${i + 1}` }
    }
  }

  // params 严格白名单 + 值类型 + 产物污染 + scriptScene 枚举
  for (const node of m.nodes) {
    const kindLabel = CANVAS_NODE_META[node.kind].label
    const allowed = SKILL_PARAM_KEYS[node.kind] ?? []
    for (const key of Object.keys(node.params)) {
      if (!allowed.includes(key)) {
        return {
          ok: false,
          reason: `节点 ${node.slot}（${kindLabel}）的参数「${key}」不在该节点类型的白名单内`,
        }
      }
      // O1：值必须字符串，杜绝 number/object 进 meta
      if (typeof node.params[key] !== 'string') {
        return {
          ok: false,
          reason: `节点 ${node.slot}（${kindLabel}）的参数「${key}」必须是字符串`,
        }
      }
      const value = node.params[key] as string
      if (paramValueContaminated(value)) {
        return {
          ok: false,
          reason: `节点 ${node.slot}（${kindLabel}）的参数「${key}」携带设备本地产物引用（idbref/blob），禁止导入`,
        }
      }
    }
    const scene = node.params['scriptScene']
    if (scene !== undefined && !CANVAS_SCRIPT_SCENES.includes(scene as CanvasScriptScene)) {
      return {
        ok: false,
        reason: `节点 ${node.slot}（${kindLabel}）的脚本场景非法（只允许 ecommerce / drama / brand）`,
      }
    }
  }

  // 边：下标有效、无自环、无重复、kind 兼容
  const kindByIndex = m.nodes.map((n) => n.kind)
  const seen = new Set<string>()
  for (const e of m.edges) {
    if (e.from >= kindByIndex.length || e.to >= kindByIndex.length) {
      return { ok: false, reason: `Skill 包连线引用了不存在的节点下标（${e.from} → ${e.to}）` }
    }
    if (e.from === e.to) {
      return { ok: false, reason: `Skill 包连线存在自环（节点下标 ${e.from}）` }
    }
    const key = `${e.from}->${e.to}`
    if (seen.has(key)) {
      return { ok: false, reason: `Skill 包连线重复（${e.from} → ${e.to}）` }
    }
    seen.add(key)
    if (!validateEdgeKind(kindByIndex[e.from], kindByIndex[e.to]).ok) {
      return {
        ok: false,
        reason: `Skill 包连线类型不兼容：${CANVAS_NODE_META[kindByIndex[e.from]].label} → ${CANVAS_NODE_META[kindByIndex[e.to]].label}`,
      }
    }
  }

  // inputs/outputs slot 引用有效
  for (const input of m.inputs) {
    if (!slotSet.has(input.slot)) {
      return { ok: false, reason: `Skill 包输入声明引用了不存在的槽位（${input.slot}）` }
    }
  }
  for (const output of m.outputs) {
    if (!slotSet.has(output.slot)) {
      return { ok: false, reason: `Skill 包输出声明引用了不存在的槽位（${output.slot}）` }
    }
  }
  return { ok: true, manifest: m }
}

/** 校验 Skill manifest（整体拒绝）：合法返回 manifest，非法返回 null（原因走 validateSkillManifestDetailed） */
export function validateSkillManifest(raw: unknown): SkillManifest | null {
  const check = validateSkillManifestDetailed(raw)
  return check.ok ? check.manifest : null
}

/**
 * 从画布文档提取选中节点子拓扑 → Skill manifest（纯函数，node --test 可跑）。
 *
 * - 槽位分配：按 (x, y, id) 升序排序后依次 slot-1..N（确定性，同选集导出字节级一致）；
 * - 坐标归一化：减去选集包围盒左上角，相对坐标 ≥0；
 * - 参数过滤：复用 filterOrchestrationParams 白名单（brief.text / product.title / script.scriptScene），
 *   产物 url / maskRef / imports / 运行痕迹等字段天然被剥离，不入 manifest；
 * - 边：只保留两端都在选中的边，映射为槽位下标，按 from->to 去重；
 * - inputs：入口节点（子拓扑内无入边）的可填参数槽；outputs：终点节点（无出边）。
 * 少于 2 个合法节点或超出 50 个节点时返回 null（调用方禁用按钮/如实提示）。
 */
export function extractSkillManifest(
  doc: Pick<CanvasDoc, 'nodes' | 'edges'>,
  selectedNodeIds: readonly string[],
  name: string
): SkillManifest | null {
  const selected = new Set(selectedNodeIds)
  const picked = doc.nodes
    .filter((n) => selected.has(n.id) && READY_NODE_KINDS.includes(n.kind))
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))
  if (picked.length < 2 || picked.length > 50) return null

  const minX = Math.min(...picked.map((n) => n.x))
  const minY = Math.min(...picked.map((n) => n.y))
  const slotOfNode = new Map<string, string>()
  const skillNodes: SkillNode[] = picked.map((n, index) => {
    const slot = `${SKILL_SLOT_ID_PREFIX}${index + 1}`
    slotOfNode.set(n.id, slot)
    return {
      slot,
      kind: n.kind,
      x: Math.round(n.x - minX),
      y: Math.round(n.y - minY),
      w: n.w,
      h: n.h,
      params: filterOrchestrationParams(n.kind, n.meta),
    }
  })

  // 子拓扑边：两端都在选集内，按槽位下标映射并去重
  const indexOfNode = new Map<string, number>()
  picked.forEach((n, index) => indexOfNode.set(n.id, index))
  const edgeSeen = new Set<string>()
  const skillEdges: { from: number; to: number }[] = []
  for (const edge of doc.edges) {
    const from = indexOfNode.get(edge.from)
    const to = indexOfNode.get(edge.to)
    if (from === undefined || to === undefined) continue
    const key = `${from}->${to}`
    if (edgeSeen.has(key)) continue
    edgeSeen.add(key)
    skillEdges.push({ from, to })
  }

  // inputs：入口节点（无入边）的可填参数槽；outputs：终点节点（无出边）
  const hasIncoming = new Set(skillEdges.map((e) => e.to))
  const hasOutgoing = new Set(skillEdges.map((e) => e.from))
  const inputs: SkillInput[] = []
  const outputs: SkillOutput[] = []
  for (const node of skillNodes) {
    const kind = node.kind
    const idx = nodeIndexIn(skillNodes, node.slot)
    if (!hasIncoming.has(idx)) {
      for (const key of SKILL_PARAM_KEYS[kind] ?? []) {
        inputs.push({
          slot: node.slot,
          paramKey: key,
          label: `${CANVAS_NODE_META[kind].label} · ${SKILL_PARAM_LABELS[key] ?? key}`,
        })
      }
    }
    if (!hasOutgoing.has(idx)) {
      outputs.push({ slot: node.slot, label: CANVAS_NODE_META[kind].label })
    }
  }

  const manifest: SkillManifest = {
    version: SKILL_MANIFEST_VERSION,
    name: name.trim().slice(0, 120) || '未命名 Skill',
    nodes: skillNodes,
    edges: skillEdges,
    inputs,
    outputs,
  }
  return validateSkillManifest(manifest) ? manifest : null
}

function nodeIndexIn(nodes: SkillNode[], slot: string): number {
  return nodes.findIndex((n) => n.slot === slot)
}

/* ------------------------------------------------------------------ *
 * S2：单图直出（product → generate）+ 导入复用（CANVAS_PLAN.md §9 S2）
 * ------------------------------------------------------------------ */

/** 单图直出产物的固定镜号（generate meta.artifacts.shotId / 产物卡 shotId 共用） */
export const DIRECT_OUT_SHOT_ID = 'direct-s1'

/**
 * 单图直出演示计划（纯函数，node --test 可跑）：
 * 仅有 product 上游（无 storyboard）时，以商品标题为提示词生成单镜 VisualPlan，
 * 走 Mock/演示引擎单镜出片（UI 必须标注「单图直出 · 演示引擎」）。
 * 商品标题为空（trim 后）返回空数组（调用方禁用按钮）。
 */
export function buildDirectShotPlans(productTitle: string): VisualPlan[] {
  const t = productTitle.trim().slice(0, 120)
  if (!t) return []
  return [
    VisualPlanSchema.parse({
      shotId: DIRECT_OUT_SHOT_ID,
      order: 1,
      positive: `${t}。高质量商品单镜展示：主体居中、光感干净、构图克制`,
      caption: t,
      durationSec: 3,
    }),
  ]
}

/** 官方预置 Skill（§5.2-3）：随包内置，导入走与文件导入完全相同的校验与布置链路 */
export type OfficialSkill = {
  id: string
  icon: string
  label: string
  description: string
  manifest: SkillManifest
}

/** 六步爆款带货流的标准节点尺寸（与 addNode 各 kind 默认尺寸一致） */
const SIX_STEP_SIZES: Record<
  'brief' | 'product' | 'script' | 'storyboard' | 'generate' | 'deliver',
  [number, number]
> = {
  brief: [260, 160],
  product: [300, 340],
  script: [300, 220],
  storyboard: [300, 560],
  generate: [300, 320],
  deliver: [300, 400],
}

export const OFFICIAL_SKILLS: OfficialSkill[] = [
  {
    id: 'six-step-ecommerce',
    icon: '📦',
    label: '六步爆款带货流',
    description: 'brief→product→script→storyboard→generate→deliver 标准带货链',
    manifest: {
      version: SKILL_MANIFEST_VERSION,
      name: '六步爆款带货流',
      nodes: (
        [
          ['brief', 0, 0],
          ['product', 300, 0],
          ['script', 640, 0],
          ['storyboard', 980, 0],
          ['generate', 1320, 0],
          ['deliver', 1660, 0],
        ] as [keyof typeof SIX_STEP_SIZES, number, number][]
      ).map(([kind, x, y], index) => {
        const [w, h] = SIX_STEP_SIZES[kind]
        const params: Record<string, string> = {}
        if (kind === 'script') params.scriptScene = 'ecommerce'
        return { slot: `slot-${index + 1}`, kind, x, y, w, h, params }
      }),
      edges: [0, 1, 2, 3, 4].map((i) => ({ from: i, to: i + 1 })),
      inputs: [
        { slot: 'slot-1', paramKey: 'text', label: '需求 Brief · 需求文本' },
        { slot: 'slot-2', paramKey: 'title', label: '素材导入 · 商品标题' },
      ],
      outputs: [{ slot: 'slot-6', label: '成片交付' }],
    },
  },
  {
    id: 'single-image-out',
    icon: '⚡',
    label: '单图快速出片',
    description: 'product→generate 直连，商品标题作提示词单镜演示出片',
    manifest: {
      version: SKILL_MANIFEST_VERSION,
      name: '单图快速出片',
      nodes: [
        { slot: 'slot-1', kind: 'product', x: 0, y: 0, w: 300, h: 340, params: {} },
        { slot: 'slot-2', kind: 'generate', x: 360, y: 0, w: 300, h: 320, params: {} },
      ],
      edges: [{ from: 0, to: 1 }],
      inputs: [{ slot: 'slot-1', paramKey: 'title', label: '素材导入 · 商品标题' }],
      outputs: [{ slot: 'slot-2', label: '视频生成' }],
    },
  },
]

/** 导入落位的视口参数（从 editor.getViewportPageBounds 提取） */
export type SkillImportViewport = {
  minX: number
  maxX: number
  centerY: number
  bottomY: number
  /** 对话栏避让带（与 initialNodeY 同语义，默认 150） */
  safeBandPx?: number
}

export type SkillImportPlan = { nodes: CanvasNode[]; edges: CanvasEdge[] }

/**
 * Skill manifest → 画布重建计划（纯函数，node --test 可跑）：
 * - 节点 id 全量重映射（createNodeId，与现有画布天然不冲突）；
 * - 相对坐标整体平移落位：水平贴视口左侧内缩 40px，垂直优先居中、
 *   底边不进对话栏避让带（min(理想, 上限)，与 initialNodeY 同语义）；
 * - params 经 filterOrchestrationParams 二次收窄（O1：值类型/trim/截断兜底，
 *   空串参数丢弃 = 节点如实显示未生成，等用户「填新输入」）；
 * - inputs 声明映射为各节点 meta.skillInputKeys（仅保留白名单内的键，供 UI 高亮提示）；
 * - 边重映射为新节点 id，边 id 规则 eimp-1..N（经 edgeIdToArrowShapeId 物化后跨刷新稳定）。
 */
export function skillManifestToNodes(
  manifest: SkillManifest,
  viewport: SkillImportViewport
): SkillImportPlan | null {
  if (manifest.nodes.length === 0) return null
  const totalH = Math.max(...manifest.nodes.map((n) => n.y + n.h))
  const offsetX = viewport.minX + 40
  const maxOffsetY = viewport.bottomY - (viewport.safeBandPx ?? 150) - totalH
  const offsetY = Math.min(viewport.centerY - totalH / 2, maxOffsetY)

  const slotToId = new Map<string, string>()
  const nodes: CanvasNode[] = manifest.nodes.map((n) => {
    const id = createNodeId()
    slotToId.set(n.slot, id)
    // O1 兜底：导入落 meta 前按白名单再收窄一次（值必须 string + trim 非空 + 截断）
    const meta: Record<string, unknown> = { ...filterOrchestrationParams(n.kind, n.params) }
    const inputKeys = manifest.inputs
      .filter(
        (i) => i.slot === n.slot && (SKILL_PARAM_KEYS[n.kind] ?? []).includes(i.paramKey)
      )
      .map((i) => i.paramKey)
    if (inputKeys.length > 0) meta.skillInputKeys = inputKeys
    return {
      id,
      kind: n.kind,
      x: Math.round(offsetX + n.x),
      y: Math.round(offsetY + n.y),
      w: n.w,
      h: n.h,
      meta,
    }
  })
  const edges: CanvasEdge[] = []
  // 每次导入独立盐值：同画布多次导入同 Skill 时边 id 不冲突（节点 id 经 createNodeId 天然唯一）
  const importSalt = createNodeId().slice(1)
  manifest.edges.forEach((e, i) => {
    const from = slotToId.get(manifest.nodes[e.from]?.slot ?? '')
    const to = slotToId.get(manifest.nodes[e.to]?.slot ?? '')
    if (!from || !to) return
    edges.push({ id: `eimp-${importSalt}-${i + 1}`, from, to })
  })
  return { nodes, edges }
}
