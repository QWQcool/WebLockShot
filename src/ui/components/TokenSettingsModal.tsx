import React, { useState, useEffect } from 'react'
import type { TokenConfig } from '../../types.ts'
import { TOKEN_STORAGE_KEY } from '../../types.ts'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

const PRESET_ENDPOINTS = [
  {
    name: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
  },
  {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat',
  },
  {
    name: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    name: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
]

export const TokenSettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [tokenConfig, setTokenConfig] = useState<TokenConfig>({
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    model: 'deepseek-ai/DeepSeek-V3',
  })
  const [videoProvider, setVideoProvider] = useState<'mock' | 'kling' | 'jimeng'>('mock')
  const [klingKey, setKlingKey] = useState('')
  const [jimengKey, setJimengKey] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        setTokenConfig({
          baseUrl: parsed.baseUrl || 'https://api.siliconflow.cn/v1',
          apiKey: parsed.apiKey || '',
          model: parsed.model || 'deepseek-ai/DeepSeek-V3',
        })
      }
      const savedProvider = sessionStorage.getItem('weblockshot.video_provider')
      if (savedProvider === 'kling' || savedProvider === 'jimeng') {
        setVideoProvider(savedProvider)
      }
      const savedKling = sessionStorage.getItem('weblockshot.kling_key')
      if (savedKling) setKlingKey(savedKling)
      const savedJimeng = sessionStorage.getItem('weblockshot.jimeng_key')
      if (savedJimeng) setJimengKey(savedJimeng)
    } catch {}
  }, [isOpen])

  if (!isOpen) return null

  const handleApplyPreset = (p: (typeof PRESET_ENDPOINTS)[0]) => {
    setTokenConfig((prev) => ({
      ...prev,
      baseUrl: p.baseUrl,
      model: p.model,
    }))
  }

  const handleSave = () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenConfig))
    sessionStorage.setItem('weblockshot.video_provider', videoProvider)
    if (klingKey) {
      sessionStorage.setItem('weblockshot.kling_key', klingKey)
    }
    if (jimengKey) {
      sessionStorage.setItem('weblockshot.jimeng_key', jimengKey)
    }
    setSaveSuccess(true)
    setTimeout(() => {
      setSaveSuccess(false)
      onSaved?.()
      onClose()
    }, 600)
  }

  const handleClear = () => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    sessionStorage.removeItem('weblockshot.video_provider')
    sessionStorage.removeItem('weblockshot.kling_key')
    sessionStorage.removeItem('weblockshot.jimeng_key')
    setTokenConfig({
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      model: 'deepseek-ai/DeepSeek-V3',
    })
    setKlingKey('')
    setJimengKey('')
    setVideoProvider('mock')
    onSaved?.()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">⚙️</span>
            <h3>API 与模型接入设置</h3>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {/* 安全告知 */}
          <div className="security-notice-box">
            <span className="security-icon">🔒</span>
            <div className="security-text">
              <strong>零后端纯前端安全承诺：</strong>
              所有 API 密钥仅保存在当前浏览器的 <code>sessionStorage</code> 中，关闭标签页或手动清除即销毁，绝对不会被写入任何后端或上传至代码仓库。
            </div>
          </div>

          {/* 模块 A：LLM 提示词与扩写模型 */}
          <div className="settings-section">
            <div className="section-title-bar">
              <h4>1. 大语言模型（LLM）配置（提示词扩写 & 编导审稿）</h4>
              <span className="section-tag">OpenAI 兼容接口</span>
            </div>

            <div className="presets-row">
              <span className="presets-label">快速填充：</span>
              {PRESET_ENDPOINTS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="preset-btn-chip"
                  onClick={() => handleApplyPreset(p)}
                >
                  {p.name}
                </button>
              ))}
            </div>

            <div className="form-item">
              <label>API Base URL：</label>
              <input
                type="text"
                className="text-input"
                placeholder="https://api.siliconflow.cn/v1"
                value={tokenConfig.baseUrl}
                onChange={(e) => setTokenConfig({ ...tokenConfig, baseUrl: e.target.value })}
              />
            </div>

            <div className="form-item">
              <label>API Key：</label>
              <input
                type="password"
                className="text-input"
                placeholder="sk-..."
                value={tokenConfig.apiKey}
                onChange={(e) => setTokenConfig({ ...tokenConfig, apiKey: e.target.value })}
              />
              <small className="hint-text">
                留空则自动走纯前端高质量规则模板工程（0 Key 演示模式）。
              </small>
            </div>

            <div className="form-item">
              <label>模型名称（Model ID）：</label>
              <input
                type="text"
                className="text-input"
                placeholder="deepseek-ai/DeepSeek-V3"
                value={tokenConfig.model}
                onChange={(e) => setTokenConfig({ ...tokenConfig, model: e.target.value })}
              />
            </div>
          </div>

          {/* 模块 B：视频生成 Provider 配置 */}
          <div className="settings-section">
            <div className="section-title-bar">
              <h4>2. 视频生成引擎（Media Provider）</h4>
              <span className="section-tag">出片端</span>
            </div>

            <div className="provider-select-grid">
              <label
                className={`provider-card-option ${videoProvider === 'mock' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="video_provider"
                  value="mock"
                  checked={videoProvider === 'mock'}
                  onChange={() => setVideoProvider('mock')}
                />
                <div>
                  <strong>Mock 真实录制（推荐）</strong>
                  <p>MediaRecorder 本地真录制，0 门槛免费出 WebM</p>
                </div>
              </label>

              <label
                className={`provider-card-option ${videoProvider === 'kling' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="video_provider"
                  value="kling"
                  checked={videoProvider === 'kling'}
                  onChange={() => setVideoProvider('kling')}
                />
                <div>
                  <strong>可灵 AI 开放平台 (Kling)</strong>
                  <p>真实直调快手可灵视频 API（需开发者凭据）</p>
                </div>
              </label>

              <label
                className={`provider-card-option ${videoProvider === 'jimeng' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="video_provider"
                  value="jimeng"
                  checked={videoProvider === 'jimeng'}
                  onChange={() => setVideoProvider('jimeng')}
                />
                <div>
                  <strong>字节即梦 AI (Jimeng)</strong>
                  <p>真实直调字节即梦视频 API（需开发者凭据）</p>
                </div>
              </label>
            </div>

            {videoProvider === 'kling' && (
              <div className="form-item mt-3">
                <label>可灵 API Key / Access Token：</label>
                <input
                  type="password"
                  className="text-input"
                  placeholder="Bearer Token 或 AccessKey:SecretKey"
                  value={klingKey}
                  onChange={(e) => setKlingKey(e.target.value)}
                />
                <small className="hint-text">
                  请前往快手可灵开放平台获取开发者密钥。
                </small>
              </div>
            )}

            {videoProvider === 'jimeng' && (
              <div className="form-item mt-3">
                <label>即梦 API Key / Access Token：</label>
                <input
                  type="password"
                  className="text-input"
                  placeholder="Bearer Token 或 API_KEY"
                  value={jimengKey}
                  onChange={(e) => setJimengKey(e.target.value)}
                />
                <small className="hint-text">
                  请前往字节跳动即梦/火山方舟获取 API 密钥。
                </small>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={handleClear}>
            清空所有密钥
          </button>
          <div className="footer-right">
            <button type="button" className="btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={handleSave}>
              {saveSuccess ? '✓ 已保存生效' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
