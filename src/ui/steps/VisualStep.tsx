import React from 'react'
import type { VisualPlan } from '../../domain/sellVisual.ts'

type Props = {
  visualPlans: VisualPlan[]
  onChange: (updated: VisualPlan[]) => void
  onNext: () => void
}

export const VisualStep: React.FC<Props> = ({
  visualPlans,
  onChange,
  onNext,
}) => {
  const handlePromptChange = (
    index: number,
    field: 'positive' | 'negative' | 'caption',
    value: string
  ) => {
    const updated = visualPlans.map((plan, i) => {
      if (i !== index) return plan
      return { ...plan, [field]: value }
    })
    onChange(updated)
  }

  return (
    <div className="visual-step-container">
      <div className="step-header-intro">
        <h2>⑤ 视觉提示词方案扩充（VisualPlan）</h2>
        <p>
          AI 已将分镜意图、运镜、景别与字幕编译为专业的电商短视频生成提示词。出片前可直接核对与微调。
        </p>
      </div>

      <div className="visual-plans-grid">
        {visualPlans.map((plan, index) => (
          <div key={plan.shotId} className="visual-plan-card">
            <div className="plan-header">
              <div className="plan-badge">
                <span className="shot-id">{plan.shotId.toUpperCase()}</span>
                <span className="ratio-tag">9:16 竖屏</span>
                <span className="dur-tag">{plan.durationSec}s</span>
              </div>
              <span className="mode-tag">{plan.kind === 'image2video' ? '图生视频' : '文生视频'}</span>
            </div>

            <div className="plan-field">
              <label className="field-label">✨ 正向视频生成提示词（Prompt）：</label>
              <textarea
                className="script-textarea"
                rows={3}
                value={plan.positive}
                onChange={(e) => handlePromptChange(index, 'positive', e.target.value)}
              />
            </div>

            <div className="plan-field">
              <label className="field-label">💬 视频字幕 / 促销标语（Caption）：</label>
              <input
                type="text"
                className="text-input"
                value={plan.caption || ''}
                onChange={(e) => handlePromptChange(index, 'caption', e.target.value)}
                placeholder="画面同步大字幕"
              />
            </div>

            <div className="plan-field">
              <label className="field-label">🚫 负向提示词（Negative）：</label>
              <input
                type="text"
                className="text-input text-sm text-muted"
                value={plan.negative || ''}
                onChange={(e) => handlePromptChange(index, 'negative', e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 成本预估确认框 */}
      <div className="cost-confirmation-banner">
        <div className="cost-info">
          <span className="cost-icon">💎</span>
          <div>
            <strong>生成前成本确认：</strong>
            <span>当前模式为【P0 真实模拟出片】，耗费 0 算力点（¥0.00 免费演示）</span>
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={onNext}>
          🚀 确认方案，开始生成出片 →
        </button>
      </div>
    </div>
  )
}
