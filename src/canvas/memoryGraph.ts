/**
 * 记忆图谱布局纯函数（CANVAS_PLAN.md §9 E1，Miora 图4 回炉）
 *
 * 数据真实性（防造假核心）：
 * - 全部节点内容由真实 FeedbackRecord 聚合（computeWinRates）与记录字段（videoTitle/
 *   hookType/category/templateId）生成，**绝不摆样例数据**；
 * - 图片缩略叶仅来自调用方传入的真实素材产物引用（画布 asset 卡），无素材时「素材」
 *   分组节点如实不出现；
 * - records 为空且无素材 → isEmpty = true，UI 渲染诚实空态。
 *
 * 布局为确定性极坐标（同输入同输出，node --test 可断言），不依赖 DOM/随机数。
 * 聚合层强制复用 feedback.ts computeWinRates（纯展示层，聚合零改动）。
 */
import { computeWinRates, WIN_THRESHOLD_3S, type FeedbackRecord } from '../domain/feedback.ts'

export type MemoryGraphBucketKind = 'structure' | 'hook' | 'category' | 'material' | 'recent'

export type MemoryGraphNode = {
  id: string
  kind: 'center' | 'bucket' | 'leaf'
  bucket?: MemoryGraphBucketKind
  /** 节点主文案（真实内容：结构模板 id / 钩子类型 / 品类名 / 视频标题） */
  label: string
  /** 次级文案（真实胜率统计「X胜/Y试 · Z%」或素材说明） */
  detail?: string
  /** 素材缩略叶专用：真实产物引用（idbref:// 或 http(s) 直链） */
  ref?: string
  x: number
  y: number
}

export type MemoryGraphEdge = { from: string; to: string }

export type MemoryGraphThumbInput = {
  /** 真实素材产物引用 */
  ref: string
  label: string
}

export type MemoryGraphModel = {
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
  /** records 为空且无素材 → true（UI 渲染诚实空态，绝不摆样例节点） */
  isEmpty: boolean
  recordCount: number
}

/** 每个聚合桶最多展示的胜率叶数（Top 按样本数） */
export const MEMORY_GRAPH_TOP_LEAVES = 3
/** 最近回流 videoTitle 气泡上限 */
export const MEMORY_GRAPH_RECENT_LEAVES = 3
/** 素材缩略叶上限 */
export const MEMORY_GRAPH_THUMB_LEAVES = 4

const BUCKET_LABEL: Record<string, string> = {
  structure: '结构',
  hook: '钩子',
  category: '品类',
  material: '素材',
}

/** 二级节点固定方位角（度，0 = 正右，逆时针为负 y 方向适配屏幕坐标） */
const BUCKET_ANGLE: Record<string, number> = {
  structure: 200,
  hook: 340,
  category: 250,
  material: 290,
}
const R_BUCKET = 190
const R_LEAF = 170
/** 最近回流叶：右侧水平扇区（避免与顶栏/桶叶重叠） */
const R_RECENT = 300
const RECENT_ANGLES = [-40, 0, 40]

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  // 屏幕坐标 y 向下：取 -sin 使「角度增大 = 逆时针」的直觉成立
  return { x: Math.round(cx + r * Math.cos(rad)), y: Math.round(cy + r * -Math.sin(rad)) }
}

function winDetail(stat: { wins: number; trials: number; winRate: number }): string {
  return `${stat.wins}胜/${stat.trials}试 · ${Math.round(stat.winRate * 100)}%`
}

function topEntries(map: Map<string, { trials: number; wins: number; winRate: number }>, n: number) {
  return [...map.entries()].sort((a, b) => b[1].trials - a[1].trials).slice(0, n)
}

/**
 * 构建记忆图谱模型（确定性纯函数）。
 *
 * 结构（对齐图4）：
 * - 中心主节点（持续记忆）；
 * - 二级分类节点：结构 / 钩子 / 品类（对齐 computeWinRates 三桶）+ 素材（仅有真实素材时）；
 * - 叶子：聚合胜率文本气泡（各桶 Top3）+ 最近回流 videoTitle 气泡（挂中心）+ 素材缩略卡。
 */
