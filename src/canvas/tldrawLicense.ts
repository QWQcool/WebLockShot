/**
 * tldraw 生产环境许可闸门判定（**只做如实提示，不做任何绕过**）。
 *
 * 事实来源：`tldraw@5.4.0` 构建产物实读（非猜测），关键代码等价于：
 *
 * ```js
 * var GRACE = 5e3                                   // 5000ms
 * function isGated(state){ return state === 'expired' || state === 'unlicensed-production' }
 * // <Tldraw> 内：状态命中闸门 → 5 秒后改为渲染一个 display:none 的空 div（children 全部不渲染）
 * getIsDevelopment() {
 *   const p = location.protocol, h = location.hostname
 *   return h.endsWith('.localhost') ? false
 *        : (p === 'http:' || (p === 'https:' && isLoopbackHost(h)))
 * }
 * ```
 *
 * 推论（**这正是 2026-09-11 线上「画布忽然变空」的根因**）：
 * - 无 license key 且**非开发环境** → 状态 `unlicensed-production` → 5 秒后编辑器整体消失；
 *   消失的只有 `<Tldraw>` 子树，外层自有 UI（节点面板 / 工具条 / 对话栏 / 小地图）仍在，
 *   所以现象是「画布内容突然全没了，但页面没崩」；
 * - `http:` 协议**一律**算开发环境（豁免）；`https:` 只有回环地址豁免。
 *   → **本地 dev 与本地预览（127.0.0.1）永远看不到该现象，线上 https 必现**；
 * - 数据不会丢：消失的只是渲染，IndexedDB / localStorage 里的画布文档照常保留。
 *
 * 本项目接受该限制（见 `NOTICE` 与 `CANVAS_PLAN.md` §9 注：接受水印、不接 licenseKey、
 * 不复刻引擎），**不提供也不包含任何绕过校验 / 去水印手段**；本模块仅用于「如实告知用户
 * 发生了什么、以及官方的解决路径」。
 */

/** tldraw 闸门触发后渲染的标记节点（`data-testid`）；可用它判定闸门是否真的生效 */
export const TLDRAW_LICENSE_MARKER_TESTID = 'tl-license-expired'

/** tldraw 的宽限期：状态命中闸门后多少毫秒停止渲染（源码常量 5e3） */
export const TLDRAW_LICENSE_GRACE_MS = 5000

/** 官方许可 key 的环境变量名（tldraw 会依次尝试多个前缀；Vite 构建用这个） */
export const TLDRAW_LICENSE_ENV_KEY = 'VITE_TLDRAW_LICENSE_KEY'

export type TldrawLicenseMode = 'dev-exempt' | 'unlicensed-production' | 'licensed'

/** 回环主机判定（与 tldraw 的 isLoopbackHost 同口径：去掉 IPv6 方括号后比较） */
export function isLoopbackHostname(hostname: string): boolean {
  const h = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h)
}

/**
 * 是否被 tldraw 视为「开发环境」（豁免许可闸门）。
 * 严格对齐 tldraw 的 `getIsDevelopment()`：
 * - `*.localhost` 后缀 → **否**（tldraw 的显式短路，注意 `localhost` 本身不含点，不走这条）；
 * - `http:` → 是；
 * - `https:` + 回环主机 → 是；
 * - 其余（含 `https:` + 公网域名）→ 否。
 */
export function isTldrawDevEnvironment(protocol: string, hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  if (h.endsWith('.localhost')) return false
  if (protocol === 'http:') return true
  return protocol === 'https:' && isLoopbackHostname(h)
}

/** 当前页面是否已配置 tldraw 官方许可 key（构建期注入；未配置即空） */
export function hasTldrawLicenseKey(env?: Record<string, unknown>): boolean {
  const source =
    env ??
    (typeof import.meta !== 'undefined'
      ? (import.meta.env as unknown as Record<string, unknown> | undefined)
      : undefined)
  const raw = source?.[TLDRAW_LICENSE_ENV_KEY]
  return typeof raw === 'string' && raw.trim().length > 0
}

/** 许可模式判定（纯函数，node --test 可跑）：'licensed' 优先，其次开发豁免，否则生产未授权 */
export function resolveTldrawLicenseMode(input: {
  protocol: string
  hostname: string
  hasKey: boolean
}): TldrawLicenseMode {
  if (input.hasKey) return 'licensed'
  return isTldrawDevEnvironment(input.protocol, input.hostname) ? 'dev-exempt' : 'unlicensed-production'
}

/** 便捷入口：读当前页面 location（非浏览器环境返回 'dev-exempt'，便于单测/SSR 安全） */
export function currentTldrawLicenseMode(): TldrawLicenseMode {
  if (typeof window === 'undefined') return 'dev-exempt'
  return resolveTldrawLicenseMode({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    hasKey: hasTldrawLicenseKey(),
  })
}
