import type { CanvasGenerateProviderId } from './contract.ts'

/**
 * 画布出片引擎的「接通状态」单一事实源。
 *
 * 背景：设置面板（TokenSettingsModal）写 `weblockshot.video_provider`，取值域是 6 个引擎；
 * 但画布侧只有 mock（演示引擎）与 comfyui（本地 ComfyUI 算力）真正接通了 ExecutorEngine。
 * 这里不做「猜」也不做「静默回落」到别的模型：读到的值不是已接通引擎就回落 mock，
 * 并由 `CANVAS_UNWIRED_ENGINES` 把未接通项如实列给 UI。
 */

export const CANVAS_VIDEO_PROVIDER_KEY = 'weblockshot.video_provider'

export const CANVAS_PROVIDER_LABELS: Record<CanvasGenerateProviderId, string> = {
  mock: 'Mock 实验画布',
  comfyui: '🔥 ComfyUI 本地算力',
}

/** 设置里可选、但画布未接线的引擎（如实标注，不假装可用） */
export const CANVAS_UNWIRED_ENGINES = ['kling', 'jimeng', 'runway', 'luma'] as const

/** sessionStorage 的最小可注入形状（便于 node --test 不依赖浏览器） */
export type ReadableStorage = { getItem(key: string): string | null }

function defaultStorage(): ReadableStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * 读取画布实际生效的出片引擎。
 * @param storage 注入的存储（测试用）。传 `null` 表示「没有存储」，传 `undefined` 用浏览器 sessionStorage。
 */
export function readCanvasGenerateProvider(
  storage?: ReadableStorage | null
): CanvasGenerateProviderId {
  const s = storage === undefined ? defaultStorage() : storage
  if (!s) return 'mock'
  try {
    return s.getItem(CANVAS_VIDEO_PROVIDER_KEY) === 'comfyui' ? 'comfyui' : 'mock'
  } catch {
    return 'mock'
  }
}

/* ------------------------------------------------------------------ *
 * 响应式外壳（useSyncExternalStore 用）
 *
 * 为什么需要：节点体内的引擎读取是渲染期取值，而设置面板写 sessionStorage **不会**让
 * tldraw 的节点重新渲染 —— 用户「在设置里切成 ComfyUI」后画布仍然显示/执行 Mock，
 * 必须刷新页面才生效。这里用「缓存 + 订阅 + 显式广播」把这条链路补上。
 * ------------------------------------------------------------------ */

/** 应用内部广播信号：设置面板写入后派发，画布据此重渲染（跨标签页另有 storage 事件兜底） */
export const CANVAS_PROVIDER_CHANGED_EVENT = 'weblockshot:canvas-provider-changed'

let cachedProvider: CanvasGenerateProviderId | null = null
let syncInstalled = false
const providerListeners = new Set<() => void>()

export function getCanvasGenerateProviderSnapshot(): CanvasGenerateProviderId {
  if (cachedProvider === null) cachedProvider = readCanvasGenerateProvider()
  return cachedProvider
}

/** 重新读取存储并通知订阅者；值未变化时静默返回（避免无意义重渲染） */
export function refreshCanvasGenerateProvider(): void {
  const next = readCanvasGenerateProvider()
  if (next === cachedProvider) return
  cachedProvider = next
  for (const fn of [...providerListeners]) fn()
}

function installCanvasProviderSync(): void {
  if (syncInstalled || typeof window === 'undefined') return
  syncInstalled = true
  // 跨标签页：sessionStorage 不会跨标签页同步，但 localStorage 型的设置项变更会走到这里。
  // key === null 表示 storage.clear()，同样需要重新读一次。
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === CANVAS_VIDEO_PROVIDER_KEY) refreshCanvasGenerateProvider()
  })
  window.addEventListener(CANVAS_PROVIDER_CHANGED_EVENT, () => refreshCanvasGenerateProvider())
}

export function subscribeCanvasGenerateProvider(fn: () => void): () => void {
  installCanvasProviderSync()
  providerListeners.add(fn)
  return () => {
    providerListeners.delete(fn)
  }
}

/**
 * 写入方（设置面板保存 / 清空）必须调用它。
 * 同标签页写 sessionStorage **不会**触发 storage 事件，只能显式广播。
 */
export function notifyCanvasGenerateProviderChanged(): void {
  try {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new Event(CANVAS_PROVIDER_CHANGED_EVENT))
  } catch {
    /* 广播失败不该影响保存本身 */
  }
}

/** 仅供单测重置模块级状态（浏览器运行时不需要） */
export function __resetCanvasGenerateProviderForTest(): void {
  cachedProvider = null
  providerListeners.clear()
  syncInstalled = false
}
