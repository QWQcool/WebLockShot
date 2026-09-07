/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** 预留：REST 后端地址。为空 = 本地默认模式（IndexedDB/localStorage），行为与纯前端现状完全一致 */
  readonly VITE_BACKEND_URL?: string
  /** 预留：引擎反代 base 路径，默认 '/api'（现状不变） */
  readonly VITE_API_PROXY_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