export function buildMemoryGraph(
  records: FeedbackRecord[],
  thumbs: MemoryGraphThumbInput[] = []
): MemoryGraphModel {
  const nodes: MemoryGraphNode[] = []
  const edges: MemoryGraphEdge[] = []
  const isEmpty = records.length === 0 && thumbs.length === 0

  if (isEmpty) {
    return { nodes, edges, isEmpty: true, recordCount: 0 }
  }

  nodes.push({ id: 'center', kind: 'center', label: '持续记忆', detail: '个人记忆', x: 0, y: 0 })

  const aggregate = computeWinRates(records)

  // 三个聚合桶 + 各自 Top 胜率叶（真实 key 与统计，无数据桶不摆叶）
  const buckets: Array<{
    kind: 'structure' | 'hook' | 'category'
    entries: Array<[string, { trials: number; wins: number; winRate: number }]>
  }> = [
    { kind: 'structure', entries: topEntries(aggregate.byTemplate, MEMORY_GRAPH_TOP_LEAVES) },
    { kind: 'hook', entries: topEntries(aggregate.byHook, MEMORY_GRAPH_TOP_LEAVES) },
    { kind: 'category', entries: topEntries(aggregate.byCategory, MEMORY_GRAPH_TOP_LEAVES) },
  ]

  for (const b of buckets) {
    const pos = polar(0, 0, R_BUCKET, BUCKET_ANGLE[b.kind])
    const bucketId = `bucket-${b.kind}`
    nodes.push({
      id: bucketId,
      kind: 'bucket',
      bucket: b.kind,
      label: BUCKET_LABEL[b.kind],
      detail: `${b.entries.length} 项`,
      x: pos.x,
      y: pos.y,
    })
    edges.push({ from: 'center', to: bucketId })

    b.entries.forEach(([key, stat], i) => {
      // 叶子在桶方位角两侧展开（确定性：按 Top 序从左到右）
      const spread = (i - (b.entries.length - 1) / 2) * 26
      const pos = polar(0, 0, R_BUCKET + R_LEAF, BUCKET_ANGLE[b.kind] + spread)
      const leafId = `leaf-${b.kind}-${i}`
      nodes.push({ id: leafId, kind: 'leaf', bucket: b.kind, label: key, detail: winDetail(stat), x: pos.x, y: pos.y })
      edges.push({ from: bucketId, to: leafId })
    })
  }

  // 素材节点 + 缩略叶：仅当调用方传入真实素材产物时出现（无图源如实缺省）
  const realThumbs = thumbs.filter((t) => typeof t.ref === 'string' && t.ref.trim() !== '')
  if (realThumbs.length > 0) {
    const pos = polar(0, 0, R_BUCKET, BUCKET_ANGLE.material)
    nodes.push({ id: 'bucket-material', kind: 'bucket', bucket: 'material', label: '素材', detail: `${Math.min(realThumbs.length, MEMORY_GRAPH_THUMB_LEAVES)} 项`, x: pos.x, y: pos.y })
    edges.push({ from: 'center', to: 'bucket-material' })

    realThumbs.slice(0, MEMORY_GRAPH_THUMB_LEAVES).forEach((t, i) => {
      const spread = (i - (Math.min(realThumbs.length, MEMORY_GRAPH_THUMB_LEAVES) - 1) / 2) * 30
      const leafPos = polar(0, 0, R_BUCKET + R_LEAF, BUCKET_ANGLE.material + spread)
      const leafId = `leaf-material-${i}`
      nodes.push({ id: leafId, kind: 'leaf', bucket: 'material', label: t.label, ref: t.ref, x: leafPos.x, y: leafPos.y })
      edges.push({ from: 'bucket-material', to: leafId })
    })
  }

  // 最近回流 videoTitle 气泡：真实记录内容，挂中心（图4 中直接连主节点的行为记忆文本气泡）
  const recent = [...records]
    .filter((r) => typeof r.videoTitle === 'string' && r.videoTitle.trim() !== '')
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, MEMORY_GRAPH_RECENT_LEAVES)
  recent.forEach((r, i) => {
    // 中心右侧水平扇区展开（角度确定性取 RECENT_ANGLES，超出截断）
    const deg = RECENT_ANGLES[i % RECENT_ANGLES.length]
    const pos = polar(0, 0, R_RECENT, deg)
    const leafId = `leaf-recent-${i}`
    const win = r.view3sRate >= WIN_THRESHOLD_3S
    nodes.push({
      id: leafId,
      kind: 'leaf',
      bucket: 'recent',
      label: r.videoTitle,
      detail: `3s完播 ${Math.round(r.view3sRate * 100)}% · ${win ? '胜出' : '未胜'}`,
      x: pos.x,
      y: pos.y,
    })
    edges.push({ from: 'center', to: leafId })
  })

  return { nodes, edges, isEmpty: false, recordCount: records.length }
}
