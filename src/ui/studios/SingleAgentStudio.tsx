import React, { useState } from 'react'
import {
  polishPrompt,
  STYLE_OPTIONS,
  type PolishStyle,
} from '../../ai/agents/promptPolisher.ts'
import { klingVideoProvider } from '../../media/providers/kling.ts'
import { jimengVideoProvider } from '../../media/providers/jimeng.ts'
import { mockVideoProvider } from '../../media/providers/mock.ts'
import type { VideoGenRequest, VideoProvider } from '../../media/types.ts'
import { TOKEN_STORAGE_KEY, type TokenConfig } from '../../types.ts'

export type SinglePromptPreset = {
  id: string
  title: string
  category: string
  icon: string
  prompt: string
  negative: string
  style: PolishStyle
}

export const SINGLE_PROMPT_PRESETS: SinglePromptPreset[] = [
  {
    id: 'preset-3c',
    title: '3C 数码金属光泽与微距',
    category: '数码家电',
    icon: '📱',
    prompt:
      'High-speed ionic hair dryer, brushed metallic matte finish, precision engineered nozzles. Extreme macro close-up, dramatic studio rim lighting contrasting deep shadows, gentle slow orbital camera movement, dynamic air particle flow visualization, photorealistic 8K.',
    negative: 'blurry, plastic, cheap, low resolution, fingerprint, dust, deformed',
    style: 'cyberpunk',
  },
  {
    id: 'preset-cosmetics',
    title: '美妆水润精华露微距升格',
    category: '美妆个护',
    icon: '💄',
    prompt:
      'Translucent hydrating serum droplet falling onto pristine glass surface, creating delicate concentric ripple waves in slow-motion 120fps. Studio softbox diffusion lighting, pristine subsurface scattering, sparkling reflections, ultra-clean luxury cosmetic commercial, 8K.',
    negative: 'murky, opaque, bubbles, noisy, low contrast, dull, pixelated',
    style: 'luxury',
  },
  {
    id: 'preset-fashion',
    title: '潮流穿搭机能光影走秀',
    category: '服饰潮牌',
    icon: '👟',
    prompt:
      'Futuristic urban street style sneaker suspended in mid-air, slow 360-degree rotation. Wet reflective concrete floor, moody neon ambient backlight, water droplets bouncing off waterproof mesh fabric, dynamic anamorphic lens flare, cinematic commercial, 8K.',
    negative: 'static, flat lighting, messy background, low quality, oversaturated',
    style: 'cinematic',
  },
  {
    id: 'preset-food',
    title: '美食甜品热气升腾慢动作',
    category: '食品生鲜',
    icon: '🍵',
    prompt:
      'Rich molten chocolate poured over velvety golden pastry, delicate steam wisps rising in slow-motion against warm dark wooden backdrop. Warm golden hour backlight emphasizing luscious gloss texture, 85mm shallow depth of field, appetizing masterpiece, 8K.',
    negative: 'cold, artificial, plastic, messy, overexposed, low detail',
    style: 'fresh',
  },
  {
    id: 'preset-outdoor',
    title: '户外防水背包抗压水雾测试',
    category: '户外箱包',
    icon: '🎒',
    prompt:
      'Tactical waterproof backpack subjected to high-pressure water spray test. Extreme close-up on water droplets beading and rolling off hydrophobic Cordura fabric, high-speed shutter freezing individual water droplets, rugged industrial studio lighting, 8K photorealistic.',
    negative: 'soaked, leaking, cheap nylon, cartoonish, low resolution',
    style: 'minimal',
  },
  {
    id: 'preset-jewelry',
    title: '璀璨珠宝钻石棱镜微距折射',
    category: '珠宝首饰',
    icon: '✨',
    prompt:
      'Flawless cut brilliant diamond ring resting on obsidian black mirror pedestal, slow graceful spin. Prismatic rainbow light dispersion caustics dancing across facets, macro 100mm lens, pinpoint starburst specular highlights, high-end fine jewelry commercial, 8K.',
    negative: 'cloudy, scratched, dull, fake, plastic, low poly, noisy',
    style: 'luxury',
  },
]

type Props = {
  onOpenSettings: () => void
}

