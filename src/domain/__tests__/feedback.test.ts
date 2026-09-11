/**
 * 回流聚合层单测（T2 覆盖率基线补口）
 *
 * 红线遵守：本文件**不改** src/domain/feedback.ts（computeWinRates 是唯一聚合层），
 * 只补两件事：
 *   ① 纯函数（Laplace 胜率 / 阈值边界 / lookup 构建）的行为钉死；
 *   ② 浏览器专属的 IndexedDB I/O 路径（add / getAll / clear / 无 IDB 降级）用一个
 *      最小内存替身驱动，避免「Node 环境覆盖不到」变成永久盲区。
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  WIN_THRESHOLD_3S,
  addFeedbackRecord,
  buildWinRateLookup,
  clearAllFeedbackRecords,
  computeWinRates,
  getAllFeedbackRecords,
  type FeedbackRecord,
} from '../feedback.ts'

// ---------------- 最小 IndexedDB 内存替身 ----------------

type FakeRequest = {
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  onupgradeneeded: (() => void) | null
  result: unknown
  error: unknown
}

class FakeObjectStore {
  data = new Map<unknown, Record<string, unknown>>()
  keyPath: string
  constructor(keyPath: string) {
    this.keyPath = keyPath
  }
  createIndex() {
    /* 索引对本替身无意义，聚合在内存 Map 上完成 */
  }
  put(record: Record<string, unknown>) {
    this.data.set(record[this.keyPath], record)
  }
  getAll(): FakeRequest {
    const req: FakeRequest = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null }
    queueMicrotask(() => {
      req.result = [...this.data.values()]
      req.onsuccess?.()
    })
    return req
  }
  clear() {
    this.data.clear()
  }
}

class FakeDb {
  stores = new Map<string, FakeObjectStore>()
  objectStoreNames = { contains: (name: string) => this.stores.has(name) }
  createObjectStore(name: string, opts: { keyPath: string }) {
    const store = new FakeObjectStore(opts.keyPath)
    this.stores.set(name, store)
    return store
  }
  transaction(name: string, _mode: string) {
    const store = this.stores.get(name)
    if (!store) throw new Error(`store 不存在: ${name}`)
    const tx = {
      objectStore: () => store,
      error: null as unknown,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
    }
    // 真实 IDB 在事务提交后异步回调，这里同样延迟一拍
    queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()))
    return tx
  }
}

