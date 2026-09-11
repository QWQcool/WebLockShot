import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RECOMMENDED_CONNECTORS } from '../../canvas/connectors.ts'
import { ONBOARDING_SCENE_TABS, onboardingPromptFor } from '../../canvas/canvasOnboarding.ts'
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
          <h1>Agent 创意画布</h1>
          <p>一句话描述你想要什么，Agent 帮你把创作流程摆上画布</p>
        </header>

        <div className="co-tabs" role="tablist" aria-label="创作场景">
          {ONBOARDING_SCENE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={`co-tab${activeTab === t.id ? ' active' : ''}`}
              data-testid={`co-tab-${t.id}`}
              onClick={() => handleTab(t.id, t.scene)}
            >
              <span aria-hidden>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        <div className="co-input-card">
          <textarea
            ref={inputRef}
            className="co-input"
            data-testid="co-input"
            placeholder="描述你的创作需求，例如：给「填入商品」拍一条 30 秒竖屏带货短视频…"
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
            <span className="co-input-hint">
              Enter 发送 · Shift+Enter 换行 · 无 LLM Key 时走「演示编排 · 非真实 LLM」并如实标注
            </span>
            <button type="button" className="co-send" data-testid="co-send" onClick={handleSend}>
              ↗ 发送
            </button>
          </div>
        </div>

        <div className="co-connectors">
          <span className="co-connectors-label">🔌 将你的常用应用接入</span>
          <div className="co-connector-icons">
            {RECOMMENDED_CONNECTORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="co-connector-icon"
                style={{ background: c.tint }}
                title={`${c.name}（未接入 · 点击查看连接器面板）`}
                aria-label={`${c.name}（未接入）`}
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
              全部连接器 →
            </button>
          </div>
        </div>

        <div className="co-actions">
          <button type="button" className="co-enter" data-testid="co-enter" onClick={onClose}>
            进入画布 →
          </button>
          {onOpenScenes && (
            <button type="button" className="co-scenes-link" data-testid="co-open-scenes" onClick={onOpenScenes}>
              更多创作场景 →
            </button>
          )}
          <span className="co-actions-note">首次进入显示本页；之后折叠为底部对话栏</span>
        </div>
      </div>
    </div>
  )
}
