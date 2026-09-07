import React, { useState, useEffect } from 'react'
import { z } from 'zod'
import { comfyUIVideoProvider } from '../../media/providers/comfyui.ts'
import { useVideoPipeline } from '../../hooks/useVideoPipeline.ts'
import { useRevocableObjectUrl } from '../../hooks/useRevocableObjectUrl.ts'
import { chatCompletionsText } from '../../ai/client.ts'
import { TOKEN_STORAGE_KEY, type TokenConfig } from '../../types.ts'
import {
  setPollingWindowMinutes,
  POLL_WINDOW_PRESETS,
} from '../../domain/pollingConfig.ts'
import {
  resolveAsset,
  ALL_PRESET_ASSETS,
} from '../../assets/presets/index.ts'
import { ImageLightboxModal } from '../components/ImageLightboxModal.tsx'
import { EngineStatusBadge } from '../components/EngineStatusBadge.tsx'

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
  /** 真实 LLM 质检评分；演示模式下为 null（不再伪造恒定 98 分） */
  qaScore: number | null
  qaReport: string
  synthesizedPrompt: string
  negativePrompt: string
  /** 是否为无 Key 演示动画模式 */
  isDemo: boolean
}

/**
 * LLM 多 Agent 协商输出 Schema：废除裸 JSON 断言，
 * 结构不合法时自动降级为演示模式，绝不伪造真实评分。
 */
export const SwarmSpecSchema = z.object({
  directorConcept: z.string().min(1),
  cameraMotion: z.string().min(1),
  lightingSpec: z.string().min(1),
  qaScore: z.number().min(0).max(100),
  qaReport: z.string().min(1),
  synthesizedPrompt: z.string().min(1),
  negativePrompt: z.string().min(1),
})

export type LLMSwarmRaw = z.infer<typeof SwarmSpecSchema>

