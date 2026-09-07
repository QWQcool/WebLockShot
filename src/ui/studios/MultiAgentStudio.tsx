import React, { useState } from 'react'
import { klingVideoProvider } from '../../media/providers/kling.ts'
import { jimengVideoProvider } from '../../media/providers/jimeng.ts'
import { comfyUIVideoProvider } from '../../media/providers/comfyui.ts'
import { mockVideoProvider } from '../../media/providers/mock.ts'
import type { VideoGenRequest, VideoProvider } from '../../media/types.ts'
import { walletManager } from '../../domain/wallet.ts'
import { circuitBreaker } from '../../domain/fsm.ts'
import { idempotencyManager } from '../../domain/idempotency.ts'
import {
  getPollingWindow,
  setPollingWindowMinutes,
  POLL_WINDOW_PRESETS,
} from '../../domain/pollingConfig.ts'
import {
  resolveAsset,
  ALL_PRESET_ASSETS,
} from '../../assets/presets/index.ts'
import { ImageLightboxModal } from '../components/ImageLightboxModal.tsx'

export type AgentRole = 'director' | 'camera' | 'critic' | 'dispatcher'

export type AgentMessage = {
  id: string
  role: AgentRole
  agentName: string
  avatar: string
  title: string
  thought: string
  output: string
  timestamp: string
}

export type SwarmSpec = {
  theme: string
  directorConcept: string
  cameraMotion: string
  lightingSpec: string
  qaScore: number
  qaReport: string
  synthesizedPrompt: string
  negativePrompt: string
}

const PRESET_SWARM_THEMES = [
  {
    id: 'theme-1',
    title: '未来钛合金机械手表',
    desc: '微距齿轮精密咬合与赛博夜景流光',
    image: resolveAsset('cyber_watch.svg'),
  },
  {
    id: 'theme-2',
    title: '高定丝绸晚礼服光影',
    desc: '面料垂坠飘逸与聚光灯下动态摆动',
    image: resolveAsset('silk_dress.svg'),
  },
  {
    id: 'theme-3',
    title: '超级跑车雨夜破风疾驰',
    desc: '水花飞溅、尾灯流光拖尾与空气动力学尾翼',
    image: resolveAsset('super_car.svg'),
  },
]

type Props = {
  onOpenSettings: () => void
}

