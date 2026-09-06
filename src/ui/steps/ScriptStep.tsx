import React from 'react'
import type { Script, ScriptBeat } from '../../domain/script.ts'
import type { CriticReviewResult } from '../../ai/agents/scriptCritic.ts'

type Props = {
  script: Script
  criticResult?: CriticReviewResult | null
  onChange: (updated: Script) => void
  onNext: () => void
  onReCritique?: () => void
}

const ROLE_COLOR_MAP: Record<string, string> = {
  hook: '#E63946',
  pain: '#F97316',
  reveal: '#38BDF8',
  demo: '#10B981',
  proof: '#A855F7',
  cta: '#F59E0B',
}

const ROLE_NAME_MAP: Record<string, string> = {
  hook: '前3秒钩子',
  pain: '痛点放大',
  reveal: '救星亮相',
  demo: '功能实操',
  proof: '对比证言',
  cta: '促单成交',
}

export const ScriptStep: React.FC<Props> = ({
  script,
  criticResult,
  onChange,
  onNext,
  onReCritique,
}) => {
  const handleBeatChange = (order: number, field: keyof ScriptBeat, value: string) => {
    const updatedBeats = script.beats.map((beat) => {
      if (beat.order !== order) return beat
      if (field === 'action') return { ...beat, action: value }
      if (field === 'caption') return { ...beat, caption: value }
      if (field === 'goal') return { ...beat, goal: value }
      return beat
    })
    onChange({ ...script, beats: updatedBeats })
  }

  const handleAudioTextChange = (order: number, text: string) => {
    const updatedBeats = script.beats.map((beat) => {
      if (beat.order !== order) return beat
      return {
        ...beat,
        audio: {
          kind: beat.audio?.kind || 'vo',
          speaker: beat.audio?.speaker || '主播',
          text,
        },
      }
    })
    onChange({ ...script, beats: updatedBeats })
  }

  return (
    <div className="script-step-container">
      <div className="step-header-intro">
        <h2>③ 提示词扩写：带货脚本与双 Agent 审稿</h2>
        <p>
          AI 结合商品信息与爆款结构扩写出 6 拍结构化脚本。每拍的目标、画面动作、口播及字幕均可实时微调。
        </p>
      </div>

      {/* 编导自审卡片 */}
      {criticResult && (
        <div className="critic-review-card">
          <div className="critic-header">
            <div className="critic-badge">
              <span className="critic-icon">🤖</span>
              <span className="critic-title">ScriptCritic 带货转化逻辑审稿报告</span>
            </div>
            <div className="score-pill">
              <span className="score-num">{criticResult.score}</span>
              <span className="score-label">分 / 预估高转化</span>
            </div>
          </div>

          <p className="critic-summary">{criticResult.summary}</p>

          <div className="critic-points-grid">
            <div className="critic-column strengths">
              <h4>✓ 核心优势（爆款要点）：</h4>
              <ul>
                {criticResult.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div className="critic-column suggestions">
              <h4>💡 优化建议：</h4>
              <ul>
                {criticResult.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </div>

          {onReCritique && (
            <div className="critic-action-bar">
              <button type="button" className="btn-secondary btn-sm" onClick={onReCritique}>
                🔄 修改后重新打分审阅
              </button>
            </div>
          )}
        </div>
      )}

      {/* 6 拍脚本卡片列表 */}
      <div className="beats-list">
        {script.beats.map((beat) => {
          const roleColor = ROLE_COLOR_MAP[beat.role] || '#94A3B8'
          const roleName = ROLE_NAME_MAP[beat.role] || beat.role

          return (
            <div key={beat.order} className="script-beat-card">
              <div className="beat-card-header">
                <div className="beat-badge-group">
                  <span className="beat-tag">第 {beat.order} 拍</span>
                  <span
                    className="role-pill"
                    style={{ backgroundColor: roleColor + '22', color: roleColor }}
                  >
                    {roleName}
                  </span>
                </div>
                <div className="beat-goal-text">
                  <span className="goal-label">🎯 目标：</span>
                  <span className="goal-content">{beat.goal}</span>
                </div>
              </div>

              <div className="beat-fields-grid">
                <div className="field-block">
                  <label className="field-label">🎬 画面动作描述：</label>
                  <textarea
                    className="script-textarea"
                    rows={2}
                    value={beat.action}
                    onChange={(e) => handleBeatChange(beat.order, 'action', e.target.value)}
                  />
                </div>

                <div className="field-block">
                  <label className="field-label">🎙️ 口播台词（Voiceover）：</label>
                  <textarea
                    className="script-textarea"
                    rows={2}
                    value={beat.audio?.text || ''}
                    onChange={(e) => handleAudioTextChange(beat.order, e.target.value)}
                  />
                </div>

                <div className="field-block full-width">
                  <label className="field-label">💬 画面大字幕 / 卖点标语（Caption）：</label>
                  <input
                    type="text"
                    className="text-input"
                    value={beat.caption || ''}
                    onChange={(e) => handleBeatChange(beat.order, 'caption', e.target.value)}
                    placeholder="强冲击大字幕（例如：❌ 传统做法又贵又踩雷！）"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部行动栏 */}
      <div className="step-actions">
        <button type="button" className="btn-primary" onClick={onNext}>
          下一步：进入 6 镜分镜预演（GSAP 舞台） →
        </button>
      </div>
    </div>
  )
}
