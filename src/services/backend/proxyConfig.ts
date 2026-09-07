/**
 * 引擎反代路径配置（M1b：密钥/引擎代理配置化）。
 *
 * 默认 '/api' 与现状完全一致（Vite dev proxy / 伴生 server 均按 /api/kling 等前缀反代）。
 * 预留：VITE_API_PROXY_BASE 可整体改写 base（例如反代挂在网关的 /engine 前缀下）。
 */

export const DEFAULT_API_PROXY_BASE = '/api'

export type ProxyEngine = 'kling' | 'jimeng' | 'comfyui' | 'llm'

function readApiProxyBase(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    const v = (env?.VITE_API_PROXY_BASE || '').trim()
    if (!v) return DEFAULT_API_PROXY_BASE
    return v.replace(/\/$/, '')
  } catch {
    return DEFAULT_API_PROXY_BASE
  }
}

/** 引擎反代 base（默认 '/api'） */
export function getApiProxyBase(): string {
  return readApiProxyBase()
}

/** 引擎反代完整前缀（默认 '/api/kling' 等，与现状一致） */
export function getEngineProxyBase(engine: ProxyEngine): string {
  return `${readApiProxyBase()}/${engine}`
}
