import React, { useState } from 'react'
import { useT } from '../../i18n/useLanguage.ts'
import { useTldrawGate } from './useTldrawGate.ts'

/**
 * tldraw 生产许可闸门 · 诚实提示条（V1）。
 *
 * 背景：线上（https 非本地地址）无 license key 时，tldraw 会在约 5 秒后把整个编辑器
 * 换成空 div——用户看到的是「画布内容忽然全部消失」，此前**没有任何解释**，是最难排查的
 * 失败模式（2026-09-11 用户实机反馈）。
 *
 * 本组件只做两件事，**不做任何绕过**：
 * 1. 事前判定：按 tldraw 的 `getIsDevelopment()` 口径推断当前是否处于「生产未授权」；
 * 2. 事后兜底：观察 tldraw 的 `[data-testid=tl-license-expired]` 标记，确认闸门真的触发。
 * 命中任一条件即如实展示说明（可关闭，不阻塞其余 UI）。
 */
export const TldrawLicenseNotice: React.FC = () => {
  const t = useT()
  const { gated } = useTldrawGate()
  const [dismissed, setDismissed] = useState(false)

  if (!gated || dismissed) return null

  return (
    <div className="wls-tldraw-license" role="alert" data-testid="tldraw-license-notice">
      <div className="wls-tldraw-license-card">
        <h2 className="wls-tldraw-license-title">{t('tldraw.gate.title')}</h2>
        <p className="wls-tldraw-license-body">{t('tldraw.gate.body')}</p>
        <p className="wls-tldraw-license-note">{t('tldraw.gate.devNote')}</p>
        <p className="wls-tldraw-license-fix">{t('tldraw.gate.fix')}</p>
        <button
          type="button"
          className="wls-tldraw-license-dismiss"
          data-testid="tldraw-license-dismiss"
          onClick={() => setDismissed(true)}
        >
          {t('tldraw.gate.dismiss')}
        </button>
      </div>
    </div>
  )
}
