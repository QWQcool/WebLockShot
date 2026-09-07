import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * PWA Service Worker 自更新提示（M1d 手机适配第一批）。
 *
 * registerType: 'prompt' 模式 —— 新版本就绪时不自动刷新，而是弹底部提示条
 * 由用户确认（避免打断生成中的任务）。仅在构建产物（SW 存在）时生效；
 * 开发模式与不支持 SW 的环境下提示条不会出现。
 */
export function PwaUpdatePrompt() {
  const [offlineReady, setOfflineReady] = useState(false)
  const [needRefresh, setNeedRefresh] = useState(false)

  let updateServiceWorker: (reloadPage?: boolean) => Promise<void> = async () => {}
  // virtual:pwa-register 在 vite build/dev 下由 vite-plugin-pwa 提供（hook 必须无条件调用）
  const register = useRegisterSW({
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      void registration
    },
    onNeedRefresh() {
      setNeedRefresh(true)
    },
    onOfflineReady() {
      setOfflineReady(true)
    },
  })
  updateServiceWorker = register.updateServiceWorker

  if (!needRefresh && !offlineReady) return null

  const close = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  return (
    <div className="pwa-update-prompt" role="status" aria-live="polite">
      <span className="pwa-update-text">
        {needRefresh ? '🚀 发现新版本，刷新即可更新应用' : '✅ 应用已可离线使用'}
      </span>
      <button
        type="button"
        className="btn-alert-action pwa-update-btn"
        onClick={() => void updateServiceWorker(true)}
      >
        刷新
      </button>
      <button type="button" className="btn-alert-dismiss pwa-update-btn" onClick={close}>
        ✕
      </button>
    </div>
  )
}
