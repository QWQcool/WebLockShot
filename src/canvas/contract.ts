import { z } from 'zod'
import { ScriptSchema } from '../domain/script.ts'
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
    hint: '商品图 / 参考图 / 视频 / 链接统一入口（一期 B 接通素材理解）',
  },
  image: {
    label: '图像生成',
    icon: '🖼️',
    phase: '2',
    accent: '#ff7eb6',
    hint: '二期开放：ComfyUI 文生图 / 图生图，多风格视觉资产',
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
    hint: '连入产物卡（图片/视频单帧）后笔刷 / 框选涂抹重绘区，导出 mask PNG（重绘指令 A2 接通）',
  },
  stage3d: {
    label: '3D 运镜台',
    icon: '🎥',
    phase: '3',
    accent: '#2aa8a0',
    hint: '三期开放：摆角色 / 调机位 / 录关键帧，本地预演不耗积分',
  },
  deliver: {
    label: '成片交付',
    icon: '✨',
    phase: '1B',
    accent: '#39c5bb',
    hint: '产物送入剪映草稿三轨对齐链路 / 直接导出（一期 B 接通）',
  },
}

/** 一期 A 可用的节点（1B 节点可摆放但内容为「待接通」占位；2/3 期节点为灰态） */
export function nodeAvailability(kind: CanvasNodeKind): 'ready' | 'pending' | 'locked' {
  // B2 script / B3 storyboard / B4 generate+asset / B5 product+deliver / A1 edit 蜕壳接通
  if (
    kind === 'script' ||
    kind === 'storyboard' ||
    kind === 'generate' ||
    kind === 'asset' ||
    kind === 'product' ||
    kind === 'deliver' ||
    kind === 'edit'
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

/** 写入：分镜结果经 zod 校验后合并进 meta（校验失败返回 null 拒写） */
export function writeStoryboardMetaPayload(
  baseMeta: Record<string, unknown>,
  payload: StoryboardMetaPayload
): Record<string, unknown> | null {
  const parsed = storyboardMetaPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  return { ...baseMeta, ...parsed.data }
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

/** 可持久化产物引用：idbref:// 或 http(s) 直链（blob: 跨刷新失效，禁止入档）——与 asset url 规则一致 */
const persistentUrlSchema = z
  .string()
  .refine(
    (u) => u.startsWith('idbref://') || u.startsWith('http://') || u.startsWith('https://'),
    { message: '产物 url 只允许 idbref:// 引用或 http(s) 直链（blob: 跨刷新失效，禁止持久化）' }
  )

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
  product: ['script', 'image'],
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
