/**
 * 最小 IndexedDB 内存替身（测试专用，非测试文件本身）
 *
 * Node 环境没有 IndexedDB，凡是「浏览器专属 I/O 路径」的单测都需要一个替身驱动，
 * 否则这些路径会变成永久盲区。用法对齐 `src/domain/__tests__/feedback.test.ts` 的既有做法：
 *
 *   installFakeIndexedDb()  // 用例内调用（或 beforeEach）
 *   restoreIndexedDb()      // afterEach 还原，避免污染其它用例
 *
 * 支持 `open / onupgradeneeded / createObjectStore({keyPath}) / put / delete / clear / getAll / transaction`。
 */

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
    /* 索引对本替身无意义：需要排序的调用方在应用层自行排序 */
  }
  put(record: Record<string, unknown>) {
    this.data.set(record[this.keyPath], record)
  }
  delete(key: unknown) {
    this.data.delete(key)
  }
  clear() {
    this.data.clear()
  }
  getAll(): FakeRequest {
    const req: FakeRequest = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null }
    queueMicrotask(() => {
      req.result = [...this.data.values()]
      req.onsuccess?.()
    })
    return req
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
    // 真实 IDB 在事务提交后异步回调，这里同样延迟两拍
    queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()))
    return tx
  }
}

const originalIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB

/** 安装内存替身（同名 DB 在单次安装内共享同一实例，模拟真实连接复用） */
export function installFakeIndexedDb(): void {
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
}

/** 还原真实环境（原值不存在则删除，保证「无 IDB」用例可显式降级） */
export function restoreIndexedDb(): void {
  if (originalIndexedDb === undefined) {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
  } else {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = originalIndexedDb
  }
}

/** 显式卸载（用于「无 IndexedDB 降级」用例） */
export function uninstallIndexedDb(): void {
  delete (globalThis as { indexedDB?: unknown }).indexedDB
}
