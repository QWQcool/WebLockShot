/**
 * 节点执行历史 IndexedDB 存储层 —— TODO.md P1 · S3
 *
 * 复用项目既有 IndexedDB 惯例（对齐 `src/domain/feedback.ts` / `src/persist/assetStore.ts`）：
 * - **非浏览器环境静默降级**：Node / 无 IndexedDB 时 `append` 返回 null、`list` 返回 []，
 *   绝不抛错打断生成主流程（调用方 UI 会如实标注实际模式）；
 * - **滚动保留**：超过 `RUN_RECORD_LIMIT`（200）时淘汰最旧，裁剪逻辑在
 *   `src/domain/runRecord.ts` 的纯函数里（`trimRunRecords` / `overflowRunIds`），本层只负责 I/O；
 * - **写操作串行化**：内部 promise 链保证 append / clear 不交错（避免读-改-写丢更新）。
 *
 * 为 S4「🕘 运行历史」抽屉预留的接口（数据层契约一次定好，S4 不再改）：
 * - `listRunRecords()`   —— 异步列出（最新在前）
 * - `peekRunRecords()`   —— 同步读最近一次缓存（首帧免 await）
 * - `clearRunRecords()`  —— 手动清空
 * - `subscribeRunRecords()` —— 订阅变更（append / clear 后推送最新列表）
 * - `appendRunRecord()`  —— 由 ExecutorEngine 单一收口调用
 */
import {
  RUN_RECORD_LIMIT,
  createRunRecord,
  overflowRunIds,
  type RunRecord,
  type RunRecordInput,
} from '../domain/runRecord.ts'

const DB_NAME = 'weblockshot-runs'
const DB_VERSION = 1
const STORE_NAME = 'runs'

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB 不可用（非浏览器环境）'))
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'))
  })
}

function getAllRecords(db: IDBDatabase): Promise<RunRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve((req.result as RunRecord[]) || [])
    req.onerror = () => reject(req.error || new Error('读取执行历史失败'))
  })
}

function runTx(db: IDBDatabase, fn: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    fn(tx.objectStore(STORE_NAME))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('执行历史写入失败'))
  })
}

/** 存储顺序 = startedAt 升序（最旧在前）；同刻按 id 稳定排序 */
function sortAscending(records: RunRecord[]): RunRecord[] {
  return [...records].sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ---------------- 写串行化 ----------------

let writeChain: Promise<unknown> = Promise.resolve()

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn)
  // 链上吞掉异常，避免一次失败阻断后续写入（具体错误由各次调用自行处理）
  writeChain = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

// ---------------- 变更订阅 + 同步缓存（S4 首帧免 await） ----------------

let cache: RunRecord[] = []
const listeners = new Set<(records: RunRecord[]) => void>()

function notify() {
  const snapshot = [...cache]
  listeners.forEach((fn) => fn(snapshot))
}

/** 订阅执行历史变更；返回取消订阅函数（React effect cleanup 约定） */
export function subscribeRunRecords(listener: (records: RunRecord[]) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 同步读取最近一次缓存（最新在前）；尚未 load 时返回空数组 */
export function peekRunRecords(): RunRecord[] {
  return [...cache]
}

/**
 * 追加一条执行历史（自动补 id / 派生耗时）并执行滚动裁剪。
 * 返回落库后的记录；非浏览器 / 存储不可用时返回 null（静默降级，不打断主流程）。
 */
export async function appendRunRecord(input: RunRecordInput): Promise<RunRecord | null> {
  const record = createRunRecord(input)
  return enqueueWrite(async () => {
    try {
      const db = await openDb()
      await runTx(db, (store) => store.put(record))

      const ascending = sortAscending(await getAllRecords(db))
      const overflow = overflowRunIds(ascending, RUN_RECORD_LIMIT)
      if (overflow.length > 0) {
        await runTx(db, (store) => {
          for (const id of overflow) store.delete(id)
        })
      }

      const finalAscending = overflow.length > 0 ? await getAllRecords(db) : ascending
      cache = sortAscending(finalAscending).reverse() // 对外「最新在前」
      notify()
      return record
    } catch {
      // 非浏览器环境 / 存储受限：静默降级（记录仅在当前内存流程中缺失，不影响生成）
      return null
    }
  })
}

/** 列出全部执行历史（最新在前）；非浏览器 / 无 IndexedDB 返回 [] */
export async function listRunRecords(): Promise<RunRecord[]> {
  try {
    const db = await openDb()
    const ascending = sortAscending(await getAllRecords(db))
    cache = [...ascending].reverse()
    return [...cache]
  } catch {
    return []
  }
}

/** 手动清空全部执行历史（非浏览器 / 无 IndexedDB 静默成功） */
export async function clearRunRecords(): Promise<void> {
  return enqueueWrite(async () => {
    try {
      const db = await openDb()
      await runTx(db, (store) => store.clear())
    } catch {
      // 静默：无存储可清
    }
    cache = []
    notify()
  })
}

/** 测试用：重置模块级缓存与订阅（不触碰 IndexedDB 数据） */
export function __resetRunStoreCacheForTest(): void {
  cache = []
  listeners.clear()
  writeChain = Promise.resolve()
}
