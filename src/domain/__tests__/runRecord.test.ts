/**
 * RunRecord 契约单测（TODO.md P1 · S3）
 *
 * 覆盖：生成（成功 / 失败 / 演示 三种状态）+ 滚动裁剪（200 上限淘汰最旧）+ 淘汰 id 计算。
 * 纯函数优先（对齐项目既有单测风格：node --test + node:assert/strict）。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  RUN_RECORD_LIMIT,
  RunRecordSchema,
  createRunRecord,
  overflowRunIds,
  trimRunRecords,
  type RunRecord,
  type RunRecordInput,
} from '../runRecord.ts'

const base = (over: Partial<RunRecordInput> = {}): RunRecordInput => ({
  kind: 'generate',
  status: 'succeeded',
  startedAt: 1000,
  endedAt: 1250,
  cost: 10,
  refunded: false,
  demo: false,
  ...over,
})

describe('createRunRecord（生成）', () => {
  it('成功记录：字段完整（状态 / 耗时 / 费用 / 是否退款），派生 durationMs', () => {
    const rec = createRunRecord(base({ nodeId: 'shape:wls-1', provider: 'kling', shotId: 's1' }), 42)
    assert.equal(RunRecordSchema.safeParse(rec).success, true)
    assert.equal(rec.status, 'succeeded')
    assert.equal(rec.kind, 'generate')
    assert.equal(rec.nodeId, 'shape:wls-1')
    assert.equal(rec.startedAt, 1000)
    assert.equal(rec.endedAt, 1250)
    assert.equal(rec.durationMs, 250)
    assert.equal(rec.cost, 10)
    assert.equal(rec.refunded, false)
    assert.equal(rec.demo, false)
    assert.ok(rec.id.startsWith('run_42_'), 'id 应带注入的时间戳前缀')
  })

  it('失败记录：保留失败原因，并标记已退款', () => {
    const rec = createRunRecord(
      base({ status: 'failed', refunded: true, error: '轮询超时', cost: 8, provider: 'jimeng' })
    )
    assert.equal(rec.status, 'failed')
    assert.equal(rec.refunded, true)
    assert.equal(rec.error, '轮询超时')
    assert.equal(rec.durationMs, 250)
  })

  it('演示记录：provider=mock 时 demo=true（UI 据此标注「演示 · 非真实生成」）', () => {
    const rec = createRunRecord(base({ demo: true, provider: 'mock', cost: 0 }))
    assert.equal(rec.demo, true)
    assert.equal(rec.cost, 0)
    assert.equal(rec.provider, 'mock')
  })

  it('running 态不派生 durationMs（尚未结束）', () => {
    const rec = createRunRecord(base({ status: 'running', endedAt: undefined }))
    assert.equal(rec.status, 'running')
    assert.equal(rec.endedAt, undefined)
    assert.equal(rec.durationMs, undefined)
  })

  it('cost / refunded / demo 缺省时按 0 / false / false 补齐（不因缺字段抛错）', () => {
    const rec = createRunRecord({ kind: 'generate', status: 'succeeded', startedAt: 1, endedAt: 2 })
    assert.equal(rec.cost, 0)
    assert.equal(rec.refunded, false)
    assert.equal(rec.demo, false)
    assert.equal(rec.durationMs, 1)
  })

  it('非法输入（kind 为空串）被 zod 拒绝', () => {
    assert.throws(() => createRunRecord(base({ kind: '' })))
  })
})

describe('trimRunRecords（滚动裁剪，200 上限淘汰最旧）', () => {
  const makeList = (n: number): RunRecord[] =>
    Array.from({ length: n }, (_, i) =>
      createRunRecord(base({ startedAt: 1000 + i, endedAt: 1000 + i }))
    )

  it('未超上限时原样返回（不做任何淘汰）', () => {
    const list = makeList(RUN_RECORD_LIMIT)
    const kept = trimRunRecords(list)
    assert.equal(kept.length, RUN_RECORD_LIMIT)
    assert.equal(kept[0], list[0])
  })

  it('超上限时淘汰最旧，保留最新 200 条', () => {
    const list = makeList(RUN_RECORD_LIMIT + 5)
    const kept = trimRunRecords(list)
    assert.equal(kept.length, RUN_RECORD_LIMIT)
    // 最旧的 5 条（startedAt 1000..1004）应被淘汰
    assert.equal(kept[0].startedAt, 1005)
    assert.equal(kept[kept.length - 1].startedAt, 1000 + RUN_RECORD_LIMIT + 4)
  })

  it('自定义上限生效；limit<=0 返回空', () => {
    const list = makeList(10)
    assert.equal(trimRunRecords(list, 3).length, 3)
    assert.deepEqual(trimRunRecords(list, 0), [])
  })
})

describe('overflowRunIds（淘汰清单，供存储层精确 delete）', () => {
  const makeList = (n: number): RunRecord[] =>
    Array.from({ length: n }, (_, i) => createRunRecord(base({ startedAt: 1000 + i, endedAt: 1000 + i })))

  it('未超上限返回空（不删任何记录）', () => {
    assert.deepEqual(overflowRunIds(makeList(RUN_RECORD_LIMIT)), [])
  })

  it('超上限返回最旧的超额 id，且与 trim 保留集互补', () => {
    const list = makeList(RUN_RECORD_LIMIT + 3)
    const dropped = overflowRunIds(list)
    assert.equal(dropped.length, 3)
    assert.deepEqual(dropped, list.slice(0, 3).map((r) => r.id))
    const keptIds = new Set(trimRunRecords(list).map((r) => r.id))
    for (const id of dropped) assert.equal(keptIds.has(id), false, '被淘汰的 id 不应出现在保留集')
  })
})