export function parseLLMSwarmOutput(raw: string): LLMSwarmRaw | null {
  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()
    const result = SwarmSpecSchema.safeParse(JSON.parse(cleaned))
    if (result.success) return result.data
    console.warn('[MultiAgent] LLM 协商输出未通过 zod 校验:', result.error.issues.slice(0, 5))
    return null
  } catch (err) {
    console.warn('[MultiAgent] LLM 输出不是合法 JSON:', err)
    return null
  }
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

  // 渲染状态：收敛到共享管线 hook（钱包/轮询/熔断/幂等只此一份实现）
  const { state: pipeline, run: runPipeline } = useVideoPipeline()
  const isRendering = pipeline.running
  const renderProgress = pipeline.progress
  const renderStatus = pipeline.statusText
  const renderedVideoUrl = pipeline.videoUrl

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  useEffect(() => {
    if (pipeline.error) setErrorMsg(pipeline.error)
  }, [pipeline.error])

  // 轮询窗口（分钟），与 executor 共享同一份全局配置
  const [pollMinutes, setPollMinutes] = useState<number>(POLL_WINDOW_PRESETS[2].minutes)

  // 参考视频 objectURL 统一登记与回收，防内存泄漏
  const { revoke: revokeRefVideo, replace: replaceRefVideo } = useRevocableObjectUrl()

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

    try {
      // 读取 LLM 配置：有 Key 走真实结构化推演，无 Key 明示「演示动画模式」
      let token: TokenConfig | null = null
      try {
        const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
        if (raw) token = JSON.parse(raw) as TokenConfig
      } catch {}

      const hasKey = Boolean(token?.apiKey?.trim())

      if (hasKey && token) {
        // ============ 真实 4 Agent 结构化推演 ============
        setMessages([
          {
            id: 'msg-0',
            role: 'director',
            agentName: '多 Agent 协同推演 (真实 LLM)',
            avatar: '🤖',
            title: '【推演模式】已接入真实大模型，四智体结构化协商中',
            thought: '编导 → 运镜 → 质检 → 调度四阶段真实推理...',
            output: `推演主题：${themeInput}`,
            timestamp: '00:00',
          },
        ])

        const systemPrompt = `你是电商带货视频的多 Agent 编导系统，需要依次以四个角色（编导/运镜/质检/调度）对主题进行结构化推演，最终只输出一个严格 JSON 对象（不加 Markdown 围栏）：
{
  "directorConcept": "【创意编导视角】叙事弧线、核心抓手与情绪曲线，120字以内",
  "cameraMotion": "【运镜构图视角】焦段、运动轨迹、景深与运镜速度，120字以内",
  "lightingSpec": "【光影氛围】布光方案与材质表现，60字以内",
  "qaScore": 0到100的整数质检评分（必须依据推演质量给出差异化的真实评分）,
  "qaReport": "【质检审片视角】风险排查与纠偏补丁，说明扣分点，100字以内",
  "synthesizedPrompt": "融合四智体成果的最终英文视频生成提示词（8K 商业级）",
  "negativePrompt": "防畸变负向提示词"
}`
        const userMsg = `主题：${themeInput}\n时长：${durationSec}秒\n${
          referenceImage ? '参考：已载入首帧底图\n' : ''
        }${motionPrompt ? `运镜意图：${motionPrompt}\n` : ''}`

        const raw = await chatCompletionsText(token, [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ])

        const parsed = parseLLMSwarmOutput(raw)
        if (!parsed) {
          setErrorMsg('LLM 协商输出结构校验未通过，已降级为演示动画模式。')
          // 校验失败：降级演示
          runDemoDeliberation()
          return
        }

        const ts = (n: number) => `00:0${n}`
        setMessages((prev) => [
          ...prev,
          {
            id: 'msg-1',
            role: 'director',
            agentName: '创意编导 Agent (Director)',
            avatar: '🎬',
            title: '【创意编导】叙事弧线与核心抓手拆解',
            thought: `真实 LLM 推演主题「${themeInput}」...`,
            output: parsed.directorConcept,
            timestamp: ts(1),
          },
          {
            id: 'msg-2',
            role: 'camera',
            agentName: '运镜与构图 Agent (Cinematographer)',
            avatar: '📐',
            title: '【摄影运镜】3D 轨道轨迹与光学参数工程化',
            thought: '真实 LLM 计算焦段/景深/运动参数...',
            output: parsed.cameraMotion,
            timestamp: ts(2),
          },
          {
            id: 'msg-3',
            role: 'critic',
            agentName: '质检审片 Agent (Critic & QA)',
            avatar: '🧐',
            title: '【质检审片】物理连贯性与防畸变安全审计',
            thought: '真实 LLM 审计生成风险...',
            output: `【真实质检评分：${parsed.qaScore} / 100】\n${parsed.qaReport}`,
            timestamp: ts(3),
          },
          {
            id: 'msg-4',
            role: 'dispatcher',
            agentName: '调度合成 Agent (Dispatcher)',
            avatar: '⚡',
            title: '【调度执行】多 Agent 智能成果合成完毕',
            thought: '真实 LLM 合成终极指令 Payload...',
            output: `光影方案：${parsed.lightingSpec}\n终极生片 Prompt 已合成（${durationSec}s），可向 ${providerId.toUpperCase()} 派发。`,
            timestamp: ts(4),
          },
        ])

        setSwarmSpec({
          theme: themeInput,
          directorConcept: parsed.directorConcept,
          cameraMotion: parsed.cameraMotion,
          lightingSpec: parsed.lightingSpec,
          qaScore: parsed.qaScore,
          qaReport: parsed.qaReport,
          synthesizedPrompt: parsed.synthesizedPrompt,
          negativePrompt: parsed.negativePrompt,
          isDemo: false,
        })
        return
      }

      // ============ 演示动画模式（无 Key，诚实标注） ============
      setMessages([
        {
          id: 'msg-demo-0',
          role: 'dispatcher',
          agentName: '演示动画模式',
          avatar: '🧪',
          title: '【诚实提示】未配置 LLM API Key，以下为预编排演示推演',
          thought: '当前四智体对话为固定脚本动画，评分非真实质检结果。',
          output: '配置「⚙️ API 设置」中的大模型 Key 后，此处将进行真实 LLM 结构化推演并给出真实质检评分。',
          timestamp: '00:00',
        },
      ])
      runDemoDeliberation()
    } catch (err) {
      setErrorMsg(
        `Agent 协同推演异常: ${err instanceof Error ? err.message : '未知错误'}（已降级为演示动画模式）`
      )
      runDemoDeliberation()
    } finally {
      setIsDeliberating(false)
    }
  }

  /** 预编排演示推演（无 Key 时的诚实降级：qaScore=null，UI 明示非真实评分） */
  const runDemoDeliberation = () => {
    // 辅助延时函数，让多 Agent 思考有生动的动画交互感
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

    void (async () => {
      try {
        setIsDeliberating(true)
        const directorMsg: AgentMessage = {
          id: 'msg-1',
          role: 'director',
          agentName: '创意编导 Agent (Director)',
          avatar: '🎬',
          title: '【创意编导 · 演示】叙事弧线与核心抓手拆解（预编排脚本）',
          thought: `分析主题「${themeInput}」的核心审美诉求与前 3 秒抓眼视觉符号...`,
          output: `【叙事设定 · 演示脚本】以产品核心卖点切入，构建「痛点—救星—实证—行动」的叙事弧线。${
            referenceImage ? '\n· 首帧底图已锁定：将提取参考图几何比例与材质质感作为全片视觉基准。' : ''
          }`,
          timestamp: '00:01',
        }
        setMessages((prev) => [...prev, directorMsg])
        await sleep(600)

        const cameraMsg: AgentMessage = {
          id: 'msg-2',
          role: 'camera',
          agentName: '运镜与构图 Agent (Cinematographer)',
          avatar: '📐',
          title: '【摄影运镜 · 演示】3D 轨道轨迹与光学参数工程化（预编排脚本）',
          thought: '计算焦段匹配度、景深控制与相机位移速度...',
          output: `【运镜矩阵 · 演示脚本】\n· 焦段：85mm 微距 Cine 镜头，光圈 f/1.8 浅景深。\n· 运动轨迹：螺旋下潜式轨道推移 (Spiral Dolly-in)。\n· 布光系统：轮廓侧光 + 补光勾勒产品高光。${
            referenceVideo || motionPrompt
              ? `\n· 运镜参考动力学约束已激活：对齐「${motionPrompt || '参考视频镜头推进节奏'}」。`
              : ''
          }`,
          timestamp: '00:02',
        }
        setMessages((prev) => [...prev, cameraMsg])
        await sleep(700)

        const criticMsg: AgentMessage = {
          id: 'msg-3',
          role: 'critic',
          agentName: '质检审片 Agent (Critic & QA)',
          avatar: '🧐',
          title: '【质检审片 · 演示】物理连贯性与防畸变安全审计（预编排脚本）',
          thought: '检测生成风险...',
          output: '【演示脚本】评分需接入真实 LLM 后才能给出。建议：强化提示词中的结构稳定性约束，并在负向提示词注入 "deformed, jitter, plastic finish"。',
          timestamp: '00:03',
        }
        setMessages((prev) => [...prev, criticMsg])
        await sleep(600)

        const synthesized = `Masterpiece commercial cinematography, ${themeInput}. Shot on 85mm anamorphic macro lens, extreme close-up with smooth spiral dolly-in movement, delicate subsurface rim reflections, high contrast moody rim lighting, ultra realistic 8K.`
        const negative =
          'blurry, melted metal, jitter, deformed geometry, plastic, oversaturated, low resolution'

        const dispatcherMsg: AgentMessage = {
          id: 'msg-4',
          role: 'dispatcher',
          agentName: '调度合成 Agent (Dispatcher)',
          avatar: '⚡',
          title: '【调度执行 · 演示】多 Agent 智能成果合成完毕（预编排脚本）',
          thought: '完成协同汇编，生成指令 Payload...',
          output: `【演示脚本】终极生片 Prompt 已合成（${durationSec}s）。可向 ${providerId.toUpperCase()} 派发算力任务！`,
          timestamp: '00:04',
        }
        setMessages((prev) => [...prev, dispatcherMsg])

        setSwarmSpec({
          theme: themeInput,
          directorConcept: directorMsg.output,
          cameraMotion: cameraMsg.output,
          lightingSpec: '演示脚本：轮廓侧光 + 补光',
          qaScore: null, // 演示模式不伪造评分
          qaReport: criticMsg.output,
          synthesizedPrompt: synthesized,
          negativePrompt: negative,
          isDemo: true,
        })
      } finally {
        setIsDeliberating(false)
      }
    })()
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

    // 熔断 / 幂等 / 钱包两阶段 / 轮询 / 结算退款全部收敛于共享管线 hook
    await runPipeline({
      providerId,
      intent: 'multi-swarm-render',
      prompt: swarmSpec.synthesizedPrompt,
      negative: swarmSpec.negativePrompt,
      imageBase64: referenceImage || undefined,
      referenceVideoUrl: referenceVideo || undefined,
      motionPrompt: motionPrompt || undefined,
      durationSec,
      title: swarmSpec.theme,
      billingLabel: `多 Agent 协同渲染 (${providerId === 'kling' ? '可灵' : providerId === 'jimeng' ? '即梦' : providerId === 'comfyui' ? 'ComfyUI' : 'Mock'})`,
    })
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
          <EngineStatusBadge providerId={providerId} />
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
                        revokeRefVideo(referenceVideo)
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
                          const url = replaceRefVideo(referenceVideo, () => URL.createObjectURL(file))
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
                {swarmSpec.isDemo ? (
                  <span className="qa-badge demo-badge" title="未接入真实 LLM，此推演为预编排演示脚本">
                    🧪 演示动画模式 · 评分非真实
                  </span>
                ) : (
                  <span className="qa-badge" title="真实 LLM 质检评分">
                    真实质检评分: {swarmSpec.qaScore ?? '-'} / 100
                  </span>
                )}
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

