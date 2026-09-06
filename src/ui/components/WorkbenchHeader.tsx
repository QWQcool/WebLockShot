import React from 'react'

export type WorkbenchStep = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const STEP_NAMES: { step: WorkbenchStep; label: string; icon: string }[] = [
  { step: 0, label: '商品导入', icon: '📦' },
  { step: 1, label: '爆款套路', icon: '⚡' },
  { step: 2, label: '剧本编导', icon: '📝' },
  { step: 3, label: '分镜预演', icon: '🎬' },
  { step: 4, label: '视觉方案', icon: '🎨' },
  { step: 5, label: '渲染生成', icon: '⚙️' },
  { step: 6, label: '审片交付', icon: '✨' },
]

export type StudioMode = 'pipeline' | 'single-agent' | 'multi-agent'

type Props = {
  mode: 'sell' | 'drama'
  onModeChange: (mode: 'sell' | 'drama') => void
  currentStep: WorkbenchStep
  onStepChange: (step: WorkbenchStep) => void
  maxReachedStep: WorkbenchStep
  studioMode?: StudioMode
  onStudioModeChange?: (mode: StudioMode) => void
  onOpenSettings?: () => void
  hasToken?: boolean
}

export const WorkbenchHeader: React.FC<Props> = ({
  mode,
  onModeChange,
  currentStep,
  onStepChange,
  maxReachedStep,
  studioMode = 'pipeline',
  onStudioModeChange,
  onOpenSettings,
  hasToken,
}) => {
  return (
    <header className="workbench-header">
      <div className="header-brand">
        <div className="brand-logo">
          <span className="logo-badge">WLS</span>
        </div>
        <div className="brand-text">
          <h1>WebLockShot</h1>
          <span className="brand-tagline">多 Agent 电商带货视频工作台</span>
        </div>

        {/* 模式切换与 API 设置 */}
        <div className="header-controls-group">
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-btn ${mode === 'sell' ? 'active' : ''}`}
              onClick={() => onModeChange('sell')}
            >
              🎯 带货工作台（仿爆款）
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'drama' ? 'active' : ''}`}
              onClick={() => onModeChange('drama')}
            >
              🎭 剧情短剧（粗剪台）
            </button>
          </div>

          {onOpenSettings && (
            <button
              type="button"
              className="btn-settings-trigger"
              onClick={onOpenSettings}
              title="配置大模型与视频生成 API 密钥"
            >
              ⚙️ API 设置
              {hasToken ? (
                <span className="token-dot active" title="已配置专属 API Key" />
              ) : (
                <span className="token-dot empty" title="当前为 0 Key 免费模式" />
              )}
            </button>
          )}
        </div>
      </div>

      {mode === 'sell' && (
        <div className="workbench-three-zones-bar">
          {/* 左侧红框：电商全链路工作流 */}
          <div
            className={`workflow-zone-card zone-pipeline ${
              studioMode === 'pipeline' ? 'active' : ''
            }`}
            onClick={() => onStudioModeChange?.('pipeline')}
            role="button"
            tabIndex={0}
            title="点击切换到电商全链路工作流"
          >
            <div className="zone-header-trigger">
              <span className="zone-tag">🛒 电商全链路工作流</span>
            </div>

            <nav className="header-steps" aria-label="生成步骤">
              {STEP_NAMES.map(({ step, label, icon }) => {
                const isActive = studioMode === 'pipeline' && currentStep === step
                const isCompleted = maxReachedStep > step
                const canClick = step <= maxReachedStep

                return (
                  <button
                    key={step}
                    type="button"
                    className={`step-nav-item ${isActive ? 'active' : ''} ${
                      isCompleted ? 'completed' : ''
                    }`}
                    disabled={!canClick}
                    onClick={(e) => {
                      e.stopPropagation()
                      onStudioModeChange?.('pipeline')
                      onStepChange(step)
                    }}
                  >
                    <span className="step-icon">{isCompleted ? '✓' : icon}</span>
                    <span className="step-label">{label}</span>
                    {step < 6 && <span className="step-divider" />}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* 中间红框：单 Agent 极速直出 */}
          <div
            className={`workflow-zone-card zone-single ${
              studioMode === 'single-agent' ? 'active' : ''
            }`}
            onClick={() => onStudioModeChange?.('single-agent')}
            role="button"
            tabIndex={0}
          >
            <div className="zone-meta-wrap">
              <div className="zone-title-row">
                <span className="zone-icon">⚡</span>
                <span className="zone-title">单 Agent 极速直出</span>
                <span className="zone-pill">Prompt 直调 API</span>
              </div>
              <div className="zone-desc">提示词模板 · AI 润色扩写 · 直调可灵/即梦</div>
            </div>
          </div>

          {/* 右侧红框：多 Agent 协同导演室 */}
          <div
            className={`workflow-zone-card zone-multi ${
              studioMode === 'multi-agent' ? 'active' : ''
            }`}
            onClick={() => onStudioModeChange?.('multi-agent')}
            role="button"
            tabIndex={0}
          >
            <div className="zone-meta-wrap">
              <div className="zone-title-row">
                <span className="zone-icon">🤖</span>
                <span className="zone-title">多 Agent 协同导演室</span>
                <span className="zone-pill multi-pill">4 Agent 协同</span>
              </div>
              <div className="zone-desc">编导+运镜+质检+调度四智体共创 · 动态推演</div>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
