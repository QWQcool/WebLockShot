import { createLocalAdapter } from './localAdapter.ts'
import { createRestAdapter } from './restAdapter.ts'
import type { BackendAdapter } from './types.ts'

export type { BackendAdapter, ErrorReport, StorageQuota, SubmitTaskRequest } from './types.ts'
export { PIPELINE_SESSION_V2_KEY } from './localAdapter.ts'

/**
 * BackendAdapter 工厂：环境为空 → local（现状行为）；配置了 VITE_BACKEND_URL → rest。
 *
 * 解析优先级：
 *   1. 显式参数 opts.backendUrl（测试 / 高级用法）
 *   2. 测试钩子 globalThis.__WLS_BACKEND_URL__（仅测试注入）
 *   3. import.meta.env.VITE_BACKEND_URL（Vite 构建期注入）
 */

function readExplicitBackendUrl(opts?: { backendUrl?: string }): string | '' {
  if (opts && typeof opts.backendUrl === 'string') return opts.backendUrl.trim()
  const hook = (globalThis as { __WLS_BACKEND_URL__?: unknown }).__WLS_BACKEND_URL__
  if (typeof hook === 'string') return hook.trim()
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    return (env?.VITE_BACKEND_URL || '').trim()
  } catch {
    return ''
  }
}

let localSingleton: BackendAdapter | null = null
const restCache = new Map<string, BackendAdapter>()

export function getLocalAdapter(): BackendAdapter {
  if (!localSingleton) localSingleton = createLocalAdapter()
  return localSingleton
}

/** 测试专用：清空工厂缓存与测试钩子 */
export function resetBackendAdapterForTest(): void {
  localSingleton = null
  restCache.clear()
  delete (globalThis as { __WLS_BACKEND_URL__?: unknown }).__WLS_BACKEND_URL__
}

export function getBackendAdapter(opts?: { backendUrl?: string }): BackendAdapter {
  const url = readExplicitBackendUrl(opts)
  if (!url) return getLocalAdapter()

  let adapter = restCache.get(url)
  if (!adapter) {
    adapter = createRestAdapter(url)
    restCache.set(url, adapter)
  }
  return adapter
}

/** 当前是否配置了 REST 后端（供诊断 / UI 展示验证层级） */
export function isRestBackendConfigured(opts?: { backendUrl?: string }): boolean {
  return readExplicitBackendUrl(opts) !== ''
}
