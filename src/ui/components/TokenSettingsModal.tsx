import React, { useState, useEffect } from 'react'
import type { TokenConfig } from '../../types.ts'
import { TOKEN_STORAGE_KEY } from '../../types.ts'
import {
  comfyUIVideoProvider,
  COMFY_URL_STORAGE_KEY,
  COMFY_PRESET_STORAGE_KEY,
} from '../../media/providers/comfyui.ts'
import { resolveMemorySource, type MemorySource } from '../../canvas/memorySource.ts'
import { clearMemoryRecords } from '../../services/companion/memoryClient.ts'
import { clearAllFeedbackRecords } from '../../domain/feedback.ts'
import { useLanguage, useSetLanguage, useT } from '../../i18n/useLanguage.ts'
import { LANGUAGES, type Language } from '../../i18n/strings.ts'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
  /** E1：打开记忆图谱（全屏覆盖层；未提供时按钮不渲染，调用方自行渲染 MemoryGraphView） */
  onOpenMemoryGraph?: () => void
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
  onOpenMemoryGraph,
}) => {
  // I1：界面语言（默认中文；切换即时生效并持久化，零业务数据影响）
  const lang = useLanguage()
  const setLang = useSetLanguage()
  const t = useT()
  const [tokenConfig, setTokenConfig] = useState<TokenConfig>({
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    model: 'deepseek-ai/DeepSeek-V3',
  })
  const [videoProvider, setVideoProvider] = useState<'mock' | 'kling' | 'jimeng' | 'comfyui'>('mock')
  const [klingKey, setKlingKey] = useState('')
  const [jimengKey, setJimengKey] = useState('')
  const [comfyUrl, setComfyUrl] = useState('http://127.0.0.1:8188')
  const [comfyPreset, setComfyPreset] = useState<string>('wan2.1-i2v')
  const [comfyTestStatus, setComfyTestStatus] = useState<{
    testing: boolean
    ok?: boolean
    msg?: string
  }>({ testing: false })
  const [saveSuccess, setSaveSuccess] = useState(false)

  // S3 记忆区块：双模聚合源 + 清除状态
  const [memory, setMemory] = useState<MemorySource | null>(null)
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [memoryMsg, setMemoryMsg] = useState<string | null>(null)

  const loadMemory = async () => {
    setMemoryBusy(true)
    setMemoryMsg(null)
    try {
      setMemory(await resolveMemorySource())
    } finally {
      setMemoryBusy(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      void loadMemory()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleClearMemory = async () => {
    if (memoryBusy || !memory) return
    setMemoryBusy(true)
    setMemoryMsg(null)
    try {
      if (memory.mode === 'server') {
        const r = await clearMemoryRecords()
        setMemoryMsg(
          r.ok
            ? `✓ 已清除伴生服务端全部 ${r.cleared} 条回流记录（跨刷新持久化数据），胜率回退先验 0.5`
            : `⚠️ 清除失败：${r.error}`
        )
      } else {
        await clearAllFeedbackRecords()
        setMemoryMsg('✓ 已清除本机 IndexedDB 全部回流记录（仅本机数据），胜率回退先验 0.5')
      }
      setMemory(await resolveMemorySource())
    } finally {
      setMemoryBusy(false)
    }
  }

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
      if (savedProvider === 'kling' || savedProvider === 'jimeng' || savedProvider === 'comfyui') {
        setVideoProvider(savedProvider)
      }
      const savedKling = sessionStorage.getItem('weblockshot.kling_key')
      if (savedKling) setKlingKey(savedKling)
      const savedJimeng = sessionStorage.getItem('weblockshot.jimeng_key')
      if (savedJimeng) setJimengKey(savedJimeng)
      const savedComfyUrl = sessionStorage.getItem(COMFY_URL_STORAGE_KEY)
      if (savedComfyUrl) setComfyUrl(savedComfyUrl)
      const savedComfyPreset = sessionStorage.getItem(COMFY_PRESET_STORAGE_KEY)
      if (savedComfyPreset) setComfyPreset(savedComfyPreset)
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
    sessionStorage.setItem(COMFY_URL_STORAGE_KEY, comfyUrl)
    sessionStorage.setItem(COMFY_PRESET_STORAGE_KEY, comfyPreset)
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
    sessionStorage.removeItem(COMFY_URL_STORAGE_KEY)
    sessionStorage.removeItem(COMFY_PRESET_STORAGE_KEY)
    setTokenConfig({
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      model: 'deepseek-ai/DeepSeek-V3',
    })
    setKlingKey('')
    setJimengKey('')
    setComfyUrl('http://127.0.0.1:8188')
    setComfyPreset('wan2.1-i2v')
    setVideoProvider('mock')
    onSaved?.()
  }

  const handleTestComfy = async () => {
    setComfyTestStatus({ testing: true })
    const res = await comfyUIVideoProvider.testConnection(comfyUrl)
    if (res.ok) {
      setComfyTestStatus({
        testing: false,
        ok: true,
        msg: `✓ 成功连接 ComfyUI！显卡设备: ${res.gpuName || 'GPU'} (可用显存: ${res.vramFreeGb ?? '动态'} GB)`,
      })
    } else {
      setComfyTestStatus({
        testing: false,
        ok: false,
        msg: `⚠️ 连接失败: ${res.error}`,
      })
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">⚙️</span>
            <h3>{t('settings.title')}</h3>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {/* I1：界面语言切换（默认中文；切换即时生效并持久化） */}
          <div className="settings-section" data-testid="language-section">
            <div className="section-title-bar">
              <h4>{t('settings.langSection')}</h4>
            </div>
            <div className="presets-row" role="radiogroup" aria-label={t('settings.langSection')}>
              {LANGUAGES.map((code: Language) => (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={lang === code}
                  className={`preset-btn-chip${lang === code ? ' active' : ''}`}
                  data-testid={`language-${code}`}
                  onClick={() => setLang(code)}
                >
                  {code === 'zh' ? t('settings.langZh') : t('settings.langEn')}
                </button>
              ))}
            </div>
            <div className="security-text">
              <small>{t('settings.langHint')}</small>
            </div>
          </div>

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
              <h4>{t('settings.sectionLlm')}</h4>
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
              <h4>{t('settings.sectionVideo')}</h4>
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
                  <strong>Mock 真实录制（免费）</strong>
                  <p>MediaRecorder 本地真录制，0 门槛秒级出片</p>
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

              <label
                className={`provider-card-option ${videoProvider === 'comfyui' ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="video_provider"
                  value="comfyui"
                  checked={videoProvider === 'comfyui'}
                  onChange={() => setVideoProvider('comfyui')}
                />
                <div>
                  <strong>🔥 ComfyUI 私有 GPU 算力集群</strong>
                  <p>0 接口费直调本地/云端 GPU，支持阿里 Wan 2.1 / CogVideoX</p>
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

            {videoProvider === 'comfyui' && (
              <div className="form-item mt-3">
                <div className="section-title-bar">
                  <label>ComfyUI 实例 Base URL：</label>
                  <button
                    type="button"
                    className="btn-test-comfy"
                    onClick={handleTestComfy}
                    disabled={comfyTestStatus.testing}
                  >
                    {comfyTestStatus.testing ? '正在握手 Ping...' : '🔍 测试连接 (Ping GPU)'}
                  </button>
                </div>
                <input
                  type="text"
                  className="text-input"
                  placeholder="http://127.0.0.1:8188 或远程公网 IP"
                  value={comfyUrl}
                  onChange={(e) => setComfyUrl(e.target.value)}
                />

                {comfyTestStatus.msg && (
                  <div
                    className={`comfy-ping-banner ${
                      comfyTestStatus.ok ? 'success' : 'error'
                    }`}
                  >
                    {comfyTestStatus.msg}
                  </div>
                )}

                {/* ComfyUI 部署与启动指引说明 */}
                <div className="comfy-deploy-guide-box">
                  <div className="guide-title">
                    💡 为什么测试连接失败？及如何本地/远程部署 ComfyUI：
                  </div>
                  <ol className="guide-steps">
                    <li>
                      <strong>本地尚未启动 ComfyUI</strong>：若您尚未在电脑启动 ComfyUI，前端探测 <code>127.0.0.1:8188</code> 自然会提示 <code>Failed to fetch</code>。
                    </li>
                    <li>
                      <strong>启动命令必须携带 <code>--listen</code> 参数</strong>：
                      <code>python main.py --listen 127.0.0.1 --port 8188</code>
                      （如部署在远程 GPU 服务器，请使用 <code>--listen 0.0.0.0</code> 并在上方填入对应公网 IP）。
                    </li>
                    <li>
                      <strong>支持的底模</strong>：已内置适配阿里开源 <strong>Wan 2.1 (WanVideo I2V)</strong>、智谱 <strong>CogVideoX-5B</strong> 及 <strong>SVD-XT</strong>。本地启动成功后点击「测试连接」即可瞬间读取显卡型号与可用显存！
                    </li>
                  </ol>
                </div>

                <div className="form-item mt-2">
                  <label>预设生视频工作流底模：</label>
                  <select
                    value={comfyPreset}
                    onChange={(e) => setComfyPreset(e.target.value)}
                    className="text-input"
                  >
                    <option value="wan2.1-i2v">阿里 Wan 2.1 (万象开源生视频 14B / 1.3B I2V)</option>
                    <option value="cogvideox-5b">智谱 CogVideoX-5B 图生视频</option>
                    <option value="svd-xt">SVD-XT (Stable Video Diffusion 电商微动)</option>
                    <option value="custom">自定义工作流 API (通过 /prompt 节点图注入)</option>
                  </select>
                </div>
                <small className="hint-text">
                  默认通过 Vite 代理连接 <code>http://127.0.0.1:8188</code>。若部署在远程 GPU 服务器，请输入完整公网 IP:端口。
                </small>
              </div>
            )}
          </div>

          {/* 模块 C：S3 记忆系统（结构化，不玄学） */}
          <div className="settings-section">
            <div className="section-title-bar">
              <h4>{t('settings.sectionMemory')}</h4>
              <span className="section-tag">
                {memory ? (memory.mode === 'server' ? '伴生服务 sqlite' : '纯前端模式') : '探测中…'}
              </span>
            </div>

            <div className="security-notice-box">
              <span className="security-icon">🧠</span>
              <div className="security-text">
                {memory?.mode === 'server' ? (
                  <>
                    <strong>服务端记忆模式：</strong>回流记录存于本地伴生服务（sqlite，跨刷新持久化）。
                    script 节点生成时按你的历史胜率加权采样钩子。
                  </>
                ) : (
                  <>
                    <strong>纯前端模式 · 记忆仅存本地：</strong>
                    回流记录存于本机 IndexedDB，不上传任何服务器；接入以 <code>WLS_STORAGE=sqlite</code>
                    启动的伴生服务后可升级为服务端记忆。
                  </>
                )}
              </div>
            </div>

            {memory && (
              <div className="memory-stats">
                <div className="hint-text" style={{ marginBottom: '0.4rem' }}>
                  共 {memory.records.length} 条回流记录 · 胜率 = Laplace 平滑（(胜+1)/(试+2)，样本少自动趋近 0.5 先验）
                </div>
                {(['byTemplate', 'byHook', 'byCategory'] as const).map((bucket) => {
                  const label =
                    bucket === 'byTemplate' ? '按结构' : bucket === 'byHook' ? '按钩子' : '按品类'
                  const top = [...memory.aggregate[bucket].entries()]
                    .sort((a, b) => b[1].trials - a[1].trials)
                    .slice(0, 3)
                  return (
                    <div key={bucket} className="memory-bucket">
                      <strong>{label}：</strong>
                      {top.length === 0 ? (
                        <span className="hint-text">暂无数据</span>
                      ) : (
                        top.map(([key, stat]) => (
                          <span key={key} className="memory-stat-chip" title={key}>
                            {key}：{stat.wins}胜/{stat.trials}试 · {(stat.winRate * 100).toFixed(0)}%
                          </span>
                        ))
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {memoryMsg && (
              <div className="comfy-ping-banner success" role="status">
                {memoryMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={memoryBusy || !memory || memory.records.length === 0}
                onClick={() => void handleClearMemory()}
              >
                {memoryBusy ? '处理中…' : '🗑️ 清除全部记忆'}
              </button>
              {onOpenMemoryGraph && (
                <button
                  type="button"
                  className="btn-secondary"
                  data-testid="open-memory-graph-settings"
                  onClick={onOpenMemoryGraph}
                >
                  🗺️ 查看记忆图谱
                </button>
              )}
            </div>
            <small className="hint-text" style={{ display: 'block', marginTop: '0.3rem' }}>
              清除范围：{memory?.mode === 'server' ? '伴生服务端全部回流记录（sqlite 持久化数据）' : '本机 IndexedDB 全部回流记录'}。
              清除后胜率回退 0.5 先验，钩子采样恢复均匀分布；不影响画布文档与已生成产物。
            </small>
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
