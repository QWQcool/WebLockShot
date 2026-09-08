/**
 * 大体积资产 IndexedDB 存储 (Asset Store)
 *
 * base64 图片/视频等大对象不再塞进 localStorage（只存 idbref:// 索引），
 * 落 IndexedDB 后按需恢复为 blob objectURL。
 * 仅浏览器环境可用；Node 测试环境请使用注入式 resolver 测试 hydrate 逻辑。
 */

const DB_NAME = 'weblockshot-assets'
const DB_VERSION = 1
const STORE_NAME = 'assets'

export const IDB_REF_PREFIX = 'idbref://'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB 不可用（非浏览器环境）'))
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'))
    })
  }
  return dbPromise
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream'
  const binary = atob(body || '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** 将 dataURL 存入 IndexedDB，返回 idbref:// 引用；失败时返回 null（调用方保留原 dataURL 亦可） */
export async function putDataUrlAsset(id: string, dataUrl: string): Promise<string | null> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(dataUrlToBlob(dataUrl), id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('写入 IndexedDB 失败'))
    })
    return `${IDB_REF_PREFIX}${id}`
  } catch (err) {
    console.warn('[AssetStore] 资产写入 IndexedDB 失败，保留原 dataURL:', err)
    return null
  }
}

/**
 * 将 Blob 直接存入 IndexedDB，返回 idbref:// 引用（B4：Mock 引擎产物为 blob objectURL，
 * 跨刷新失效，必须在落档前转为 IndexedDB 持久引用）；失败时返回 null。
 */
export async function putBlobAsset(id: string, blob: Blob): Promise<string | null> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(blob, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('写入 IndexedDB 失败'))
    })
    return `${IDB_REF_PREFIX}${id}`
  } catch (err) {
    console.warn('[AssetStore] Blob 资产写入 IndexedDB 失败:', err)
    return null
  }
}

/** 读取资产并生成 blob objectURL；不存在返回 null */
export async function getAssetObjectUrl(id: string): Promise<string | null> {
  try {
    const db = await openDb()
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(id)
      req.onsuccess = () => resolve(req.result as Blob | undefined)
      req.onerror = () => reject(req.error || new Error('读取 IndexedDB 失败'))
    })
    if (!blob) return null
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

/** 删除单个资产 */
export async function deleteAsset(id: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('删除失败'))
    })
  } catch {
    // ignore
  }
}

/** 解析 idbref 引用；非引用原样返回 */
export function isIdbRef(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.startsWith(IDB_REF_PREFIX)
}

export function idbRefToId(ref: string): string {
  // B4：idbref 可带 ？v= 版本参数（产物重生成后强制播放器重新 hydrate），解析时剥离
  return ref.slice(IDB_REF_PREFIX.length).split('?')[0] ?? ''
}
