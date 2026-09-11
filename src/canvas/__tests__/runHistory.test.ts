/**
 * 运行历史纯函数单测（P1 · S4）
 *
 * 重点钉死两条易错逻辑：
 * ① **持久输出引用解析**——`record.outputRef` 是 blob: 时必须回查节点 meta（而不是把失效引用当持久用）；
 * ② **退款徽章判定**——0 币失败（mock）不得显示成「已退款」。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRunRecord, type RunRecordInput } from '../../domain/runRecord.ts'
import {
  formatCost,
  formatDuration,
  isDurableOutputRef,
  resolveRunOutputRef,
  runStatusLabel,
  shortNodeId,
  showsRefundBadge,
  summarizeRuns,
} from '../runHistory.ts'

const rec = (over: Partial<RunRecordInput> = {}) =>
  createRunRecord({
    kind: 'generate',
    status: 'succeeded',
    startedAt: 1000,
    endedAt: 1250,
    cost: 10,
    refunded: false,
    demo: false,
    ...over,
  })

describe('isDurableOutputRef（持久引用判定）', () => {
  it('idbref:// 与 http(s) 直链算持久；blob: / data: / 相对路径 / 空值不算', () => {
    assert.equal(isDurableOutputRef('idbref://img_abc'), true)
    assert.equal(isDurableOutputRef('http://x/y.webm'), true)
    assert.equal(isDurableOutputRef('https://x/y.webm'), true)
    assert.equal(isDurableOutputRef('blob:http://127.0.0.1/abc'), false)
    assert.equal(isDurableOutputRef('data:video/webm;base64,AAA'), false)
    assert.equal(isDurableOutputRef('presets/a.jpg'), false)
    assert.equal(isDurableOutputRef(undefined), false)
    assert.equal(isDurableOutputRef(null), false)
  })
})

describe('resolveRunOutputRef（nodeId → 节点 meta → idbref）', () => {
  it('记录自带持久引用 → 直接采用（不触发回查）', () => {
    let called = 0
    const r = resolveRunOutputRef({ outputRef: 'https://cdn/x.webm', nodeId: 'shape:wls-1' }, () => {
      called++
      return 'idbref://never'
    })
    assert.equal(r.source, 'record')
    assert.equal(r.ref, 'https://cdn/x.webm')
    assert.equal(r.staleBlob, false)
    assert.equal(called, 0, '已有持久引用时不应回查节点 meta')
  })

  it('记录是 blob: 但节点 meta 有 idbref → 采用 meta 引用，并标记 staleBlob', () => {
    const r = resolveRunOutputRef(
      { outputRef: 'blob:http://127.0.0.1/dead', nodeId: 'shape:wls-9', shotId: 'story-s1' },
      (nodeId, shotId) => {
        assert.equal(nodeId, 'shape:wls-9')
        assert.equal(shotId, 'story-s1')
        return 'idbref://video_abc'
      }
    )
    assert.equal(r.source, 'node-meta')
    assert.equal(r.ref, 'idbref://video_abc')
    assert.equal(r.staleBlob, true, '记录里的 blob: 仍需如实标记为失效')
  })

  it('blob: 且 meta 回查不到 → none（不伪造引用）', () => {
    const r = resolveRunOutputRef({ outputRef: 'blob:x', nodeId: 'shape:wls-9' }, () => undefined)
    assert.equal(r.source, 'none')
    assert.equal(r.ref, undefined)
    assert.equal(r.staleBlob, true)
  })

  it('无 outputRef 且无 nodeId → none（失败记录常见）', () => {
    const r = resolveRunOutputRef({ outputRef: undefined, nodeId: undefined })
    assert.deepEqual(r, { source: 'none', staleBlob: false })
  })
})

describe('展示格式化', () => {
  it('formatDuration：undefined → —；<1s → ms；<60s → 秒（1 位小数）；≥60s → 分秒', () => {
    assert.equal(formatDuration(undefined), '—')
    assert.equal(formatDuration(999), '999 ms')
    assert.equal(formatDuration(1200), '1.2 s')
    assert.equal(formatDuration(65_000), '1 分 05 秒')
  })

  it('formatCost：0 → 「0 灵感币（未扣费）」；正数 → 「N 灵感币」', () => {
    assert.equal(formatCost(0), '0 灵感币（未扣费）')
    assert.equal(formatCost(10), '10 灵感币')
  })

  it('runStatusLabel / shortNodeId', () => {
    assert.equal(runStatusLabel('succeeded'), '成功')
    assert.equal(runStatusLabel('failed'), '失败')
    assert.equal(runStatusLabel('running'), '进行中')
    assert.equal(shortNodeId('shape:wls-abc123'), 'wls-abc123')
    assert.equal(shortNodeId(undefined), '未关联节点')
  })
})

describe('showsRefundBadge（0 币不得显示已退款）', () => {
  it('cost>0 且 refunded → true；cost=0 即使 refunded 也 false；未退款 false', () => {
    assert.equal(showsRefundBadge({ cost: 10, refunded: true }), true)
    assert.equal(showsRefundBadge({ cost: 0, refunded: true }), false)
    assert.equal(showsRefundBadge({ cost: 10, refunded: false }), false)
  })
})

describe('summarizeRuns（抽屉头部汇总）', () => {
  it('统计成功/失败次数，净消耗与已退回分开计（退款不计入消耗）', () => {
    const s = summarizeRuns([
      rec({ status: 'succeeded', cost: 10 }),
      rec({ status: 'succeeded', cost: 0, demo: true }),
      rec({ status: 'failed', cost: 8, refunded: true }),
      rec({ status: 'failed', cost: 0, demo: true }), // 0 币失败：不计入「已退回」
    ])
    assert.deepEqual(s, { total: 4, succeeded: 2, failed: 2, charged: 10, refunded: 8 })
  })

  it('空列表 → 全 0（不摆样例）', () => {
    assert.deepEqual(summarizeRuns([]), { total: 0, succeeded: 0, failed: 0, charged: 0, refunded: 0 })
  })
})