export const SingleAgentStudio: React.FC<Props> = ({ onOpenSettings }) => {
  // 基础参数
  const [providerId, setProviderId] = useState<'mock' | 'kling' | 'jimeng'>('mock')
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16')
  const [durationSec, setDurationSec] = useState<number>(5)

  // 提示词与润色状态
  const [prompt, setPrompt] = useState(SINGLE_PROMPT_PRESETS[0].prompt)
  const [negativePrompt, setNegativePrompt] = useState(SINGLE_PROMPT_PRESETS[0].negative)
  const [rawIdea, setRawIdea] = useState('')
  const [selectedStyle, setSelectedStyle] = useState<PolishStyle>('cinematic')
  const [polishVariation, setPolishVariation] = useState<number>(0)
  const [isPolishing, setIsPolishing] = useState(false)
  const [polishMeta, setPolishMeta] = useState<{
    camera?: string
    lighting?: string
    tags?: string[]
  } | null>(null)

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [generationStatus, setGenerationStatus] = useState<string>('')
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const readToken = (): TokenConfig | null => {
    try {
      const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
      if (!raw) return null
      return JSON.parse(raw) as TokenConfig
    } catch {
      return null
    }
  }

  // 选用预设模版
  const handleSelectPreset = (p: SinglePromptPreset) => {
    setPrompt(p.prompt)
    setNegativePrompt(p.negative)
    setSelectedStyle(p.style)
    setPolishMeta(null)
  }

  // AI 提示词智能润色/扩写
  const handlePolishPrompt = async (isRegen = false) => {
    if (!rawIdea.trim() && !prompt.trim()) return
    setIsPolishing(true)
    setErrorMsg(null)

    const nextVariation = isRegen ? polishVariation + 1 : 0
    setPolishVariation(nextVariation)

    try {
      const token = readToken()
      const result = await polishPrompt({
        rawIdea: rawIdea.trim() || prompt.slice(0, 100),
        style: selectedStyle,
        variation: nextVariation,
        tokenConfig: token?.apiKey ? token : null,
      })

      setPrompt(result.polishedPrompt)
      setNegativePrompt(result.negativePrompt)
      setPolishMeta({
        camera: result.cameraMovement,
        lighting: result.lighting,
        tags: result.tags,
      })
    } catch (err: any) {
      setErrorMsg(`润色失败: ${err.message || '未知错误'}`)
    } finally {
      setIsPolishing(false)
    }
  }

  // 执行单 Agent 视频直出生成
  const handleGenerateVideo = async () => {
    if (!prompt.trim()) {
      setErrorMsg('请输入生成提示词！')
      return
    }

    setIsGenerating(true)
    setGenerationProgress(10)
    setGenerationStatus('正在向视频生成服务提交请求...')
    setErrorMsg(null)

    try {
      let provider: VideoProvider = mockVideoProvider
      if (providerId === 'kling') provider = klingVideoProvider
      if (providerId === 'jimeng') provider = jimengVideoProvider
      const req: VideoGenRequest = {
        clientTaskId: `single-task-${Date.now()}`,
        shotId: `single-${Date.now()}`,
        prompt,
        negative: negativePrompt,
        durationSec,
        ratio: '9:16',
        title: rawIdea || prompt.slice(0, 30),
      }

      setGenerationProgress(25)
      setGenerationStatus(`已连接 ${providerId === 'kling' ? '可灵 Kling' : providerId === 'jimeng' ? '即梦 Jimeng' : 'Mock 本地录制'}，任务调度中...`)

      const { taskId } = await provider.submit(req)

      // 轮询查询视频渲染结果
      let attempts = 0
      const maxAttempts = 40
      const pollTimer = setInterval(async () => {
        attempts++
        try {
          const pollRes = await provider.poll(taskId)
          setGenerationProgress(Math.min(95, 25 + attempts * 3))
          setGenerationStatus(`模型神经渲染中... (${attempts * 2}s)`)

          if (pollRes.status === 'succeeded') {
            clearInterval(pollTimer)
            const asset = await provider.getAsset(taskId)
            setGenerationProgress(100)
            setGenerationStatus('视频生成完成！')
            setGeneratedVideoUrl(asset.url)
            setIsGenerating(false)
          } else if (pollRes.status === 'failed') {
            clearInterval(pollTimer)
            setIsGenerating(false)
            setErrorMsg(`生成失败: ${pollRes.error || '远端生成异常'}`)
          } else if (attempts >= maxAttempts) {
            clearInterval(pollTimer)
            setIsGenerating(false)
            // 若超时但本地有降级
            const asset = await provider.getAsset(taskId)
            if (asset) {
              setGeneratedVideoUrl(asset.url)
            } else {
              setErrorMsg('生成超时，请检查网络或 API 余额。')
            }
          }
        } catch (err: any) {
          clearInterval(pollTimer)
          setIsGenerating(false)
          setErrorMsg(err.message || '查询任务状态出错')
        }
      }, 1500)
    } catch (err: any) {
      setIsGenerating(false)
      setErrorMsg(err.message || '提交生片请求失败')
    }
  }

  return (
    <div className="single-agent-studio">
      {/* 顶部配置 Bar */}
      <div className="studio-topbar">
        <div className="topbar-left">
          <span className="studio-badge">⚡ 单 Agent 极速直出模式</span>
          <span className="studio-subtext">支持文本直调即梦 / 可灵 API · 内置 AI 运镜润色扩写</span>
        </div>
        <div className="topbar-controls">
          {/* Provider 选择 */}
          <div className="control-pill-group">
            <span className="pill-label">模型引擎:</span>
            <button
              type="button"
              className={`pill-btn ${providerId === 'mock' ? 'active' : ''}`}
              onClick={() => setProviderId('mock')}
            >
              Mock 实验画布 (免费)
            </button>
            <button
              type="button"
              className={`pill-btn ${providerId === 'kling' ? 'active' : ''}`}
              onClick={() => setProviderId('kling')}
            >
              快手可灵 (Kling)
            </button>
            <button
              type="button"
              className={`pill-btn ${providerId === 'jimeng' ? 'active' : ''}`}
              onClick={() => setProviderId('jimeng')}
            >
              字节即梦 (Jimeng)
            </button>
          </div>

          {/* 画幅比例 */}
          <div className="control-pill-group">
            <span className="pill-label">画幅:</span>
            {(['9:16', '16:9', '1:1'] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`pill-btn ${aspectRatio === r ? 'active' : ''}`}
                onClick={() => setAspectRatio(r)}
              >
                {r === '9:16' ? '9:16 竖屏' : r === '16:9' ? '16:9 横屏' : '1:1 方形'}
              </button>
            ))}
          </div>

          {/* 时长 */}
          <div className="control-pill-group">
            <span className="pill-label">时长:</span>
            {[5, 10].map((d) => (
              <button
                key={d}
                type="button"
                className={`pill-btn ${durationSec === d ? 'active' : ''}`}
                onClick={() => setDurationSec(d)}
              >
                {d} 秒
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn-settings-small"
            onClick={onOpenSettings}
            title="查看或配置 API 密钥"
          >
            ⚙️ 配置 Key
          </button>
        </div>
      </div>

      <div className="studio-layout">
        {/* 左侧：输入与优化区 */}
        <div className="studio-left-pane">
          {/* 1. 预设模版快速填充 */}
          <div className="panel-card">
            <div className="panel-header">
              <span className="panel-title">📚 爆款提示词预设模板</span>
              <span className="panel-hint">点击一键载入行业精调模版</span>
            </div>
            <div className="preset-grid">
              {SINGLE_PROMPT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="preset-chip-card"
                  onClick={() => handleSelectPreset(p)}
                >
                  <span className="chip-icon">{p.icon}</span>
                  <div className="chip-text">
                    <strong>{p.title}</strong>
                    <span>{p.category}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 2. 🪄 AI 提示词智能完善/扩写工具 */}
          <div className="panel-card highlight-card">
            <div className="panel-header">
              <div className="header-title-flex">
                <span className="panel-title">🪄 AI 提示词完善与智能润色 Agent</span>
                <span className="ai-tag">Prompt Expander</span>
              </div>
              <span className="panel-hint">只需输入简短想法，AI 自动扩写为好莱坞级运镜提示词</span>
            </div>

            <div className="polisher-body">
              <div className="input-group">
                <input
                  type="text"
                  className="text-input"
                  placeholder="例如：口红涂抹特写，高级冷白皮，水润水光感..."
                  value={rawIdea}
                  onChange={(e) => setRawIdea(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePolishPrompt(false)
                  }}
                />
              </div>

              {/* 风格选项 */}
              <div className="style-chips-row">
                <span className="row-label">视觉风格:</span>
                {STYLE_OPTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`style-chip ${selectedStyle === s.id ? 'selected' : ''}`}
                    onClick={() => setSelectedStyle(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="polish-action-bar">
                <button
                  type="button"
                  className="btn-polish-primary"
                  onClick={() => handlePolishPrompt(false)}
                  disabled={isPolishing || (!rawIdea && !prompt)}
                >
                  {isPolishing ? '✨ 智能扩写润色中...' : '🪄 一键润色为电影级提示词'}
                </button>

                <button
                  type="button"
                  className="btn-polish-regen"
                  onClick={() => handlePolishPrompt(true)}
                  disabled={isPolishing || (!rawIdea && !prompt)}
                  title="不满意当前效果？换个机位与角度重新润色"
                >
                  🔄 不满意？重新换风格生成 (变体 #{polishVariation + 1})
                </button>
              </div>

              {/* 润色参数提炼展示 */}
              {polishMeta && (
                <div className="polisher-meta-card">
                  {polishMeta.camera && (
                    <div className="meta-row">
                      <span className="meta-badge">📷 运镜轨迹:</span>
                      <span className="meta-text">{polishMeta.camera}</span>
                    </div>
                  )}
                  {polishMeta.lighting && (
                    <div className="meta-row">
                      <span className="meta-badge">💡 光影材质:</span>
                      <span className="meta-text">{polishMeta.lighting}</span>
                    </div>
                  )}
                  {polishMeta.tags && polishMeta.tags.length > 0 && (
                    <div className="meta-tags-row">
                      {polishMeta.tags.map((t, idx) => (
                        <span key={idx} className="polish-tag">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 3. 最终提示词编辑与负向提示词 */}
          <div className="panel-card">
            <div className="panel-header">
              <span className="panel-title">📝 生成提示词 (Prompt)</span>
              <button
                type="button"
                className="btn-text-action"
                onClick={() => {
                  navigator.clipboard.writeText(prompt)
                }}
              >
                📋 复制提示词
              </button>
            </div>
            <textarea
              className="prompt-textarea"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="正向提示词..."
            />

            <div className="panel-header mt-3">
              <span className="panel-title-sub">🚫 负向提示词 (Negative Prompt)</span>
            </div>
            <textarea
              className="prompt-textarea negative-textarea"
              rows={2}
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="避免出现的瑕疵..."
            />

            {errorMsg && <div className="studio-error-banner">⚠️ {errorMsg}</div>}

            <div className="generate-submit-row">
              <button
                type="button"
                className="btn-start-video-gen"
                onClick={handleGenerateVideo}
                disabled={isGenerating || !prompt.trim()}
              >
                {isGenerating
                  ? '🚀 视频渲染管线运转中...'
                  : `🚀 立即直调 ${providerId === 'kling' ? '可灵 API' : providerId === 'jimeng' ? '即梦 API' : 'Mock 画布'} 生成视频`}
              </button>
            </div>
          </div>
        </div>

        {/* 右侧：实时渲染监控与播放交付 */}
        <div className="studio-right-pane">
          <div className="panel-card monitor-card">
            <div className="panel-header">
              <span className="panel-title">🎬 视频生成监视器与交付</span>
              {isGenerating && <span className="live-pulse-dot" />}
            </div>

            <div className="video-viewport-box">
              {isGenerating ? (
                <div className="viewport-generating-state">
                  <div className="spin-ring" />
                  <span className="generating-title">{generationStatus}</span>
                  <div className="gen-progress-track">
                    <div
                      className="gen-progress-fill"
                      style={{ width: `${generationProgress}%` }}
                    />
                  </div>
                  <span className="progress-percent">{generationProgress}%</span>
                </div>
              ) : generatedVideoUrl ? (
                <div className="viewport-video-ready">
                  <video
                    src={generatedVideoUrl}
                    className="viewport-player"
                    controls
                    autoPlay
                    loop
                    playsInline
                  />
                  <div className="player-actions">
                    <a
                      href={generatedVideoUrl}
                      download={`weblockshot-${providerId}-${Date.now()}.mp4`}
                      className="btn-download-video"
                    >
                      ⬇️ 下载 MP4 视频
                    </a>
                  </div>
                </div>
              ) : (
                <div className="viewport-idle-state">
                  <span className="idle-icon">🎥</span>
                  <h4>等待生成指令</h4>
                  <p>
                    在左侧选择模板或使用 AI 润色提示词后，点击下方「立即直调 API
                    生成视频」开始渲染。
                  </p>
                  <div className="idle-specs-badge">
                    <span>画幅: {aspectRatio}</span>
                    <span>时长: {durationSec}s</span>
                    <span>引擎: {providerId}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
