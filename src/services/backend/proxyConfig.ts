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

/** 本机（回环）主机名判定：这些情况下可走同源反代绕开跨域与上游的 host/origin 校验 */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')
}

/**
 * 本机访问时的引擎反代**绝对** URL；非本机返回 null（调用方回落上游官方地址）。
 *
 * 两个必须点：
 * 1. **绝对**：ComfyUI 产物直链要写进画布 meta，契约 `persistentUrlSchema` 只接受
 *    `idbref://` 或 `http(s)://`，相对路径 `/api/comfyui/view?...` 会被契约拒绝入档。
 * 2. **必须走反代**：ComfyUI 新版 server.py 的 `create_origin_only_middleware` 会比对
 *    Host 与 Origin 的域名，本机回环下不一致直接 403（防「任意网页 POST 到 127.0.0.1 排队任务」）。
 *    浏览器从 `127.0.0.1:<本项目端口>` 发起的 POST 必然带 Origin，因此**直连必 403**；
 *    反代会剥离 host/origin 头，这正是它存在的理由（伴生服务 /api/comfyui、Vite dev proxy）。
 */
export function localEngineProxyUrl(
  engine: ProxyEngine,
  location: { hostname: string; origin: string }
): string | null {
  if (!isLoopbackHostname(location.hostname)) return null
  try {
    return new URL(getEngineProxyBase(engine), location.origin).toString().replace(/\/$/, '')
  } catch {
    return null
  }
}
