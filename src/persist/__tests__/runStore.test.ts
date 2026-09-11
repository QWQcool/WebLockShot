/**
 * runStore（节点执行历史 IndexedDB 存储）单测 —— TODO.md P1 · S3
 *
 * Node 环境没有 IndexedDB，故用共享的内存替身（`./fakeIndexedDb.ts`）驱动 I/O 路径，
 * 避免「Node 覆盖不到」成为永久盲区。覆盖：追加 / 列表（最新在前）/ 滚动裁剪（200 上限淘汰最旧）
 * / 清空 / 订阅 / 无 IDB 降级。
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { RUN_RECORD_LIMIT, type RunRecordInput } from '../../domain/runRecord.ts'
import {
  __resetRunStoreCacheForTest,
  appendRunRecord,
  clearRunRecords,
  listRunRecords,
  peekRunRecords,
  subscribeRunRecords,
} from '../runStore.ts'
import { installFakeIndexedDb, restoreIndexedDb, uninstallIndexedDb } from './fakeIndexedDb.ts'

const input = (over: Partial<RunRecordInput> = {}): RunRecordInput => ({
  kind: 'generate',
  status: 'succeeded',
  startedAt: 1000,
  endedAt: 1250,
  cost: 10,
  refunded: false,
  demo: false,
  ...over,
})

beforeEach(() => {
  __resetRunStoreCacheForTest()
})

afterEach(() => {
  __resetRunStoreCacheForTest()
  restoreIndexedDb()
})

describe('runStore · IndexedDB I/O', () => {
  it('append 落库并回填派生字段；list 最新在前', async () => {
    installFakeIndexedDb()
    const a = await appendRunRecord(input({ startedAt: 1000, endedAt: 1100, shotId: 's1' }))
    const b = await appendRunRecord(input({ startedAt: 2000, endedAt: 2200, shotId: 's2' }))
    assert.ok(a && b)
    assert.equal(a.durationMs, 100)
    assert.equal(b.durationMs, 200)

    const list = await listRunRecords()
    assert.equal(list.length, 2)
    assert.equal(list[0].shotId, 's2', '最新一条应排在最前')
    assert.equal(list[1].shotId, 's1')
  })

  it('滚动裁剪：写入超过上限后只保留最新 200 条（淘汰最旧）', async () => {
    installFakeIndexedDb()
    const total = RUN_RECORD_LIMIT + 5
    for (let i = 0; i < total; i++) {
      await appendRunRecord(input({ startedAt: 1000 + i, endedAt: 1000 + i, shotId: `s${i}` }))
    }
    const list = await listRunRecords()
    assert.equal(list.length, RUN_RECORD_LIMIT)
    // 最新在前：最后写入的 s204 在最前，最旧的 s0..s4 已被淘汰
    assert.equal(list[0].shotId, `s${total - 1}`)
    assert.equal(list[list.length - 1].shotId, `s${total - RUN_RECORD_LIMIT}`)
    assert.equal(
      list.some((r) => r.shotId === 's0'),
      false,
      '最旧记录应被淘汰'
    )
  })

  it('clear 清空全部记录并通知订阅者', async () => {
    installFakeIndexedDb()
    await appendRunRecord(input({ startedAt: 1000, endedAt: 1100 }))
    const seen: number[] = []
    const unsub = subscribeRunRecords((records) => seen.push(records.length))
    await clearRunRecords()
    assert.deepEqual(await listRunRecords(), [])
    assert.deepEqual(peekRunRecords(), [])
    assert.ok(seen.includes(0), '清空后订阅者应收到空列表')
    unsub()
  })

  it('订阅：append 后推送最新列表（最新在前）；取消订阅后不再收到', async () => {
    installFakeIndexedDb()
    const snapshots: string[][] = []
    const unsub = subscribeRunRecords((records) => snapshots.push(records.map((r) => r.shotId ?? '?')))
    await appendRunRecord(input({ startedAt: 1000, endedAt: 1100, shotId: 's1' }))
    await appendRunRecord(input({ startedAt: 2000, endedAt: 2100, shotId: 's2' }))
    assert.deepEqual(snapshots[snapshots.length - 1], ['s2', 's1'])
    unsub()
    const before = snapshots.length
    await appendRunRecord(input({ startedAt: 3000, endedAt: 3100, shotId: 's3' }))
    assert.equal(snapshots.length, before, '取消订阅后不应再收到通知')
  })
})

describe('runStore · 无 IndexedDB 降级（Node / 隐私模式）', () => {
  it('append 返回 null、list 返回 []、clear 静默成功（不抛错打断主流程）', async () => {
    uninstallIndexedDb()
    assert.equal(await appendRunRecord(input()), null)
    assert.deepEqual(await listRunRecords(), [])
    await clearRunRecords()
    assert.deepEqual(peekRunRecords(), [])
  })
})
