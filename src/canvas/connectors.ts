/**
 * D4 连接器面板契约（CANVAS_PLAN.md §6.3 / §9 D4，Miora 图6 1:1）。
 *
 * 诚实边界（红线）：
 * - 本期**不引 `@modelcontextprotocol/sdk`、不接真实第三方**：卡片照常展示，但状态一律如实标注
 *   「⚠️ 接口就绪 · 未接入」；纯前端模式（无伴生服务）另标「无功能可用」；
 * - **不伪造任何生态数据**（无下载量/无连接数/无「已连接」假态）；
 * - 品牌 Logo 不随仓库分发（商标/许可），卡片图标用**首字母字形 + 品牌近似底色**占位，
 *   不引入外部图片资源。
 *
 * 本模块为纯函数（node --test 可跑），不 import React / tldraw / three。
 */
import { z } from 'zod'

/** 连接器分类（图6 卡片副标题口径） */
export const CONNECTOR_CATEGORIES = ['效率办公', '开发工具', '营销推广'] as const
export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number]

/** 官方推荐连接器（图6 七卡片位，id 与伴生服务 /api/connectors 目录保持一致） */
export type RecommendedConnector = {
  id: string
  name: string
  category: ConnectorCategory
  description: string
  /** 卡片图标字形（品牌 Logo 不随仓库分发，用首字母占位） */
  glyph: string
  /** 图标底色（品牌近似色，纯展示） */
  tint: string
}

export const RECOMMENDED_CONNECTORS: readonly RecommendedConnector[] = [
  {
    id: 'notion',
    name: 'Notion',
    category: '效率办公',
    description: '整合页面、数据源与团队知识库内容',
    glyph: 'N',
    tint: '#1f2430',
  },
  {
    id: 'tencent-docs',
    name: '腾讯文档',
    category: '效率办公',
    description: '访问和管理在线文档、表格与文件',
    glyph: '腾',
    tint: '#2b6cf6',
  },
  {
    id: 'airtable',
    name: 'Airtable',
    category: '效率办公',
    description: '管理表格、字段与记录',
    glyph: 'A',
    tint: '#f2c94c',
  },
  {
    id: 'linear',
    name: 'Linear',
    category: '开发工具',
    description: '管理 Issue、项目与开发计划',
    glyph: 'L',
    tint: '#5e6ad2',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: '开发工具',
    description: '访问和管理仓库、Issue 与拉取请求',
    glyph: 'G',
    tint: '#24292f',
  },
  {
    id: 'resend',
    name: 'Resend',
    category: '效率办公',
    description: '发送邮件、管理联系人与营销广播',
    glyph: 'R',
    tint: '#1c1c1c',
  },
  {
    id: 'brevo',
    name: 'Brevo',
    category: '营销推广',
    description: '发送邮件和短信，管理联系人与营销活动',
    glyph: 'B',
    tint: '#0b996e',
  },
]

/* ------------------------------------------------------------------ *
 * 契约：伴生服务 /api/connectors 响应
 * ------------------------------------------------------------------ */

/** 连接器就绪态：interface=接口就绪未接入（本期默认）；ready=已接入（D8 可选依赖）；error=探测失败 */
export const connectorStatusSchema = z.enum(['interface', 'ready', 'error'])
export type ConnectorStatus = z.infer<typeof connectorStatusSchema>

export const connectorEntrySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  category: z.string().min(1).max(30),
  description: z.string().max(200),
  /** 是否已完成授权配置（本期恒 false） */
  configured: z.boolean(),
  status: connectorStatusSchema,
  /** 补充说明（如「未安装 @modelcontextprotocol/sdk」） */
  detail: z.string().max(200).optional(),
})
export type ConnectorEntry = z.infer<typeof connectorEntrySchema>

export const connectorListResponseSchema = z.object({
  mode: z.enum(['interface', 'ready']),
  connectors: z.array(connectorEntrySchema),
})
export type ConnectorListResponse = z.infer<typeof connectorListResponseSchema>

/* ------------------------------------------------------------------ *
 * 自定义连接器（图6「添加自定义连接器」入口）
 * ------------------------------------------------------------------ */

export const customConnectorSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(40),
  category: z.enum(CONNECTOR_CATEGORIES),
  description: z.string().max(120),
  createdAt: z.number().finite().positive(),
})
export type CustomConnector = z.infer<typeof customConnectorSchema>

export const customConnectorInputSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(40, '名称不超过 40 字符'),
  category: z.enum(CONNECTOR_CATEGORIES),
  description: z.string().trim().max(120, '描述不超过 120 字符'),
})

export type CustomConnectorCheck =
  | { ok: true; input: { name: string; category: ConnectorCategory; description: string } }
  | { ok: false; reason: string }

