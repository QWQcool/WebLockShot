import test from 'node:test'
import assert from 'node:assert/strict'

import { buildWinRateLookup, computeWinRates, type FeedbackRecord } from '../../domain/feedback.ts'
import { weightedSampleHook } from '../../prompts/library/structures.ts'
import { resolveMemorySource, type MemorySourceDeps } from '../memorySource.ts'
import { STRUCTURE_TEMPLATES } from '../../prompts/library/structures.ts'

/** 固定记录组（覆盖胜/负 + 品类有无） */
function makeRecords(): FeedbackRecord[] {
  return [
    { videoTitle: 'a', templateId: 't1_pain_opening', hookIndex: 0, view3sRate: 0.5, completionRate: 0.4, category: '饮品' },
    { videoTitle: 'b', templateId: 't1_pain_opening', hookIndex: 0, view3sRate: 0.2, completionRate: 0.1, category: '饮品' },
    { videoTitle: 'c', templateId: 't1_pain_opening', hookIndex: 0, view3sRate: 0.9, completionRate: 0.8 },
    { videoTitle: 'd', templateId: 't2_contrast_reveal', hookIndex: 1, view3sRate: 0.6, completionRate: 0.5, category: '美妆' },
  ]
}

const serverDeps = (records: unknown[]): MemorySourceDeps => ({
  probe: async () => ({ serverMode: true }),
  fetchRecords: async () => ({ ok: true, records }),
})

test('S3 双模聚合对拍：server 模式与本地 computeWinRates/buildWinRateLookup 产出一致', async () => {
  const records = makeRecords()

  // server 模式（records 来自注入的 fetch mock）
  const server = await resolveMemorySource(serverDeps(records))
  assert.equal(server.mode, 'server')
  assert.equal(server.records.length, 4)

  // 本地同源构建（buildWinRateLookup 直接吃同一组 records）
  const localLookup = buildWinRateLookup(records)
  const localAggregate = computeWinRates(records)

  // 聚合对拍：byTemplate / byHook / byCategory 三张表逐 key 一致
  for (const bucket of ['byTemplate', 'byHook', 'byCategory'] as const) {
    assert.deepEqual(
      [...server.aggregate[bucket].entries()],
      [...localAggregate[bucket].entries()],
      `bucket=${bucket} 两路聚合必须一致`
    )
  }

  // lookup 对拍：t1#0 Laplace = (2胜+1)/(3试+2) = 3/5；t2#1 = (1+1)/(1+2) = 2/3
  assert.ok(server.lookup)
  assert.equal(server.lookup?.('t1_pain_opening', 0), 3 / 5)
  assert.equal(server.lookup?.('t1_pain_opening', 0), localLookup?.('t1_pain_opening', 0))
  assert.equal(server.lookup?.('t2_contrast_reveal', 1), 2 / 3)
  assert.equal(server.lookup?.('t2_contrast_reveal', 1), localLookup?.('t2_contrast_reveal', 1))
  // 无数据的钩子键回退 undefined（采样回退先验）
  assert.equal(server.lookup?.('t1_pain_opening', 5), undefined)
})

test('S3 加权采样可复现：注入 lookup 后 weightedSampleHook 与 sell 模式同源可复现', () => {
  const records = makeRecords()
  const lookup = buildWinRateLookup(records)
  assert.ok(lookup)

  const template = STRUCTURE_TEMPLATES.find((t) => t.id === 't1_pain_opening')
  assert.ok(template)

  // 固定 rng 下两次采样结果一致（确定性），且与手工 computeWinRates 聚合驱动的 lookup 同源
  const a = weightedSampleHook(template, lookup, () => 0.99)
  const b = weightedSampleHook(template, lookup, () => 0.99)
  assert.equal(a.text, b.text)

  // lookup undefined（无历史数据）时先验路径不抛错
  const prior = weightedSampleHook(template, undefined, () => 0.99)
  assert.ok(prior.text.length > 0)
})

test('S3 模式判定：探测 off → 纯前端本地模式（records 走 IndexedDB，node 环境=空）', async () => {
  const local = await resolveMemorySource({
    probe: async () => ({ serverMode: false }),
    fetchRecords: async () => ({ ok: true, records: makeRecords() }), // 不应被调用
  })
  assert.equal(local.mode, 'local')
  // node --test 环境无 IndexedDB → getAllFeedbackRecords 返回 [] → lookup undefined（先验）
  assert.equal(local.records.length, 0)
  assert.equal(local.lookup, undefined)
})

test('S3 优雅降级：服务端拉取失败 → 本地模式（不抛异常、不半渲染）', async () => {
  const degraded = await resolveMemorySource({
    probe: async () => ({ serverMode: true }),
    fetchRecords: async () => ({ ok: false, error: 'boom' }),
  })
  assert.equal(degraded.mode, 'local')
  assert.equal(degraded.records.length, 0)
  assert.equal(degraded.lookup, undefined)

  // 探测本身抛异常同样降级
  const crashed = await resolveMemorySource({
    probe: async () => {
      throw new Error('probe crashed')
    },
  })
  assert.equal(crashed.mode, 'local')
})

test('S3 记录形状防线：服务端混入非法形状记录被过滤（zod 收口前的最小防线）', async () => {
  const server = await resolveMemorySource(
    serverDeps([
      makeRecords()[0],
      { videoTitle: 123, templateId: 'x', hookIndex: 0, view3sRate: 0.5, completionRate: 0.5 }, // 类型非法
      'not-an-object',
      null,
    ])
  )
  assert.equal(server.mode, 'server')
  assert.equal(server.records.length, 1)
  assert.equal(server.records[0].videoTitle, 'a')
})
