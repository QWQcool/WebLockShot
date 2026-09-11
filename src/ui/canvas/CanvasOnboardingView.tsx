import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RECOMMENDED_CONNECTORS } from '../../canvas/connectors.ts'
import { ONBOARDING_SCENE_TABS, onboardingPromptFor } from '../../canvas/canvasOnboarding.ts'
import { useLanguage, useT } from '../../i18n/useLanguage.ts'
import { onboardingTabLabel } from '../../i18n/strings.ts'
import './canvasOnboarding.css'

/**
 * D5 开场层（CANVAS_PLAN.md §9 D5-⑤，Miora 图1 形态）。
 *
 * 形态：五类场景 tab + 大输入卡 + 连接器条（1:1 对齐图1 的入口区）。
 * - 场景 tab 点击 → 预填输入框（复用既有场景模板 prompt，不另写一套）；
 * - 发送 → 交给父组件走 B6 既有编排链路（LLM / 演示两态），并关闭本层；
 * - 连接器条 → 打开 D4 连接器面板；
 * - 「进入画布」/ Esc → 关闭并标记已读（二次进入不再弹出，折叠为底部对话栏）。
 *
 * 诚实：不做图1 顶部 hero 轮播（无真实素材，不伪造配图）；演示/真实两态由编排链路如实标注。
 */

type Props = {
  /** 关闭开场层（父组件负责标记已读） */
  onClose: () => void
  /** 提交一句话 → 复用 B6 编排链路 */
  onSubmit: (text: string) => void
  /** 打开连接器面板（D4） */
  onOpenConnectors: () => void
  /** 打开完整创作场景画廊（D6，可选）；未提供时不渲染入口 */
  onOpenScenes?: () => void
}

export const CanvasOnboardingView: React.FC<Props> = ({
  onClose,
  onSubmit,
  onOpenConnectors,
  onOpenScenes,
}) => {
  const lang = useLanguage()
  const t = useT()
  const [draft, setDraft] = useState('')
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleTab = useCallback((tabId: string, scene: (typeof ONBOARDING_SCENE_TABS)[number]['scene']) => {
    setActiveTab(tabId)
    setDraft(onboardingPromptFor(scene))
    inputRef.current?.focus()
  }, [])

  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (!text) {
      inputRef.current?.focus()
      return
    }
    onSubmit(text)
  }, [draft, onSubmit])

  return (
    <div className="co-root" data-testid="canvas-onboarding">
      <div className="co-card">
        <header className="co-head">
          <h1>{t('onboarding.title')}</h1>
          <p>{t('onboarding.subtitle')}</p>
        </header>

        <div className="co-tabs" role="tablist" aria-label={t('onboarding.tabsAria')}>
          {ONBOARDING_SCENE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`co-tab${activeTab === tab.id ? ' active' : ''}`}
              data-testid={`co-tab-${tab.id}`}
              onClick={() => handleTab(tab.id, tab.scene)}
            >
              <span aria-hidden>{tab.icon}</span> {onboardingTabLabel(lang, tab.id)}
            </button>
          ))}
        </div>

        <div className="co-input-card">
          <textarea
            ref={inputRef}
            className="co-input"
            data-testid="co-input"
            placeholder={t('onboarding.inputPlaceholder')}
            maxLength={500}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <div className="co-input-foot">
            <span className="co-input-hint">{t('onboarding.inputHint')}</span>
            <button type="button" className="co-send" data-testid="co-send" onClick={handleSend}>
              {t('onboarding.send')}
            </button>
          </div>
        </div>

        <div className="co-connectors">
          <span className="co-connectors-label">{t('onboarding.connectorsLabel')}</span>
          <div className="co-connector-icons">
            {RECOMMENDED_CONNECTORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="co-connector-icon"
                style={{ background: c.tint }}
                title={t('onboarding.connectorTitle', { name: c.name })}
                aria-label={t('onboarding.connectorAria', { name: c.name })}
                data-testid={`co-connector-${c.id}`}
                onClick={onOpenConnectors}
              >
                {c.glyph}
              </button>
            ))}
            <button
              type="button"
              className="co-connectors-more"
              data-testid="co-connectors-more"
              onClick={onOpenConnectors}
            >
              {t('onboarding.connectorsMore')}
            </button>
          </div>
        </div>

        <div className="co-actions">
          <button type="button" className="co-enter" data-testid="co-enter" onClick={onClose}>
            {t('onboarding.enter')}
          </button>
          {onOpenScenes && (
            <button type="button" className="co-scenes-link" data-testid="co-open-scenes" onClick={onOpenScenes}>
              {t('onboarding.moreScenes')}
            </button>
          )}
          <span className="co-actions-note">{t('onboarding.actionsNote')}</span>
        </div>
      </div>
    </div>
  )
}
