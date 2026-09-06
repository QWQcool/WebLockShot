import React from 'react'
import {
  STRUCTURE_TEMPLATES,
  type StructureTemplate,
} from '../../prompts/library/structures.ts'

type Props = {
  selectedTemplateId: string
  onSelectTemplate: (templateId: string) => void
  onNext: () => void
  isLoading?: boolean
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  hook: { label: '钩子留人', color: '#E63946' },
  pain: { label: '痛点共鸣', color: '#F97316' },
  reveal: { label: '主角亮相', color: '#38BDF8' },
  demo: { label: '功能演示', color: '#10B981' },
  proof: { label: '效果证言', color: '#A855F7' },
  cta: { label: '促单转化', color: '#F59E0B' },
}

export const TemplateStep: React.FC<Props> = ({
  selectedTemplateId,
  onSelectTemplate,
  onNext,
  isLoading,
}) => {
  const currentTemplate =
    STRUCTURE_TEMPLATES.find((t) => t.id === selectedTemplateId) ||
    STRUCTURE_TEMPLATES[0]

  return (
    <div className="template-step-container">
      <div className="step-header-intro">
        <h2>② 爆款带货套路库</h2>
        <p>
          学爆款底层叙事结构，不抄具体文案。根据品类与目标受众，选择经过大盘验证的带货节奏模板。
        </p>
      </div>

      {/* 模板网格卡片 */}
      <div className="templates-grid">
        {STRUCTURE_TEMPLATES.map((tpl: StructureTemplate) => {
          const isSelected = tpl.id === selectedTemplateId
          return (
            <div
              key={tpl.id}
              className={`template-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectTemplate(tpl.id)}
            >
              <div className="card-top-bar">
                <span className="card-tagline">{tpl.tagline}</span>
                {isSelected && <span className="selected-badge">✓ 已选</span>}
              </div>

              <h3 className="template-name">{tpl.name}</h3>
              <p className="template-fit">🎯 适用：{tpl.fit}</p>

              {/* 6 拍骨架预览 */}
              <div className="skeleton-flow">
                {tpl.beatSkeleton.map((beat) => {
                  const meta = ROLE_LABELS[beat.role] || { label: beat.role, color: '#94A3B8' }
                  return (
                    <span
                      key={beat.order}
                      className="flow-pill"
                      style={{ borderColor: meta.color, color: meta.color }}
                      title={`第${beat.order}拍：${beat.hint}`}
                    >
                      {beat.order}.{meta.label}
                    </span>
                  )
                })}
              </div>

              {/* 钩子样例预览 */}
              <div className="card-hook-preview">
                <span className="hook-title">🔥 爆款前 3 秒钩子样例：</span>
                <p className="hook-quote">“{tpl.hookSamples[0]}”</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* 选定模板的拍点细节解构 */}
      <div className="selected-details-panel">
        <h3>当前所选：【{currentTemplate.name}】6 拍转化逻辑链</h3>
        <div className="beats-detail-grid">
          {currentTemplate.beatSkeleton.map((beat) => {
            const meta = ROLE_LABELS[beat.role]
            return (
              <div key={beat.order} className="beat-detail-card">
                <div className="beat-header">
                  <span className="beat-num">S{beat.order}</span>
                  <span
                    className="role-badge"
                    style={{ backgroundColor: meta.color + '22', color: meta.color }}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="beat-hint">{beat.hint}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* 底部行动栏 */}
      <div className="step-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={onNext}
          disabled={isLoading}
        >
          {isLoading ? '正在构思扩写中...' : '⚡ 一键扩写为带货脚本 →'}
        </button>
      </div>
    </div>
  )
}