function installFakeIndexedDb() {
  const dbs = new Map<string, FakeDb>()
  const fake = {
    open(name: string, _version: number): FakeRequest {
      const req: FakeRequest = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null }
      queueMicrotask(() => {
        let db = dbs.get(name)
        const isNew = !db
        if (!db) {
          db = new FakeDb()
          dbs.set(name, db)
        }
        req.result = db
        if (isNew) req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
  }
  ;(globalThis as { indexedDB?: unknown }).indexedDB = fake
  return fake
}

const originalIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB

afterEach(() => {
  if (originalIndexedDb === undefined) {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
  } else {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = originalIndexedDb
  }
})

const rec = (over: Partial<FeedbackRecord>): FeedbackRecord => ({
  videoTitle: 't',
  templateId: 'T1',
  hookIndex: 0,
  view3sRate: 0.5,
  completionRate: 0.5,
  ...over,
})

// ---------------- 纯函数聚合 ----------------

describe('computeWinRates（Laplace 平滑，唯一聚合层）', () => {
  it('按结构/钩子/品类三路聚合，胜率 = (wins+1)/(trials+2)', () => {
    const agg = computeWinRates([
      rec({ templateId: 'T1', hookIndex: 0, view3sRate: 0.4, category: 'food' }),
      rec({ templateId: 'T1', hookIndex: 0, view3sRate: 0.3, category: 'food' }),
      rec({ templateId: 'T1', hookIndex: 0, view3sRate: 0.2 }),
    ])
    const tpl = agg.byTemplate.get('T1')
    assert.equal(tpl?.trials, 3)
    assert.equal(tpl?.wins, 2)
    assert.equal(tpl?.winRate, 0.6)
    assert.equal(agg.byHook.get('T1#0')?.winRate, 0.6)
    const food = agg.byCategory.get('food')
    assert.equal(food?.trials, 2)
    assert.equal(food?.wins, 2)
    assert.equal(food?.winRate, 0.75)
    // 第三条无 category（且非空白），不入品类聚合
    assert.equal(agg.byCategory.size, 1)
  })

  it('阈值边界：view3sRate 恰好等于 30% 记为胜出；低于则记为负', () => {
    const agg = computeWinRates([
      rec({ templateId: 'A', hookIndex: 0, view3sRate: WIN_THRESHOLD_3S }),
      rec({ templateId: 'B', hookIndex: 0, view3sRate: WIN_THRESHOLD_3S - 0.0001 }),
    ])
    assert.equal(agg.byTemplate.get('A')?.wins, 1)
    assert.equal(agg.byTemplate.get('B')?.wins, 0)
  })

  it('空白品类不聚合（trim 后为空即跳过）', () => {
    const agg = computeWinRates([rec({ category: '   ' }), rec({ category: undefined })])
    assert.equal(agg.byCategory.size, 0)
  })

  it('品类键做 trim 归一（同品类不同空白写法合并）', () => {
    const agg = computeWinRates([rec({ category: ' 食品 ' }), rec({ category: '食品' })])
    assert.equal(agg.byCategory.size, 1)
    assert.equal(agg.byCategory.get('食品')?.trials, 2)
  })

  it('空记录 → 三路聚合皆空（不摆样例）', () => {
    const agg = computeWinRates([])
    assert.equal(agg.byTemplate.size, 0)
    assert.equal(agg.byHook.size, 0)
    assert.equal(agg.byCategory.size, 0)
  })
})

describe('buildWinRateLookup', () => {
  it('无记录返回 undefined（采样回退先验）', () => {
    assert.equal(buildWinRateLookup([]), undefined)
  })

  it('有记录返回查询器：命中返回 Laplace 胜率，未命中返回 undefined', () => {
    const lookup = buildWinRateLookup([
      rec({ templateId: 'T1', hookIndex: 1, view3sRate: 0.9 }),
      rec({ templateId: 'T1', hookIndex: 1, view3sRate: 0.1 }),
    ])
    assert.ok(lookup)
    assert.equal(lookup?.('T1', 1), 0.5)
    assert.equal(lookup?.('T1', 2), undefined)
    assert.equal(lookup?.('NOPE', 0), undefined)
  })
})

// ---------------- IndexedDB I/O 路径 ----------------

describe('IndexedDB I/O（add / getAll / clear）', () => {
  it('addFeedbackRecord 写入并自动补 id/createdAt；getAllFeedbackRecords 读回', async () => {
    installFakeIndexedDb()
    const saved = await addFeedbackRecord({
      videoTitle: '保温杯',
      templateId: 'T1',
      hookIndex: 0,
      view3sRate: 0.5,
      completionRate: 0.5,
    })
    assert.match(saved.id ?? '', /^fb_\d+_[a-z0-9]+$/)
    assert.equal(typeof saved.createdAt, 'number')

    const all = await getAllFeedbackRecords()
    assert.equal(all.length, 1)
    assert.equal(all[0].videoTitle, '保温杯')
  })

  it('addFeedbackRecord 非法入参抛错（zod 拒绝，不写库）', async () => {
    installFakeIndexedDb()
    await assert.rejects(
      () =>
        addFeedbackRecord({
          videoTitle: '',
          templateId: 'T1',
          hookIndex: 0,
          view3sRate: 0.5,
          completionRate: 0.5,
        }),
      /videoTitle/
    )
  })

  it('clearAllFeedbackRecords 清空后读取为空数组', async () => {
    installFakeIndexedDb()
    await addFeedbackRecord({
      videoTitle: 'a',
      templateId: 'T1',
      hookIndex: 0,
      view3sRate: 0.5,
      completionRate: 0.5,
    })
    await clearAllFeedbackRecords()
    assert.deepEqual(await getAllFeedbackRecords(), [])
  })

  it('无 IndexedDB（Node 环境）时读取降级空数组、清空静默成功', async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
    assert.deepEqual(await getAllFeedbackRecords(), [])
    await clearAllFeedbackRecords()
  })

  it('无 IndexedDB 时写入显式抛错（不伪造成功）', async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
    await assert.rejects(
      () =>
        addFeedbackRecord({
          videoTitle: 'x',
          templateId: 'T1',
          hookIndex: 0,
          view3sRate: 0.5,
          completionRate: 0.5,
        }),
      /IndexedDB 不可用/
    )
  })
})