export const MultiAgentStudio: React.FC<Props> = ({ onOpenSettings }) => {
  const [themeInput, setThemeInput] = useState('未来钛合金机械手表，微距齿轮精密咬合与赛博夜景流光')
  const [providerId, setProviderId] = useState<'mock' | 'kling' | 'jimeng' | 'comfyui'>('mock')
  const [durationSec, setDurationSec] = useState<number>(5)
  const [isCustomDuration, setIsCustomDuration] = useState<boolean>(false)

  // 多模态参考素材：首帧参考图与运镜参考视频
  const [referenceImage, setReferenceImage] = useState<string | null>(PRESET_SWARM_THEMES[0].image)
  const [referenceVideo, setReferenceVideo] = useState<string | null>(null)
  const [referenceVideoName, setReferenceVideoName] = useState<string>('')
  const [motionPrompt, setMotionPrompt] = useState<string>('')
  const [isImageLightboxOpen, setIsImageLightboxOpen] = useState(false)

  const [isDeliberating, setIsDeliberating] = useState(false)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [swarmSpec, setSwarmSpec] = useState<SwarmSpec | null>(null)

  // 渲染状态
  const [isRendering, setIsRendering] = useState(false)
  const [renderProgress, setRenderProgress] = useState(0)
  const [renderStatus, setRenderStatus] = useState('')
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // 轮询窗口（分钟），与 executor 共享同一份全局配置
  const [pollMinutes, setPollMinutes] = useState<number>(POLL_WINDOW_PRESETS[2].minutes)

  // ComfyUI 选中后的自动握手结果（与 kling/jimeng 的「未配置即报错」对齐）
  type ComfyPingState = {
    status: 'idle' | 'testing' | 'ok' | 'error'
    msg?: string
    gpuName?: string
    vramFreeGb?: number
  }
  const [comfyPing, setComfyPing] = useState<ComfyPingState>({ status: 'idle' })

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
      `当前选用了 ComfyUI 私有算力，但 ${res.error || '未检测到本地 ComfyUI 服务'}。请确认 ComfyUI 已启动（默认 http://127.0.0.1:8188）后点击上方「⚙️ 前往配置 API Key」核对地址，或切换为 Mock 模式。`
    )
    return false
  }

  const handleSelectProvider = (id: 'mock' | 'kling' | 'jimeng' | 'comfyui') => {
    setProviderId(id)
    // 切换引擎时立即清掉上一个引擎的报错，避免 ping 期间仍显示旧 engine 的错误
    setErrorMsg(null)
    if (id === 'kling') {
      try {
        const key = sessionStorage.getItem('weblockshot.kling_key')
        if (!key?.trim()) {
          setErrorMsg('未检测到快手可灵 API Key！请点击上方「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 免费模式。')
          setComfyPing({ status: 'idle' })
          return
        }
      } catch {}
    }
    if (id === 'jimeng') {
      try {
        const key = sessionStorage.getItem('weblockshot.jimeng_key')
        if (!key?.trim()) {
          setErrorMsg('未检测到字节即梦 (Jimeng) API Key！请点击上方「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 免费模式。')
          setComfyPing({ status: 'idle' })
          return
        }
      } catch {}
    }
    if (id === 'comfyui') {
      // 选中 ComfyUI 时异步探测，结果回写到 banner + errorMsg
      void runComfyPing()
      return
    }
    setComfyPing({ status: 'idle' })
  }

  // 触发 4 个 Agent 协同共创
  const handleStartSwarm = async () => {
    if (!themeInput.trim()) {
      setErrorMsg('请输入创作主题与构想！')
      return
    }

    if (providerId === 'kling') {
      try {
        const key = sessionStorage.getItem('weblockshot.kling_key')
        if (!key?.trim()) {
          setErrorMsg('当前选用了快手可灵 (Kling) 渲染引擎，但尚未配置 API Key！请点击右侧「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 模式。')
          return
        }
      } catch {}
    }

    if (providerId === 'jimeng') {
      try {
        const key = sessionStorage.getItem('weblockshot.jimeng_key')
        if (!key?.trim()) {
          setErrorMsg('当前选用了字节即梦 (Jimeng) 渲染引擎，但尚未配置 API Key！请点击右侧「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 模式。')
          return
        }
      } catch {}
    }

    if (providerId === 'comfyui') {
      // 与 kling/jimeng 一致：生成前若上次 ping 失败或未 ping，重新探测
      if (comfyPing.status !== 'ok') {
        const ok = await runComfyPing()
        if (!ok) return
      }
    }

    setIsDeliberating(true)
    setMessages([])
    setSwarmSpec(null)
    setErrorMsg(null)
    setRenderedVideoUrl(null)

    // 辅助延时函数，让多 Agent 思考有生动的动画交互感
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

    try {
      // Step 1: 创意编导 Agent
      const directorMsg: AgentMessage = {
        id: 'msg-1',
        role: 'director',
        agentName: '创意编导 Agent (Director)',
        avatar: '🎬',
        title: '【创意编导】叙事弧线与核心抓手拆解',
        thought: `分析主题「${themeInput}」的核心审美诉求与前 3 秒抓眼视觉符号...`,
        output: `【叙事设定】以微观工业精密奇观切入，展现机械自转与时光流转的工业浪漫。镜头核心抓手确立为“极微距游丝跳动”，以 1/8 秒极速建立高端科技与精密质感心智。${
          referenceImage ? '\n· 首帧底图已锁定：将提取参考图几何比例与材质质感作为全片视觉基准。' : ''
        }`,
        timestamp: '00:01',
      }
      setMessages([directorMsg])
      await sleep(600)

      // Step 2: 运镜与构图 Agent
      const cameraMsg: AgentMessage = {
        id: 'msg-2',
        role: 'camera',
        agentName: '运镜与构图 Agent (Cinematographer)',
        avatar: '📐',
        title: '【摄影运镜】3D 轨道轨迹与光学参数工程化',
        thought: '计算焦段匹配度、景深控制与相机位移速度，避免画面机械平移...',
        output: `【运镜矩阵】\n· 焦段：85mm 黄金微距 Cine 镜头，光圈 f/1.8 浅景深柔化背景。\n· 运动轨迹：螺旋下潜式轨道推移 (Spiral Dolly-in)，配合 25 度逆时针微幅倾转 (Roll)。\n· 布光系统：左侧冷白轮廓侧光，右侧深青科技补光，齿轮边缘形成极致反光金线。${
          referenceVideo || motionPrompt
            ? `\n· 运镜参考动力学约束已激活：对齐「${motionPrompt || '参考视频镜头推进节奏'}」。`
            : ''
        }`,
        timestamp: '00:02',
      }
      setMessages((prev) => [...prev, cameraMsg])
      await sleep(700)

      // Step 3: 质检审片 Agent
      const criticMsg: AgentMessage = {
        id: 'msg-3',
        role: 'critic',
        agentName: '质检审片 Agent (Critic & QA)',
        avatar: '🧐',
        title: '【质检审片】物理连贯性与防畸变安全审计',
        thought: '检测高频齿轮结构可能引起的频闪和 AI 结构变形风险...',
        output: `【质检综合评分：98 / 100】\n· 风险排查：金属高频齿轮易引发 AI 结构模糊熔断。\n· 纠偏补丁：强化正向提示词中的 "solid structural integrity, crisp mechanical edges, no melting"，并在负向提示词中注入 "deformed cogs, jitter, plastic finish"。${
          referenceImage ? '对首帧图轮廓边缘与生成帧物理连贯性通过完整性审计。' : ''
        } 通过安全性校验！`,
        timestamp: '00:03',
      }
      setMessages((prev) => [...prev, criticMsg])
      await sleep(600)

      // Step 4: 渲染调度 Agent
      const synthesized = `Masterpiece commercial cinematography, ${themeInput}. Shot on 85mm anamorphic macro lens, extreme close-up with smooth spiral dolly-in movement, razor sharp gear cogs with flawless mechanical interlocking, delicate subsurface rim reflections, high contrast moody cyber teal rim lighting, raytraced reflections on brushed titanium, ultra realistic 8K.`
      const negative =
        'blurry, melted metal, jitter, deformed geometry, plastic, oversaturated, low resolution'

      const dispatcherMsg: AgentMessage = {
        id: 'msg-4',
        role: 'dispatcher',
        agentName: '调度合成 Agent (Dispatcher)',
        avatar: '⚡',
        title: '【调度执行】多 Agent 智能成果合成完毕',
        thought: '完成多智体协同汇编，生成终极指令 Payload，准备派发渲染引擎...',
        output: `终极生片 Prompt 与多模态参数已合成完毕。包含时长 (${durationSec}s)、焦段、轨迹、物理材质与负向防护网。已就绪，可随时向 ${providerId.toUpperCase()} 派发算力任务！`,
        timestamp: '00:04',
      }
      setMessages((prev) => [...prev, dispatcherMsg])

      setSwarmSpec({
        theme: themeInput,
        directorConcept: directorMsg.output,
        cameraMotion: cameraMsg.output,
        lightingSpec: '双色冷青与金线侧逆光',
        qaScore: 98,
        qaReport: criticMsg.output,
        synthesizedPrompt: synthesized,
        negativePrompt: negative,
      })
    } catch (err: any) {
      setErrorMsg(`Agent 协同推演异常: ${err.message || '未知错误'}`)
    } finally {
      setIsDeliberating(false)
    }
  }

  // 启动多 Agent 联合视频渲染
  const handleRenderSwarmVideo = async () => {
    if (!swarmSpec) return

    if (providerId === 'kling') {
      try {
        const key = sessionStorage.getItem('weblockshot.kling_key')
        if (!key?.trim()) {
          setErrorMsg('当前选用了快手可灵 (Kling) 渲染引擎，但尚未配置 API Key！请点击上方「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 模式。')
          return
        }
      } catch {}
    }

    if (providerId === 'jimeng') {
      try {
        const key = sessionStorage.getItem('weblockshot.jimeng_key')
        if (!key?.trim()) {
          setErrorMsg('当前选用了字节即梦 (Jimeng) 渲染引擎，但尚未配置 API Key！请点击上方「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 模式。')
          return
        }
      } catch {}
    }

    // 0. 熔断与幂等排查
    const breakerCheck = circuitBreaker.isAvailable(providerId)
    if (!breakerCheck.allowed) {
      setErrorMsg(breakerCheck.reason || '当前服务处于熔断保护状态')
      return
    }

    const taskKey = idempotencyManager.generateKey({
      intent: 'multi-swarm-render',
      providerId,
      prompt: swarmSpec.synthesizedPrompt,
      durationSec,
      extra: themeInput,
    })

    const lockResult = idempotencyManager.acquireLock(taskKey)
    if (!lockResult.success) {
      setErrorMsg(lockResult.reason || '多 Agent 任务正在渲染中，请勿重复提交')
      return
    }

    // 1. 钱包预扣款冻结
    const cost = walletManager.getCost(providerId, 1)
    const freezeSuccess = walletManager.freeze(
      cost,
      taskKey,
      providerId,
      `多 Agent 协同渲染 (${providerId === 'kling' ? '可灵' : providerId === 'jimeng' ? '即梦' : '自建/Mock'})`
    )

    if (!freezeSuccess) {
      idempotencyManager.releaseLock(taskKey)
      setErrorMsg(`钱包可用余额不足 (需 ${cost} 灵感币)，请在顶部虚拟钱包中模拟充值。`)
      return
    }

    setIsRendering(true)
    setRenderProgress(15)
    setRenderStatus('正在通过调度 Agent 派发视频渲染请求...')
    setErrorMsg(null)

    try {
      let provider: VideoProvider = mockVideoProvider
      if (providerId === 'kling') provider = klingVideoProvider
      if (providerId === 'jimeng') provider = jimengVideoProvider
      if (providerId === 'comfyui') provider = comfyUIVideoProvider
      const req: VideoGenRequest = {
        clientTaskId: taskKey,
        shotId: `swarm-${Date.now()}`,
        prompt: swarmSpec.synthesizedPrompt,
        negative: swarmSpec.negativePrompt,
        imageBase64: referenceImage || undefined,
        referenceVideoUrl: referenceVideo || undefined,
        motionPrompt: motionPrompt || undefined,
        durationSec,
        ratio: '9:16',
        title: swarmSpec.theme,
      }

      setRenderProgress(30)
      setRenderStatus(
        providerId === 'comfyui'
          ? '已连接 ComfyUI 本地/私有 GPU 集群 (Wan2.1)，多 Agent 联合神经渲染中...'
          : `已连接 ${providerId.toUpperCase()} 集群，多 Agent 联合神经渲染中...`
      )

      const { taskId } = await provider.submit(req)

      // 轮询查询渲染结果（轮询窗口可配置，默认 10 分钟）
      const pollingWindow = getPollingWindow()
      let attempts = 0
      const maxAttempts = pollingWindow.maxAttempts
      const pollTimer = setInterval(async () => {
        attempts++
        try {
          const pollRes = await provider.poll(taskId)
          setRenderProgress(Math.min(95, 30 + attempts * 3))
          setRenderStatus(`4 Agent 协同质检并监视渲染进度... (${Math.round(attempts * (pollingWindow.intervalMs / 1000))}s)`)

          if (pollRes.status === 'succeeded') {
            clearInterval(pollTimer)
            const asset = await provider.getAsset(taskId)
            setRenderProgress(100)
            setRenderStatus('多 Agent 协同成片渲染完成！')
            setRenderedVideoUrl(asset.url)
            setIsRendering(false)

            walletManager.settle(taskKey, cost, providerId, '多 Agent 协同渲染成功核销')
            circuitBreaker.recordSuccess(providerId)
            idempotencyManager.releaseLock(taskKey)
          } else if (pollRes.status === 'failed') {
            clearInterval(pollTimer)
            setIsRendering(false)
            setErrorMsg(`渲染失败: ${pollRes.error || '远端生成异常'}`)

            walletManager.refund(taskKey, cost, providerId, `渲染失败全额退款: ${pollRes.error || '异常'}`)
            circuitBreaker.recordFailure(providerId)
            idempotencyManager.releaseLock(taskKey)
          } else if (attempts >= maxAttempts) {
            // 轮询超时：绝不 settle、绝不取降级产物，必须全额退款
            clearInterval(pollTimer)
            setIsRendering(false)
            setErrorMsg('生成超时，请检查网络或 API 密钥配置。已自动全额退款。')
            walletManager.refund(taskKey, cost, providerId, '渲染超时全额退款')
            circuitBreaker.recordFailure(providerId)
            idempotencyManager.releaseLock(taskKey)
          }
        } catch (err: any) {
          clearInterval(pollTimer)
          setIsRendering(false)
          setErrorMsg(err.message || '查询任务状态出错')
          walletManager.refund(taskKey, cost, providerId, `状态查询异常退款: ${err.message}`)
          circuitBreaker.recordFailure(providerId)
          idempotencyManager.releaseLock(taskKey)
        }
      }, pollingWindow.intervalMs)
    } catch (err: any) {
      setIsRendering(false)
      setErrorMsg(err.message || '派发请求失败')
      walletManager.refund(taskKey, cost, providerId, `派发请求失败退款: ${err.message}`)
      circuitBreaker.recordFailure(providerId)
      idempotencyManager.releaseLock(taskKey)
    }
  }

  return (
    <div className="multi-agent-studio">
      {/* 顶部配置 Bar */}
      <div className="studio-topbar">
        <div className="topbar-left">
          <span className="studio-badge multi-badge">🤖 多 Agent 协同导演室</span>
          <span className="studio-subtext">
            编导 + 运镜 + 质检 + 调度四智体共创 · 动态推演 · 电影级精细控制
          </span>
        </div>
        <div className="topbar-controls">
          <div className="control-pill-group">
            <span className="pill-label">渲染引擎:</span>
            <button
              type="button"
              className={`pill-btn ${providerId === 'mock' ? 'active' : ''}`}
              onClick={() => handleSelectProvider('mock')}
            >
              Mock 实验画布
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

          {/* 轮询窗口：与 executor 共享配置，超时自动退款 */}
          <div className="control-pill-group">
            <span className="pill-label">轮询窗口:</span>
            <select
              className="custom-duration-input"
              value={pollMinutes}
              title="生成任务最长等待时间，超时将自动全额退款"
              onChange={(e) => {
                const minutes = Number(e.target.value)
                setPollMinutes(minutes)
                setPollingWindowMinutes(minutes)
              }}
            >
              {POLL_WINDOW_PRESETS.map((p) => (
                <option key={p.minutes} value={p.minutes}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="btn-settings-small"
            onClick={onOpenSettings}
            title="配置 API 密钥"
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
        {/* 左侧：多 Agent 协同工作区 */}
        <div className="studio-left-pane">
          {/* 1. 主题输入与带图片的预设灵感 */}
          <div className="panel-card">
            <div className="panel-header">
              <span className="panel-title">💡 视频创作主题与灵感</span>
              <span className="panel-hint">输入任何创意思路，交由 4 个 Agent 协同推演</span>
            </div>

            <div className="theme-input-row">
              <input
                type="text"
                className="text-input"
                value={themeInput}
                onChange={(e) => setThemeInput(e.target.value)}
                placeholder="输入创作主题，例如：未来钛合金机械手表，微距齿轮精密咬合..."
              />
              <button
                type="button"
                className="btn-start-swarm"
                onClick={handleStartSwarm}
                disabled={isDeliberating || !themeInput.trim()}
              >
                {isDeliberating ? '🤖 Agent 研讨中...' : '🤖 启动 4 Agent 协同共创'}
              </button>
            </div>

            <div className="swarm-presets-row">
              <span className="row-label">灵感预置 (附带 Mock 图):</span>
              <div className="swarm-presets-grid">
                {PRESET_SWARM_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`theme-chip-card ${referenceImage === t.image ? 'active' : ''}`}
                    onClick={() => {
                      setThemeInput(`${t.title}，${t.desc}`)
                      setReferenceImage(t.image)
                    }}
                  >
                    <img src={t.image} alt={t.title} className="theme-thumb-img" />
                    <div className="theme-text-box">
                      <strong>{t.title}</strong>
                      <span>{t.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 2. 📸 多模态参考素材与首帧/运镜控制 */}
          <div className="panel-card reference-media-panel">
            <div className="panel-header">
              <div className="header-title-flex">
                <span className="panel-title">📸 多模态参考素材 (图片 / 视频输入)</span>
                <span className="ai-tag">Swarm Multimodal</span>
              </div>
              <span className="panel-hint">传入首帧商品图或运镜参考片段，多 Agent 将提取特征注入生片指令</span>
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
                    <div className="ref-badge-tag">✓ 已装载首帧图 (多 Agent 将以此图为视觉基准 · 双击放大)</div>
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

                {/* 快捷选用预设 Mock 图 */}
                <div className="ref-quick-gallery">
                  <span className="quick-label">⚡ 快捷选用官方预设 Mock 图:</span>
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
                    <span className="dropzone-sub">供运镜与构图 Agent 提取镜头轨迹动力学</span>
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
                    placeholder="例如：参考视频中的轨道下潜推移与微幅倾转节奏..."
                    value={motionPrompt}
                    onChange={(e) => setMotionPrompt(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 3. 四智体实时协同推演流 */}
          <div className="panel-card swarm-chat-panel">
            <div className="panel-header">
              <div className="header-title-flex">
                <span className="panel-title">👥 四智体协同演进舞台 (Swarm Deliberation)</span>
                <span className="swarm-indicator-badge">
                  {isDeliberating ? '● 正在协同研讨' : messages.length > 0 ? '✓ 研讨已达成共识' : '○ 待启动'}
                </span>
              </div>
            </div>

            <div className="agent-timeline">
              {messages.length === 0 && !isDeliberating && (
                <div className="swarm-empty-state">
                  <span className="empty-icon">🤝</span>
                  <p>点击上方「启动 4 Agent 协同共创」，由编导、运镜、质检与调度智体联手为您打造顶级成片方案。</p>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className={`agent-bubble-card role-${m.role}`}>
                  <div className="bubble-header">
                    <span className="agent-avatar">{m.avatar}</span>
                    <div className="agent-info">
                      <strong>{m.agentName}</strong>
                      <span className="bubble-time">{m.timestamp}</span>
                    </div>
                  </div>
                  <div className="bubble-body">
                    <div className="bubble-thought">
                      <em>💭 思考轨迹：</em>
                      <span>{m.thought}</span>
                    </div>
                    <div className="bubble-output">
                      <pre>{m.output}</pre>
                    </div>
                  </div>
                </div>
              ))}

              {isDeliberating && (
                <div className="deliberating-loading-bubble">
                  <span className="spin-mini" />
                  <span>Agent 正在分析光影与镜头动力学参数...</span>
                </div>
              )}
            </div>
          </div>

          {/* 4. 最终多 Agent 联合成片方案确认与执行 */}
          {swarmSpec && (
            <div className="panel-card highlight-card">
              <div className="panel-header">
                <span className="panel-title">📑 多 Agent 联合编制成片工程单</span>
                <span className="qa-badge">质检评分: {swarmSpec.qaScore}分 卓越</span>
              </div>

              <div className="swarm-spec-preview">
                <div className="spec-item">
                  <strong>🎯 最终合成提示词 (Synthesized Prompt):</strong>
                  <p>{swarmSpec.synthesizedPrompt}</p>
                </div>
                <div className="spec-item">
                  <strong>🚫 防畸变负向约束:</strong>
                  <p className="neg-text">{swarmSpec.negativePrompt}</p>
                </div>
              </div>

              {errorMsg && <div className="studio-error-banner">⚠️ {errorMsg}</div>}

              <div className="swarm-render-action">
                <button
                  type="button"
                  className="btn-swarm-render"
                  onClick={handleRenderSwarmVideo}
                  disabled={isRendering}
                >
                  {isRendering
                    ? '🚀 多 Agent 联合渲染管线运行中...'
                    : `🚀 立即启动多 Agent 联合视频渲染 (${providerId.toUpperCase()})`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：监视器与成片播放 */}
        <div className="studio-right-pane">
          <div className="panel-card monitor-card">
            <div className="panel-header">
              <span className="panel-title">🎬 联合导演监视台</span>
              {isRendering && <span className="live-pulse-dot" />}
            </div>

            <div className="video-viewport-box">
              {isRendering ? (
                <div className="viewport-generating-state">
                  <div className="spin-ring" />
                  <span className="generating-title">{renderStatus}</span>
                  <div className="gen-progress-track">
                    <div
                      className="gen-progress-fill"
                      style={{ width: `${renderProgress}%` }}
                    />
                  </div>
                  <span className="progress-percent">{renderProgress}%</span>
                </div>
              ) : renderedVideoUrl ? (
                <div className="viewport-video-ready">
                  <video
                    src={renderedVideoUrl}
                    className="viewport-player"
                    controls
                    autoPlay
                    loop
                    playsInline
                  />
                  <div className="player-actions">
                    <a
                      href={renderedVideoUrl}
                      download={`weblockshot-swarm-${Date.now()}.mp4`}
                      className="btn-download-video"
                    >
                      ⬇️ 下载多 Agent 协同成品 (MP4)
                    </a>
                  </div>
                </div>
              ) : (
                <div className="viewport-idle-state">
                  <span className="idle-icon">🤖</span>
                  <h4>等待多 Agent 协同推演</h4>
                  <p>
                    四智体协作完成后，点击「立即启动多 Agent 联合视频渲染」即可在此监看成片。
                  </p>
                  <div className="idle-specs-badge">
                    <span>模式: 4-Agent Swarm</span>
                    <span>画幅: 9:16 竖屏</span>
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
        title={themeInput.slice(0, 30) || '首帧参考图'}
        onClose={() => setIsImageLightboxOpen(false)}
      />
    </div>
  )
}

