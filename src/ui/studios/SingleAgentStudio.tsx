import React, { useState } from 'react'
import {
  polishPrompt,
  STYLE_OPTIONS,
  type PolishStyle,
} from '../../ai/agents/promptPolisher.ts'
import { klingVideoProvider } from '../../media/providers/kling.ts'
import { jimengVideoProvider } from '../../media/providers/jimeng.ts'
import { comfyUIVideoProvider } from '../../media/providers/comfyui.ts'
import { mockVideoProvider } from '../../media/providers/mock.ts'
import type { VideoGenRequest, VideoProvider } from '../../media/types.ts'
import { walletManager } from '../../domain/wallet.ts'
import { circuitBreaker } from '../../domain/fsm.ts'
import { idempotencyManager } from '../../domain/idempotency.ts'
import { TOKEN_STORAGE_KEY, type TokenConfig } from '../../types.ts'
import {
  resolveAsset,
  ALL_PRESET_ASSETS,
} from '../../assets/presets/index.ts'
import { ImageLightboxModal } from '../components/ImageLightboxModal.tsx'

export type SinglePromptPreset = {
  id: string
  title: string
  category: string
  icon: string
  image: string
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
    image: resolveAsset('hair_dryer.jpg'),
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
    image: resolveAsset('clay_mask.jpg'),
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
    image: resolveAsset('sneaker.svg'),
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
    image: resolveAsset('food_dessert.svg'),
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
    image: resolveAsset('tech_bag.jpg'),
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
    image: resolveAsset('diamond_ring.svg'),
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
  const [providerId, setProviderId] = useState<'mock' | 'kling' | 'jimeng' | 'comfyui'>('mock')
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16')
  const [durationSec, setDurationSec] = useState<number>(5)
  const [isCustomDuration, setIsCustomDuration] = useState<boolean>(false)

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

  // 多模态参考素材：参考图片 (首帧/垫图) 与参考视频 (运镜参考)
  const [referenceImage, setReferenceImage] = useState<string | null>(SINGLE_PROMPT_PRESETS[0].image)
  const [referenceVideo, setReferenceVideo] = useState<string | null>(null)
  const [referenceVideoName, setReferenceVideoName] = useState<string>('')
  const [motionPrompt, setMotionPrompt] = useState<string>('')
  const [isImageLightboxOpen, setIsImageLightboxOpen] = useState(false)

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [generationStatus, setGenerationStatus] = useState<string>('')
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // ComfyUI 选中后的自动握手结果（与 kling/jimeng 的「未配置即报错」对齐）
  type ComfyPingState = {
    status: 'idle' | 'testing' | 'ok' | 'error'
    msg?: string
    gpuName?: string
    vramFreeGb?: number
  }
  const [comfyPing, setComfyPing] = useState<ComfyPingState>({ status: 'idle' })

  /** 探测本地/远程 ComfyUI 实例可达性，结果回写 banner + 必要时的引导错误 */
  const runComfyPing = async (): Promise<boolean> => {
    setComfyPing({ status: 'testing' })
    const res = await comfyUIVideoProvider.testConnection()
    if (res.ok) {
      const vram = res.vramFreeGb != null ? `，可用显存 ${res.vramFreeGb} GB` : ''
      setComfyPing({
        status: 'ok',
        msg: `✓ 已连接 ComfyUI${res.gpuName ? ` · 显卡 ${res.gpuName}` : ''}${vram}`,
        gpuName: res.gpuName,
        vramFreeGb: res.vramFreeGb,
      })
      setErrorMsg(null)
      return true
    }
    setComfyPing({
      status: 'error',
      msg: res.error || '未检测到本地 ComfyUI 实例',
    })
    setErrorMsg(
      `当前选用了 ComfyUI 私有算力，但 ${res.error || '未检测到本地 ComfyUI 服务'}。请确认 ComfyUI 已启动（默认 http://127.0.0.1:8188）后点击下方「⚙️ 前往配置 API Key」核对地址，或切换为 Mock 免费模式。`
    )
    return false
  }

  const readToken = (): TokenConfig | null => {
    try {
      const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
      if (!raw) return null
      return JSON.parse(raw) as TokenConfig
    } catch {
      return null
    }
  }

  // 选用预设模版，同时自动填充对应的商业/Mock 预设图片
  const handleSelectPreset = (p: SinglePromptPreset) => {
    setPrompt(p.prompt)
    setNegativePrompt(p.negative)
    setSelectedStyle(p.style)
    setReferenceImage(p.image)
    setPolishMeta(null)
  }

  const handleSelectProvider = (id: 'mock' | 'kling' | 'jimeng' | 'comfyui') => {
    setProviderId(id)
    if (id === 'kling') {
      try {
        const key = sessionStorage.getItem('weblockshot.kling_key')
        if (!key?.trim()) {
          setErrorMsg('未检测到快手可灵 API Key！请点击下方「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 免费模式。')
          setComfyPing({ status: 'idle' })
          return
        }
      } catch {}
    }
    if (id === 'jimeng') {
      try {
        const key = sessionStorage.getItem('weblockshot.jimeng_key')
        if (!key?.trim()) {
          setErrorMsg('未检测到字节即梦 (Jimeng) API Key！请点击下方「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 免费模式。')
          setComfyPing({ status: 'idle' })
          return
        }
      } catch {}
    }
    if (id === 'comfyui') {
      // 选中 ComfyUI 时异步探测实例可达性，结果回写到 banner 与 errorMsg
      void runComfyPing()
      return
    }
    // 切到 mock 时清掉 ComfyUI 探测残留状态
    setComfyPing({ status: 'idle' })
    setErrorMsg(null)
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

    if (providerId === 'kling') {
      try {
        const key = sessionStorage.getItem('weblockshot.kling_key')
        if (!key?.trim()) {
          setErrorMsg('当前选用了快手可灵 (Kling) 渲染引擎，但尚未配置 API Key！请点击上方「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 免费模式。')
          return
        }
      } catch {}
    }

    if (providerId === 'jimeng') {
      try {
        const key = sessionStorage.getItem('weblockshot.jimeng_key')
        if (!key?.trim()) {
          setErrorMsg('当前选用了字节即梦 (Jimeng) 渲染引擎，但尚未配置 API Key！请点击上方「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 免费模式。')
          return
        }
      } catch {}
    }

    if (providerId === 'comfyui') {
      // 与 kling/jimeng 同样在生成前校验：若上次 ping 失败或尚未 ping，重新探测
      if (comfyPing.status !== 'ok') {
        const ok = await runComfyPing()
        if (!ok) return
      }
    }

    // 0. 熔断与幂等检查
    const breakerCheck = circuitBreaker.isAvailable(providerId)
    if (!breakerCheck.allowed) {
      setErrorMsg(breakerCheck.reason || '当前服务暂时熔断保护中')
      return
    }

    const taskKey = idempotencyManager.generateKey({
      intent: 'single-studio-generate',
      providerId,
      prompt,
      durationSec,
      ratio: aspectRatio,
    })

    const lockResult = idempotencyManager.acquireLock(taskKey)
    if (!lockResult.success) {
      setErrorMsg(lockResult.reason || '任务正在执行中，请勿连击')
      return
    }

    // 1. 钱包预冻结
    const cost = walletManager.getCost(providerId, 1)
    const freezeSuccess = walletManager.freeze(
      cost,
      taskKey,
      providerId,
      `单 Agent 直出 (${providerId === 'kling' ? '可灵' : providerId === 'jimeng' ? '即梦' : '自建/Mock'})`
    )

    if (!freezeSuccess) {
      idempotencyManager.releaseLock(taskKey)
      setErrorMsg(`钱包可用余额不足 (需 ${cost} 灵感币)，请在顶部虚拟钱包中模拟充值。`)
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
      if (providerId === 'comfyui') provider = comfyUIVideoProvider
      const req: VideoGenRequest = {
        clientTaskId: taskKey,
        shotId: `single-${Date.now()}`,
        prompt,
        negative: negativePrompt,
        imageBase64: referenceImage || undefined,
        referenceVideoUrl: referenceVideo || undefined,
        motionPrompt: motionPrompt || undefined,
        durationSec,
        ratio: '9:16',
        title: rawIdea || prompt.slice(0, 30),
      }

      setGenerationProgress(25)
      setGenerationStatus(
        `已连接 ${
          providerId === 'kling'
            ? '快手可灵 Kling'
            : providerId === 'jimeng'
            ? '字节即梦 Jimeng'
            : providerId === 'comfyui'
            ? 'ComfyUI 本地/私有 GPU 集群 (Wan2.1)'
            : 'Mock 本地录制'
        }，任务调度中...`
      )

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

            // 资金与熔断结算
            walletManager.settle(taskKey, cost, providerId, '单 Agent 视频生成成功核销')
            circuitBreaker.recordSuccess(providerId)
            idempotencyManager.releaseLock(taskKey)
          } else if (pollRes.status === 'failed') {
            clearInterval(pollTimer)
            setIsGenerating(false)
            setErrorMsg(`生成失败: ${pollRes.error || '远端生成异常'}`)

            // 失败全额退款
            walletManager.refund(taskKey, cost, providerId, `生成异常退还: ${pollRes.error || '远端生成异常'}`)
            circuitBreaker.recordFailure(providerId)
            idempotencyManager.releaseLock(taskKey)
          } else if (attempts >= maxAttempts) {
            clearInterval(pollTimer)
            setIsGenerating(false)
            // 若超时但本地有降级
            const asset = await provider.getAsset(taskId)
            if (asset) {
              setGeneratedVideoUrl(asset.url)
              walletManager.settle(taskKey, cost, providerId, '单 Agent 视频完成核销')
              circuitBreaker.recordSuccess(providerId)
            } else {
              setErrorMsg('生成超时，请检查网络或 API 余额。')
              walletManager.refund(taskKey, cost, providerId, '生成超时全额退款')
              circuitBreaker.recordFailure(providerId)
            }
            idempotencyManager.releaseLock(taskKey)
          }
        } catch (err: any) {
          clearInterval(pollTimer)
          setIsGenerating(false)
          setErrorMsg(err.message || '查询任务状态出错')
          walletManager.refund(taskKey, cost, providerId, `查询异常退款: ${err.message}`)
          circuitBreaker.recordFailure(providerId)
          idempotencyManager.releaseLock(taskKey)
        }
      }, 1500)
    } catch (err: any) {
      setIsGenerating(false)
      setErrorMsg(err.message || '提交生片请求失败')
      walletManager.refund(taskKey, cost, providerId, `提交异常退款: ${err.message}`)
      circuitBreaker.recordFailure(providerId)
      idempotencyManager.releaseLock(taskKey)
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
              onClick={() => handleSelectProvider('mock')}
            >
              Mock 实验画布 (免费)
            </button>
            <button
              type="button"
              className={`pill-btn ${providerId === 'kling' ? 'active' : ''}`}
              onClick={() => handleSelectProvider('kling')}
            >
              快手可灵 (Kling)
            </button>
            <button
              type="button"
              className={`pill-btn ${providerId === 'jimeng' ? 'active' : ''}`}
              onClick={() => handleSelectProvider('jimeng')}
            >
              字节即梦 (Jimeng)
            </button>
            <button
              type="button"
              className={`pill-btn comfyui-btn ${providerId === 'comfyui' ? 'active' : ''}`}
              onClick={() => handleSelectProvider('comfyui')}
            >
              🔥 ComfyUI 私有算力
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

          {/* 时长：预设快速选择 + 自定义数字输入 (1~60s) */}
          <div className="control-pill-group duration-pill-group">
            <span className="pill-label">时长:</span>
            {[5, 10, 15].map((d) => (
              <button
                key={d}
                type="button"
                className={`pill-btn ${!isCustomDuration && durationSec === d ? 'active' : ''}`}
                onClick={() => {
                  setDurationSec(d)
                  setIsCustomDuration(false)
                }}
              >
                {d} 秒
              </button>
            ))}
            <div className={`custom-duration-box ${isCustomDuration || ![5, 10, 15].includes(durationSec) ? 'active' : ''}`}>
              <span className="custom-prefix">自定义:</span>
              <input
                type="number"
                min={1}
                max={60}
                value={durationSec}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(60, Number(e.target.value) || 1))
                  setDurationSec(val)
                  setIsCustomDuration(true)
                }}
                className="custom-duration-input"
                title="输入自定义生成时长 (1~60秒)"
              />
              <span className="custom-unit">秒</span>
            </div>
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

      {/* ComfyUI 选中后的 Ping 状态条：与 kling/jimeng 的「未配置即报错」行为对齐 */}
      {providerId === 'comfyui' && comfyPing.status !== 'idle' && (
        <div
          className={`comfy-ping-banner ${comfyPing.status === 'ok' ? 'success' : comfyPing.status === 'error' ? 'error' : 'testing'}`}
        >
          {comfyPing.status === 'testing' && '🔄 正在向本地 ComfyUI 发起 /system_stats 握手…'}
          {comfyPing.status === 'ok' && (comfyPing.msg || '✓ 已连接 ComfyUI')}
          {comfyPing.status === 'error' && `⚠️ ${comfyPing.msg || '未检测到本地 ComfyUI 服务'}`}
          {comfyPing.status === 'error' && (
            <button
              type="button"
              className="btn-alert-action"
              style={{ marginLeft: '0.6rem' }}
              onClick={() => void runComfyPing()}
            >
              🔄 重新探测
            </button>
          )}
        </div>
      )}

      {/* 全局醒目错误与 API 配置引导条 */}
      {errorMsg && (
        <div className="studio-error-banner global-studio-alert">
          <div className="alert-content">
            <span className="alert-icon">⚠️</span>
            <span className="alert-text">{errorMsg}</span>
          </div>
          <div className="alert-actions">
            {(errorMsg.includes('Key') || errorMsg.includes('API')) && (
              <button
                type="button"
                className="btn-alert-action"
                onClick={onOpenSettings}
              >
                ⚙️ 前往配置 API Key
              </button>
            )}
            <button
              type="button"
              className="btn-alert-dismiss"
              onClick={() => setErrorMsg(null)}
            >
              ✕ 关闭提示
            </button>
          </div>
        </div>
      )}

      {/* 主工作区 */}
      <div className="studio-layout">
        {/* 左侧：输入与优化区 */}
        <div className="studio-left-pane">
          {/* 1. 预设模版快速填充 (附带真实/Mock 图像预览) */}
          <div className="panel-card">
            <div className="panel-header">
              <span className="panel-title">📚 爆款提示词预设模板</span>
              <span className="panel-hint">点击一键载入行业精调模版与专属首帧 Mock 图</span>
            </div>
            <div className="preset-grid">
              {SINGLE_PROMPT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`preset-chip-card ${referenceImage === p.image ? 'selected-preset' : ''}`}
                  onClick={() => handleSelectPreset(p)}
                >
                  <div className="chip-media-thumb">
                    <img src={p.image} alt={p.title} className="preset-img-cover" />
                    <span className="chip-icon-overlay">{p.icon}</span>
                  </div>
                  <div className="chip-text">
                    <strong>{p.title}</strong>
                    <span>{p.category}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 2. 📸 参考素材与多模态输入 (参考图片/首帧图 + 参考视频/运镜轨迹) */}
          <div className="panel-card reference-media-panel">
            <div className="panel-header">
              <div className="header-title-flex">
                <span className="panel-title">📸 多模态参考素材 (图片 / 视频输入)</span>
                <span className="ai-tag">Img2Video / Motion</span>
              </div>
              <span className="panel-hint">输入首帧参考图或运镜参考视频，AI 将精准锁定商品结构与运镜节奏</span>
            </div>

            <div className="reference-media-grid">
              {/* 2.1 参考图片 / 首帧图 */}
              <div className="ref-column">
                <div className="ref-column-header">
                  <strong>🖼️ 参考图片 / 首帧图 (Image-to-Video)</strong>
                  {referenceImage && (
                    <button
                      type="button"
                      className="btn-clear-ref"
                      onClick={() => setReferenceImage(null)}
                    >
                      ✕ 清除图片
                    </button>
                  )}
                </div>

                {referenceImage ? (
                  <div
                    className="ref-preview-box"
                    onDoubleClick={() => setIsImageLightboxOpen(true)}
                    title="双击全屏放大查看高清首帧"
                  >
                    <img src={referenceImage} alt="参考商品图" className="ref-thumb-img" />
                    <button
                      type="button"
                      className="btn-zoom-corner"
                      onClick={() => setIsImageLightboxOpen(true)}
                      title="点击放大查看"
                    >
                      🔍 双击放大
                    </button>
                    <div className="ref-badge-tag">✓ 已装载首帧图 (生片将基于此图 · 双击放大)</div>
                  </div>
                ) : (
                  <label className="ref-dropzone">
                    <input
                      type="file"
                      accept="image/*"
                      className="ref-file-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          const reader = new FileReader()
                          reader.onload = () => {
                            if (typeof reader.result === 'string') setReferenceImage(reader.result)
                          }
                          reader.readAsDataURL(file)
                        }
                      }}
                    />
                    <span className="dropzone-icon">📤</span>
                    <span className="dropzone-text">点击上传商品图 / 拖拽图片至此</span>
                    <span className="dropzone-sub">支持 PNG, JPG, WebP 格式</span>
                  </label>
                )}

                {/* 快捷选用官方预设 Mock 图 */}
                <div className="ref-quick-gallery">
                  <span className="quick-label">⚡ 快捷选用预设商业 Mock 图:</span>
                  <div className="quick-thumbs-row">
                    {ALL_PRESET_ASSETS.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        className={`quick-thumb-btn ${referenceImage === asset.src ? 'active' : ''}`}
                        title={asset.name}
                        onClick={() => setReferenceImage(asset.src)}
                      >
                        <img src={asset.src} alt={asset.name} />
                        <span className="quick-thumb-name">{asset.name.split(' ')[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2.2 参考视频 / 运镜参考 */}
              <div className="ref-column">
                <div className="ref-column-header">
                  <strong>🎥 参考视频 / 运镜轨迹模仿 (Motion Mimic)</strong>
                  {referenceVideo && (
                    <button
                      type="button"
                      className="btn-clear-ref"
                      onClick={() => {
                        setReferenceVideo(null)
                        setReferenceVideoName('')
                      }}
                    >
                      ✕ 清除视频
                    </button>
                  )}
                </div>

                {referenceVideo ? (
                  <div className="ref-preview-box">
                    <video src={referenceVideo} controls playsInline className="ref-thumb-video" />
                    <div className="ref-badge-tag">
                      ✓ 已载入参考视频 {referenceVideoName ? `(${referenceVideoName})` : ''}
                    </div>
                  </div>
                ) : (
                  <label className="ref-dropzone">
                    <input
                      type="file"
                      accept="video/*"
                      className="ref-file-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          const url = URL.createObjectURL(file)
                          setReferenceVideo(url)
                          setReferenceVideoName(file.name)
                        }
                      }}
                    />
                    <span className="dropzone-icon">🎬</span>
                    <span className="dropzone-text">点击上传参考视频 / 运镜片段</span>
                    <span className="dropzone-sub">支持 MP4, WebM (供提取运镜速度与机位)</span>
                  </label>
                )}

                {/* 在线视频 URL 输入 */}
                <div className="ref-url-input-group">
                  <input
                    type="text"
                    className="text-input text-input-small"
                    placeholder="或输入在线参考视频 URL (https://...)"
                    onBlur={(e) => {
                      if (e.target.value.trim()) {
                        setReferenceVideo(e.target.value.trim())
                        setReferenceVideoName('在线视频')
                      }
                    }}
                  />
                </div>

                {/* 运镜模仿说明 */}
                <div className="motion-note-input-group">
                  <span className="input-hint-label">运镜模仿意图:</span>
                  <input
                    type="text"
                    className="text-input text-input-small"
                    placeholder="例如：参考视频中的下潜推移与微幅倾转节奏..."
                    value={motionPrompt}
                    onChange={(e) => setMotionPrompt(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 3. 🪄 AI 提示词智能完善/扩写工具 */}
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

          {/* 4. 最终提示词编辑与负向提示词 */}
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
                    {referenceImage && <span className="badge-highlight">已载入参考底图</span>}
                    {referenceVideo && <span className="badge-highlight">已载入运镜参考</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 首帧图双击放大模态弹窗 */}
      <ImageLightboxModal
        isOpen={isImageLightboxOpen}
        imageUrl={referenceImage}
        title={rawIdea || prompt.slice(0, 30) || '首帧参考图'}
        onClose={() => setIsImageLightboxOpen(false)}
      />
    </div>
  )
}

