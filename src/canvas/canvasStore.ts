import {
  CANVAS_DOC_KEY,
  createEmptyCanvasDoc,
  validateCanvasDoc,
  type CanvasDoc,
} from './contract.ts'

/**
 * 画布文档持久化（CANVAS_PLAN.md §4.1-6）。
 *
 * - 真实实现 = localStorage（文档轻量，一期无大资产；大资产进 IndexedDB 是一期 B 的事）；
 * - localAdapter 经可选方法 saveCanvasDoc/loadCanvasDoc/clearCanvasDoc 委托到本模块（BackendAdapter 预留层对齐）；
 * - rest 模式（远端后端）为 undefined = 预留未实现，本模块自动回退 localStorage，行为与纯前端一致；
 * - 多标签页同步：storage 事件驱动（对齐钱包既有行为）。
 */

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // 禁用或受限环境
  }
  return null
}

/** 允许测试注入 Storage；生产为 null 时用 window.localStorage */
export function loadCanvasDocFrom(storage: Storage | null): CanvasDoc | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(CANVAS_DOC_KEY)
    if (!raw) return null
    return validateCanvasDoc(JSON.parse(raw))
  } catch (err) {
    console.warn('[Canvas] 画布文档解析失败，按空画布处理:', err)
    return null
  }
}

export function saveCanvasDocTo(storage: Storage | null, doc: CanvasDoc): boolean {
  if (!storage) return false
  try {
    const validated = validateCanvasDoc(doc)
    if (!validated) {
      console.warn('[Canvas] 拒绝保存不合法的画布文档')
      return false
    }
    storage.setItem(CANVAS_DOC_KEY, JSON.stringify({ ...validated, updatedAt: Date.now() }))
    return true
  } catch (err) {
    console.warn('[Canvas] 画布文档保存失败:', err)
    return false
  }
}

export function clearCanvasDocFrom(storage: Storage | null): void {
  if (!storage) return
  try {
    storage.removeItem(CANVAS_DOC_KEY)
  } catch {
    // 忽略清理失败
  }
}

/** 读取画布文档：localStorage 缺失（SSR/受限环境）时返回空文档而非 null，方便 UI 直接用 */
export function loadCanvasDoc(): CanvasDoc {
  return loadCanvasDocFrom(getStorage()) ?? createEmptyCanvasDoc()
}

export function saveCanvasDoc(doc: CanvasDoc): boolean {
  return saveCanvasDocTo(getStorage(), doc)
}

export function clearCanvasDoc(): void {
  clearCanvasDocFrom(getStorage())
}

/**
 * 订阅其它标签页对画布文档的修改（storage 事件只在本 tab 之外触发，天然无自环）。
 * 返回取消订阅函数。回调收到外部已校验的文档。
 */
export function subscribeExternalCanvasChanges(
  onChange: (doc: CanvasDoc) => void
): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }
  const handler = (event: StorageEvent) => {
    if (event.key !== CANVAS_DOC_KEY) return
    if (!event.newValue) return // 其它标签页清空画布：一期不做跨页删除同步，忽略
    try {
      const doc = validateCanvasDoc(JSON.parse(event.newValue))
      if (doc) onChange(doc)
    } catch {
      // 外部数据不合法，忽略
    }
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
