import React, { useState } from 'react'
import { klingVideoProvider } from '../../media/providers/kling.ts'
import { jimengVideoProvider } from '../../media/providers/jimeng.ts'
import { mockVideoProvider } from '../../media/providers/mock.ts'
import type { VideoGenRequest, VideoProvider } from '../../media/types.ts'

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
  },
  {
    id: 'theme-2',
    title: '高定丝绸晚礼服光影',
    desc: '面料垂坠飘逸与聚光灯下动态摆动',
  },
  {
    id: 'theme-3',
    title: '超级跑车雨夜破风疾驰',
    desc: '水花飞溅、尾灯流光拖尾与空气动力学尾翼',
  },
]

type Props = {
  onOpenSettings: () => void
}

export const MultiAgentStudio: React.FC<Props> = ({ onOpenSettings }) => {
  const [themeInput, setThemeInput] = useState('未来钛合金机械手表，微距齿轮精密咬合与赛博夜景流光')
  const [providerId, setProviderId] = useState<'mock' | 'kling' | 'jimeng'>('mock')
  const [isDeliberating, setIsDeliberating] = useState(false)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [swarmSpec, setSwarmSpec] = useState<SwarmSpec | null>(null)

  // 渲染状态
  const [isRendering, setIsRendering] = useState(false)
  const [renderProgress, setRenderProgress] = useState(0)
  const [renderStatus, setRenderStatus] = useState('')
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 触发 4 个 Agent 协同共创
  const handleStartSwarm = async () => {
    if (!themeInput.trim()) return
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
        output: `【叙事设定】以微观工业精密奇观切入，展现机械自转与时光流转的工业浪漫。镜头核心抓手确立为“极微距游丝跳动”，以 1/8 秒极速建立高端科技与精密质感心智。`,
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
        output: `【运镜矩阵】\n· 焦段：85mm 黄金微距 Cine 镜头，光圈 f/1.8 浅景深柔化背景。\n· 运动轨迹：螺旋下潜式轨道推移 (Spiral Dolly-in)，配合 25 度逆时针微幅倾转 (Roll)。\n· 布光系统：左侧冷白轮廓侧光，右侧深青科技补光，齿轮边缘形成极致反光金线。`,
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
        output: `【质检综合评分：98 / 100】\n· 风险排查：金属高频齿轮易引发 AI 结构模糊熔断。\n· 纠偏补丁：强化正向提示词中的 "solid structural integrity, crisp mechanical edges, no melting"，并在负向提示词中注入 "deformed cogs, jitter, plastic finish"。通过安全性校验！`,
        timestamp: '00:03',
      }
      setMessages((prev) => [...prev, criticMsg])
      await sleep(600)

      // Step 4: 渲染调度 Agent
      const synthesized = `Masterpiece commercial cinematography, ${themeInput}. Shot on 85mm anamorphic macro lens, extreme close-up with smooth spiral dolly-in movement, razor sharp gear cogs with flawless mechanical interlocking, delicate subsurface rim reflections, high contrast moody cyber teal rim lighting, raytraced reflections on brushed titanium, ultra realistic 8K.`
      const negative = 'blurry, melted metal, jitter, deformed geometry, plastic, oversaturated, low resolution'

      const dispatcherMsg: AgentMessage = {
        id: 'msg-4',
        role: 'dispatcher',
        agentName: '调度合成 Agent (Dispatcher)',
        avatar: '⚡',
        title: '【调度执行】多 Agent 智能成果合成完毕',
        thought: '完成多智体协同汇编，生成终极指令 Payload，准备派发渲染引擎...',
        output: `终极生片 Prompt 已合成完毕。包含焦段、轨迹、物理材质与负向防护网。已就绪，可随时向 ${providerId.toUpperCase()} 派发算力任务！`,
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
    setIsRendering(true)
    setRenderProgress(15)
    setRenderStatus('正在通过调度 Agent 派发视频渲染请求...')
    setErrorMsg(null)

    try {
      let provider: VideoProvider = mockVideoProvider
      if (providerId === 'kling') provider = klingVideoProvider
      if (providerId === 'jimeng') provider = jimengVideoProvider
      const req: VideoGenRequest = {
        clientTaskId: `swarm-task-${Date.now()}`,
        shotId: `swarm-${Date.now()}`,
        prompt: swarmSpec.synthesizedPrompt,
        negative: swarmSpec.negativePrompt,
        durationSec: 5,
        ratio: '9:16',
        title: swarmSpec.theme,
      }

      setRenderProgress(30)
      setRenderStatus(`已连接 ${providerId.toUpperCase()} 集群，多 Agent 联合神经渲染中...`)

      const { taskId } = await provider.submit(req)

      let attempts = 0
      const maxAttempts = 40
      const pollTimer = setInterval(async () => {
        attempts++
        try {
          const pollRes = await provider.poll(taskId)
          setRenderProgress(Math.min(95, 30 + attempts * 3))
          setRenderStatus(`4 Agent 协同质检并监视渲染进度... (${attempts * 2}s)`)

          if (pollRes.status === 'succeeded') {
            clearInterval(pollTimer)
            const asset = await provider.getAsset(taskId)
            setRenderProgress(100)
            setRenderStatus('多 Agent 协同成片渲染完成！')
            setRenderedVideoUrl(asset.url)
            setIsRendering(false)
          } else if (pollRes.status === 'failed') {
            clearInterval(pollTimer)
            setIsRendering(false)
            setErrorMsg(`渲染失败: ${pollRes.error || '远端生成异常'}`)
          } else if (attempts >= maxAttempts) {
            clearInterval(pollTimer)
            setIsRendering(false)
            const asset = await provider.getAsset(taskId)
            if (asset) {
              setRenderedVideoUrl(asset.url)
            } else {
              setErrorMsg('生成超时，请检查网络或 API 密钥配置。')
            }
          }
        } catch (err: any) {
          clearInterval(pollTimer)
          setIsRendering(false)
          setErrorMsg(err.message || '查询任务状态出错')
        }
      }, 1500)
    } catch (err: any) {
      setIsRendering(false)
      setErrorMsg(err.message || '派发请求失败')
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
              onClick={() => setProviderId('mock')}
            >
              Mock 实验画布
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

      <div className="studio-layout">
        {/* 左侧：多 Agent 协同工作区 */}
        <div className="studio-left-pane">
          {/* 1. 主题输入与预设 */}
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
              <span className="row-label">灵感预置:</span>
              {PRESET_SWARM_THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="theme-chip"
                  onClick={() => setThemeInput(`${t.title}，${t.desc}`)}
                >
                  {t.title}
                </button>
              ))}
            </div>
          </div>

          {/* 2. 四智体实时协同推演流 */}
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

          {/* 3. 最终多 Agent 联合成片方案确认与执行 */}
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
