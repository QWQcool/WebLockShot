/**
 * `public/` 静态资源 URL 解析（**唯一入口**，禁止手写 `/xxx` 根绝对路径）。
 *
 * 背景（实机回归，2026-09-11）：仓库里 public 资源路径拼接散落三处，
 * 其中 3D 素体模型写成根绝对路径 `/models/quaternius-universal-character.glb`。
 * 本地 dev（base `/`）与「根路径托管」下都正常，但 GitHub Pages 是**子路径部署**
 * （vite `base = '/WebLockShot/'`），该请求实际打到
 * `https://qwqcool.github.io/models/…` → **404** → drei `useGLTF` 抛错 →
 * 没有 ErrorBoundary 兜底时 React 卸载整棵树 → **整页白屏**（线上实测）。
 *
 * 结论：凡是 `public/` 下的资源，一律经 `publicUrl()` 拼 vite base。
 */

/** 纯函数：安全拼接 base 与相对路径（base 无尾斜杠 / path 带首斜杠 / base 为空 均正确） */
export function joinBase(base: string, path: string): string {
  const cleanBase = base.endsWith('/') ? base : `${base}/`
  const cleanPath = path.replace(/^\/+/, '')
  return `${cleanBase}${cleanPath}`
}

/**
 * 解析 `public/` 静态资源 URL（自动拼 vite base）。
 * 非浏览器环境（`node --test` / SSR）返回根路径形式，与改造前行为一致。
 */
export function publicUrl(path: string): string {
  const cleanPath = path.replace(/^\/+/, '')
  if (typeof window === 'undefined') return `/${cleanPath}`
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  return joinBase(base, cleanPath)
}