/** 校验自定义连接器输入（中文 reason，整体拒绝不半渲染） */
export function validateCustomConnectorInput(input: unknown): CustomConnectorCheck {
  const parsed = customConnectorInputSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, reason: issue?.message ?? '自定义连接器参数不合法' }
  }
  return { ok: true, input: parsed.data }
}

/** 由校验后的输入构造自定义连接器记录（id 本地生成） */
export function buildCustomConnector(
  input: { name: string; category: ConnectorCategory; description: string },
  now: number = Date.now(),
  rand: string = Math.random().toString(36).slice(2, 8)
): CustomConnector {
  return {
    id: `cc_${now.toString(36)}_${rand}`,
    name: input.name,
    category: input.category,
    description: input.description,
    createdAt: now,
  }
}

/* ------------------------------------------------------------------ *
 * 状态文案（诚实标注，UI 与文档同一口径）
 * ------------------------------------------------------------------ */

/** 连接器状态中文说明（不美化、不伪造「已连接」） */
export function describeConnectorStatus(status: ConnectorStatus): string {
  if (status === 'ready') return '✅ 已接入'
  if (status === 'error') return '⚠️ 探测失败'
  return '⚠️ 接口就绪 · 未接入'
}

/**
 * 纯前端模式（无伴生服务）的目录：把官方推荐位映射为「接口就绪 · 未接入」条目。
 * 用于离线渲染图6 卡片网格（诚实：卡片可看，功能不可用）。
 */
export function localCatalogEntries(): ConnectorEntry[] {
  return RECOMMENDED_CONNECTORS.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    description: c.description,
    configured: false,
    status: 'interface' as const,
  }))
}

/** 自定义连接器 → 目录条目（同样如实标注未接入） */
export function customToEntry(c: CustomConnector): ConnectorEntry {
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    description: c.description,
    configured: false,
    status: 'interface',
  }
}

/**
 * 合并视图：官方目录（或服务端目录）+ 本地自定义连接器。
 * 服务端目录为空/非法时回退本地官方目录（诚实降级，不白屏）。
 */
export function mergeConnectorEntries(
  remote: ConnectorEntry[] | null,
  custom: CustomConnector[]
): ConnectorEntry[] {
  const base = remote && remote.length > 0 ? remote : localCatalogEntries()
  return [...base, ...custom.map(customToEntry)]
}

/* ------------------------------------------------------------------ *
 * 本地自定义连接器存储（Storage 注入，脏值 fail-open 返回空数组）
 * ------------------------------------------------------------------ */

export const CUSTOM_CONNECTORS_KEY = 'weblockshot.connectors.custom' as const

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

/** 读取自定义连接器列表（坏条目跳过，同 id 留最新；不抛异常） */
export function readCustomConnectors(storage?: StorageLike): CustomConnector[] {
  const s = resolveStorage(storage)
  if (!s) return []
  let raw: string | null = null
  try {
    raw = s.getItem(CUSTOM_CONNECTORS_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const byId = new Map<string, CustomConnector>()
  for (const item of parsed) {
    const check = customConnectorSchema.safeParse(item)
    if (check.success) byId.set(check.data.id, check.data)
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt)
}

function writeCustomConnectors(storage: StorageLike | null, list: CustomConnector[]): void {
  if (!storage) return
  try {
    storage.setItem(CUSTOM_CONNECTORS_KEY, JSON.stringify(list))
  } catch {
    // 存储不可用（隐私模式/配额）静默降级：本次会话内仍可用
  }
}

export type AddCustomResult =
  | { ok: true; connectors: CustomConnector[] }
  | { ok: false; reason: string }

/** 追加自定义连接器（名称去重，中文 reason 拒绝） */
export function addCustomConnector(storage: StorageLike | undefined, input: unknown): AddCustomResult {
  const check = validateCustomConnectorInput(input)
  if (!check.ok) return { ok: false, reason: check.reason }
  const s = resolveStorage(storage)
  const list = readCustomConnectors(s ?? undefined)
  if (list.some((c) => c.name === check.input.name)) {
    return { ok: false, reason: `已存在同名连接器「${check.input.name}」` }
  }
  const next = [...list, buildCustomConnector(check.input)]
  writeCustomConnectors(s, next)
  return { ok: true, connectors: next }
}

/** 删除自定义连接器（按 id） */
export function removeCustomConnector(storage: StorageLike | undefined, id: string): CustomConnector[] {
  const s = resolveStorage(storage)
  const next = readCustomConnectors(s ?? undefined).filter((c) => c.id !== id)
  writeCustomConnectors(s, next)
  return next
}
