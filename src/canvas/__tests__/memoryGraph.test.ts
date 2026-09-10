import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMemoryGraph,
  MEMORY_GRAPH_TOP_LEAVES,
  MEMORY_GRAPH_RECENT_LEAVES,
  MEMORY_GRAPH_THUMB_LEAVES,
  type MemoryGraphThumbInput,
} from '../memoryGraph.ts'
import type { FeedbackRecord } from '../../domain/feedback.ts'

function record(partial: Partial<FeedbackRecord>): FeedbackRecord {
  return {
    id: `fb_${Math.random().toString(36).slice(2, 8)}`,
    videoTitle: '测试视频',
    templateId: 'problem-solution',
    hookIndex: 0,
    view3sRate: 0.5,
    completionRate: 0.3,
    createdAt: Date.now(),
    ...partial,
  }
}

test('记忆图谱：空记录 + 无素材 → isEmpty 空态，不摆任何样例节点', () => {
  const model = buildMemoryGraph([], [])
  assert.equal(model.isEmpty, true)
  assert.equal(model.nodes.length, 0)
  assert.equal(model.edges.length, 0)
  assert.equal(model.recordCount, 0)
})

test('记忆图谱：有记录 → 中心 + 结构/钩子/品类三桶 + 真实胜率叶', () => {
  const records = [
    record({ videoTitle: '吹风机速干实测', templateId: 'problem-solution', hookIndex: 0, hookType: '悬念', category: '美妆护肤', view3sRate: 0.6 }),
    record({ videoTitle: '吹风机对比测评', templateId: 'problem-solution', hookIndex: 1, hookType: '痛点', category: '美妆护肤', view3sRate: 0.2 }),
    record({ videoTitle: '厨房收纳演示', templateId: 'listicle', hookIndex: 0, category: '家居日用', view3sRate: 0.8 }),
  ]
  const model = buildMemoryGraph(records, [])
  assert.equal(model.isEmpty, false)
  assert.equal(model.recordCount, 3)

  const center = model.nodes.find((n) => n.kind === 'center')
  assert.ok(center, '中心节点必须存在')

  const buckets = model.nodes.filter((n) => n.kind === 'bucket')
  assert.deepEqual(
    buckets.map((b) => b.label).sort(),
    ['品类', '结构', '钩子'],
    '三桶对齐 computeWinRates 维度'
  )

  // 结构桶叶 = 真实 templateId，按样本数降序（problem-solution 2 样本 > listicle 1 样本）
  const structLeaves = model.nodes.filter((n) => n.bucket === 'structure' && n.kind === 'leaf')
  assert.deepEqual(structLeaves.map((l) => l.label), ['problem-solution', 'listicle'])
  assert.match(structLeaves[0].detail ?? '', /1胜\/2试 · 50%/, '胜率详情为真实 Laplace 统计（0.6 胜 + 0.2 负）')
  assert.match(structLeaves[1].detail ?? '', /1胜\/1试 · 67%/, '第二模板胜率详情真实（0.8 胜）')

  // 钩子桶叶 = 真实 templateId#hookIndex 键
  const hookLeaves = model.nodes.filter((n) => n.bucket === 'hook' && n.kind === 'leaf')
  assert.ok(hookLeaves.every((l) => /^[\w-]+#\d$/.test(l.label)), '钩子叶 label 为真实 templateId#index 键')

  // 品类桶叶 = 真实 category
  const catLeaves = model.nodes.filter((n) => n.bucket === 'category' && n.kind === 'leaf')
  assert.deepEqual(
    catLeaves.map((l) => l.label).sort(),
    ['家居日用', '美妆护肤']
  )
})

test('记忆图谱：桶叶按样本数 Top3 截断，不无限铺开', () => {
  const records = Array.from({ length: 6 }, (_, i) =>
    record({ templateId: `tpl-${i}`, hookIndex: 0, view3sRate: i % 2 ? 0.8 : 0.1 })
  )
  const model = buildMemoryGraph(records, [])
  const structLeaves = model.nodes.filter((n) => n.bucket === 'structure' && n.kind === 'leaf')
  assert.equal(structLeaves.length, MEMORY_GRAPH_TOP_LEAVES)
})

test('记忆图谱：最近回流 videoTitle 气泡来自真实记录且按时间倒序截断', () => {
  const t0 = 1_000_000
  const records = [
    record({ videoTitle: '旧视频A', createdAt: t0 }),
    record({ videoTitle: '新视频B', createdAt: t0 + 5000 }),
    record({ videoTitle: '中视频C', createdAt: t0 + 2000 }),
    record({ videoTitle: '被截断D', createdAt: t0 - 9999 }),
  ]
  const model = buildMemoryGraph(records, [])
  const recentLeaves = model.nodes.filter((n) => n.bucket === 'recent' && n.kind === 'leaf')
  assert.equal(recentLeaves.length, MEMORY_GRAPH_RECENT_LEAVES)
  assert.deepEqual(recentLeaves.map((l) => l.label), ['新视频B', '中视频C', '旧视频A'])
})

test('记忆图谱：素材节点仅在有真实素材引用时出现（无图源如实缺省）', () => {
  const records = [record({})]

  const withoutThumbs = buildMemoryGraph(records, [])
  assert.equal(withoutThumbs.nodes.filter((n) => n.bucket === 'material').length, 0)

  const thumbs: MemoryGraphThumbInput[] = Array.from({ length: 6 }, (_, i) => ({
    ref: `idbref://asset-${i}`,
    label: `素材${i}`,
  }))
  const withThumbs = buildMemoryGraph(records, thumbs)
  const materialBucket = withThumbs.nodes.find((n) => n.bucket === 'material' && n.kind === 'bucket')
  assert.ok(materialBucket, '有素材时素材桶节点存在')
  const materialLeaves = withThumbs.nodes.filter((n) => n.bucket === 'material' && n.kind === 'leaf')
  assert.equal(materialLeaves.length, MEMORY_GRAPH_THUMB_LEAVES)
  assert.ok(materialLeaves.every((l) => typeof l.ref === 'string' && l.ref.startsWith('idbref://')))

  // 空白引用被过滤，不造假叶
  const dirty = buildMemoryGraph(records, [{ ref: '   ', label: '脏数据' }])
  assert.equal(dirty.nodes.filter((n) => n.bucket === 'material').length, 0)
  // 仅有素材（无记录）也不算空态
  const onlyThumbs = buildMemoryGraph([], [{ ref: 'idbref://a', label: 'a' }])
  assert.equal(onlyThumbs.isEmpty, false)
})

test('记忆图谱：布局确定性——同输入两次构建逐字段相等', () => {
  const records = [
    record({ videoTitle: '确定性检查', templateId: 'problem-solution', hookIndex: 0, category: '美妆' }),
  ]
  const thumbs = [{ ref: 'idbref://x', label: 'x' }]
  const a = buildMemoryGraph(records, thumbs)
  const b = buildMemoryGraph(records, thumbs)
  assert.deepEqual(a, b)
  // 坐标为有限数（无 NaN 污染）
  assert.ok(a.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)))
})
