import React, { useEffect, useState } from 'react'
import type { ProductInput } from '../domain/product.ts'
import type { Script } from '../domain/script.ts'
import type { VisualPlan } from '../domain/sellVisual.ts'
import type { ShotJob, VideoProviderId } from '../domain/shotJob.ts'
import type { Story, TokenConfig } from '../types.ts'
import { TOKEN_STORAGE_KEY } from '../types.ts'
import { STRUCTURE_TEMPLATES } from '../prompts/library/structures.ts'
import { writeScript } from '../ai/agents/scriptWriter.ts'
import { critiqueScript, type CriticReviewResult } from '../ai/agents/scriptCritic.ts'
import { scriptToStory } from '../director/nodes/storyboardNode.ts'
import { compileVisualPlans } from '../director/nodes/visualizerNode.ts'
import { executorEngine } from '../director/nodes/executorNode.ts'
import { comfyUIVideoProvider } from '../media/providers/comfyui.ts'
import {
  clearPipelineSession,
  loadPipelineSession,
  savePipelineSession,
  type PipelineSessionV2,
} from '../persistV2.ts'

import { WorkbenchHeader, type WorkbenchStep, type StudioMode } from './components/WorkbenchHeader.tsx'
import { PipelineEngineBar } from './components/PipelineEngineBar.tsx'
import { TokenSettingsModal } from './components/TokenSettingsModal.tsx'
import { WalletModal } from './components/WalletModal.tsx'
import { ProductStep } from './steps/ProductStep.tsx'
import { TemplateStep } from './steps/TemplateStep.tsx'
import { ScriptStep } from './steps/ScriptStep.tsx'
import { StoryboardStep } from './steps/StoryboardStep.tsx'
import { VisualStep } from './steps/VisualStep.tsx'
import { GenerateBoard } from './steps/GenerateBoard.tsx'
import { loadAndHydratePipelineSession } from '../persistV2.ts'
import { FeedbackDashboard } from './components/FeedbackDashboard.tsx'
import { DeliverPlayer } from './steps/DeliverPlayer.tsx'
import { SingleAgentStudio } from './studios/SingleAgentStudio.tsx'
import { MultiAgentStudio } from './studios/MultiAgentStudio.tsx'
import { hairDryerImg } from '../assets/presets/index.ts'
import {
  DEMO_SCRIPT,
  DEMO_CRITIC,
  DEMO_STORY,
  DEMO_VISUAL_PLANS,
  DEMO_JOBS,
} from '../assets/presets/demoPipelineData.ts'

const DEFAULT_PRODUCT_INPUT: ProductInput = {
  source: 'link',
  link: 'https://item.taobao.com/item.htm?id=sample_dryer',
  title: '高速负离子静音电吹风',
  imagePreview: hairDryerImg,
  sellingPointsManual: [
    '11万转高速马达，3分钟速干',
    '2亿级高浓度负离子抚平毛躁',
    '智能恒温算法，绝不伤发',
  ],
}

type Props = {
  onSwitchToDrama: () => void
}

export const SellWorkbench: React.FC<Props> = ({ onSwitchToDrama }) => {
  const [initialSession] = useState<PipelineSessionV2 | null>(() => loadPipelineSession())

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const urlMode = urlParams?.get('mode') as StudioMode | null
  const urlStep = urlParams?.get('step') ? (Number(urlParams.get('step')) as WorkbenchStep) : null

  const [currentStep, setCurrentStep] = useState<WorkbenchStep>(
    urlStep !== null ? urlStep : (initialSession?.activeStep as WorkbenchStep) || 0
  )
  const [maxReachedStep, setMaxReachedStep] = useState<WorkbenchStep>(
    urlStep !== null ? Math.max(urlStep, 6) as WorkbenchStep : (initialSession?.activeStep as WorkbenchStep) || 0
  )
  const [studioMode, setStudioMode] = useState<StudioMode>(
    urlMode === 'single-agent' || urlMode === 'multi-agent' || urlMode === 'pipeline'
      ? urlMode
      : 'pipeline'
  )
  const [productInput, setProductInput] = useState<ProductInput>(
    initialSession?.productInput || DEFAULT_PRODUCT_INPUT
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    initialSession?.selectedTemplateId || STRUCTURE_TEMPLATES[0].id
  )
  const [script, setScript] = useState<Script | null>(initialSession?.script || DEMO_SCRIPT)
  const [criticResult, setCriticResult] = useState<CriticReviewResult | null>(DEMO_CRITIC)
  const [sellStory, setSellStory] = useState<Story | null>(initialSession?.story || DEMO_STORY)
  const [visualPlans, setVisualPlans] = useState<VisualPlan[]>(
    initialSession?.visualPlans && initialSession.visualPlans.length > 0
      ? initialSession.visualPlans
      : DEMO_VISUAL_PLANS
  )
  const [jobs, setJobs] = useState<ShotJob[]>(
    initialSession?.jobs && initialSession.jobs.length > 0
      ? initialSession.jobs
      : DEMO_JOBS
  )
  const [isExpanding, setIsExpanding] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(urlParams?.get('settings') === 'open')
  const [isWalletOpen, setIsWalletOpen] = useState(urlParams?.get('wallet') === 'open')
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false)
  const [hasToken, setHasToken] = useState<boolean>(() => {
    try {
      const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
      return Boolean(raw && (JSON.parse(raw) as TokenConfig).apiKey?.trim())
    } catch {
      return false
    }
  })

  // 监听任务调度器更新
  useEffect(() => {
    const unsub = executorEngine.subscribe((latestJobs) => {
      setJobs([...latestJobs])
    })
    return () => {
      unsub()
    }
  }, [])

  // 异步水合：IndexedDB 中的 base64 资产恢复为 objectURL，blob: 死链标记 expired
  useEffect(() => {
    if (!initialSession) return
    let cancelled = false
    void loadAndHydratePipelineSession().then((hydrated) => {
      if (cancelled || !hydrated) return
      if (hydrated.productInput) setProductInput(hydrated.productInput)
      if (hydrated.visualPlans && hydrated.visualPlans.length > 0) setVisualPlans(hydrated.visualPlans)
      // 关键守卫：仅当 executor 引擎为空（无进行中/已完成会话）时才恢复持久化的 jobs。
      // 否则水合的陈旧快照会覆盖 executorEngine.subscribe 推送的实时状态，
      // 导致渲染页卡在「排队中」而引擎内部早已出片成功。
      if (hydrated.jobs && hydrated.jobs.length > 0 && executorEngine.getJobs().length === 0) {
        // R4 修复：刷新后引擎内存态丢失，持久化快照中的 queued/running 任务是「僵尸」——
        // 既不续跑也无法重试（FSM 禁止回退）。经 resumeJobs 受控降级为可重入 queued
        // 并重新入队 executor（旧冻结款释放，不双倍计费），UI 显示「已恢复，可继续」。
        void executorEngine.resumeJobs(hydrated.jobs, visualPlans).then((resumed) => {
          setJobs([...resumed])
        })
      }
    })
    return () => {
      cancelled = true
    }
    // oxlint-disable-next-line set-state-in-effect -- 异步水合 IDB 资产，非同步 setState
  }, [])

  // 状态自动持久化存盘
  useEffect(() => {
    savePipelineSession({
      version: 2,
      id: initialSession?.id || `pipeline-${Date.now()}`,
      activeStep: currentStep,
      productInput,
      selectedTemplateId,
      script: script || undefined,
      story: sellStory || undefined,
      visualPlans: visualPlans.length > 0 ? visualPlans : undefined,
      jobs: jobs.length > 0 ? jobs : undefined,
      updatedAt: Date.now(),
    })
  }, [currentStep, productInput, selectedTemplateId, script, sellStory, visualPlans, jobs, initialSession?.id])

  const readToken = (): TokenConfig | null => {
    try {
      const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
      if (!raw) return null
      return JSON.parse(raw) as TokenConfig
    } catch {
      return null
    }
  }

  const advanceToStep = (next: WorkbenchStep) => {
    setCurrentStep(next)
    setMaxReachedStep((prev) => (next > prev ? next : prev))
  }

  // 1 -> 2：选择模板并一键扩写
  const handleGenerateScript = async () => {
    setIsExpanding(true)
    try {
      const token = readToken()
      const generated = await writeScript({
        productTitle: productInput.title || '爆款好物',
        sellingPoints: productInput.sellingPointsManual,
        templateId: selectedTemplateId,
        tokenConfig: token?.apiKey ? token : null,
      })
      const review = await critiqueScript(generated, token?.apiKey ? token : null)
      setScript(generated)
      setCriticResult(review)
      setPipelineErrorMsg(null)
      advanceToStep(2)
    } catch (err) {
      setPipelineErrorMsg(
        `剧本生成失败：${err instanceof Error ? err.message : '未知错误'}。请检查网络与 API Key 配置后重试，或切换为 Mock 免费模式。`
      )
    } finally {
      setIsExpanding(false)
    }
  }

  // 2 -> 3：剧本确认，编译为 6 镜 Story
  const handleScriptToStoryboard = () => {
    if (!script) return
    const compiledStory = scriptToStory(script, productInput.title)
    setSellStory(compiledStory)
    advanceToStep(3)
  }

  // 3 -> 4：分镜预演确认，编译视觉卡 VisualPlans
  const handleStoryboardToVisual = () => {
    if (!sellStory) return
    const plans = compileVisualPlans(sellStory, script || undefined, productInput.imagePreview)
    setVisualPlans(plans)
    advanceToStep(4)
  }

  const readVideoProvider = (): VideoProviderId => {
    try {
      const p = sessionStorage.getItem('weblockshot.video_provider')
      if (p === 'kling') return 'kling'
      if (p === 'jimeng') return 'jimeng'
      if (p === 'comfyui') return 'comfyui'
      return 'mock'
    } catch {
      return 'mock'
    }
  }

  // 全链路顶部常驻引擎条：初始值与设置弹窗同源（sessionStorage），切换即写回
  const [pipelineProvider, setPipelineProvider] = useState<VideoProviderId>(readVideoProvider)
  const [pipelineErrorMsg, setPipelineErrorMsg] = useState<string | null>(null)
  const [comfyPing, setComfyPing] = useState<{
    status: 'idle' | 'testing' | 'ok' | 'error'
    msg?: string
  }>({ status: 'idle' })

  /** 探测本地/远程 ComfyUI 实例可达性（与两个工作室同款行为） */
  const runComfyPing = async (): Promise<boolean> => {
    setComfyPing({ status: 'testing' })
    const res = await comfyUIVideoProvider.testConnection()
    if (res.ok) {
      const vram = res.vramFreeGb != null ? `，可用显存 ${res.vramFreeGb} GB` : ''
      setComfyPing({
        status: 'ok',
        msg: `✓ 已连接 ComfyUI${res.gpuName ? ` · 显卡 ${res.gpuName}` : ''}${vram}`,
      })
      setPipelineErrorMsg(null)
      return true
    }
    setComfyPing({ status: 'error', msg: res.error || '未检测到本地 ComfyUI 实例' })
    setPipelineErrorMsg(
      `当前选用了 ComfyUI 私有算力，但 ${res.error || '未检测到本地 ComfyUI 服务'}。请确认 ComfyUI 已启动（默认 http://127.0.0.1:8188）后点击上方「⚙️ 前往配置 API Key」核对地址，或切换为 Mock 模式。`
    )
    return false
  }

  const handleSelectPipelineProvider = (id: VideoProviderId) => {
    setPipelineProvider(id)
    try {
      sessionStorage.setItem('weblockshot.video_provider', id)
    } catch {}
    // 切换引擎时立即清掉上一个引擎的报错，避免 ping 期间残留旧 engine 的错误
    setPipelineErrorMsg(null)
    if (id === 'kling') {
      try {
        const key = sessionStorage.getItem('weblockshot.kling_key')
        if (!key?.trim()) {
          setPipelineErrorMsg('未检测到快手可灵 API Key！请点击右侧「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 免费模式。')
          setComfyPing({ status: 'idle' })
          return
        }
      } catch {}
    }
    if (id === 'jimeng') {
      try {
        const key = sessionStorage.getItem('weblockshot.jimeng_key')
        if (!key?.trim()) {
          setPipelineErrorMsg('未检测到字节即梦 (Jimeng) API Key！请点击右侧「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock 免费模式。')
          setComfyPing({ status: 'idle' })
          return
        }
      } catch {}
    }
    if (id === 'comfyui') {
      // 选中 ComfyUI 时异步探测实例可达性
      void runComfyPing()
      return
    }
    setComfyPing({ status: 'idle' })
  }

  // 4 -> 5：确认视觉方案，开始向调度引擎提交 6 镜
  const handleStartGeneration = async () => {
    if (visualPlans.length === 0) return
    const provider = pipelineProvider
    if (provider === 'kling') {
      try {
        const k = sessionStorage.getItem('weblockshot.kling_key')
        if (!k?.trim()) {
          setPipelineErrorMsg('当前工作流选用了快手可灵 (Kling) 官方 API，但尚未配置 API Key！请点击上方「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock / ComfyUI 模式。')
          return
        }
      } catch {}
    }
    if (provider === 'jimeng') {
      try {
        const k = sessionStorage.getItem('weblockshot.jimeng_key')
        if (!k?.trim()) {
          setPipelineErrorMsg('当前工作流选用了字节即梦 (Jimeng) 官方 API，但尚未配置 API Key！请点击上方「⚙️ 前往配置 API Key」填入密钥，或切换为 Mock / ComfyUI 模式。')
          return
        }
      } catch {}
    }
    if (provider === 'comfyui') {
      // 与两个工作室一致：生成前若上次 ping 失败或未 ping，重新探测
      if (comfyPing.status !== 'ok') {
        const ok = await runComfyPing()
        if (!ok) return
      }
    }
    advanceToStep(5)
    await executorEngine.enqueueShots(visualPlans, provider)
  }

  // 单镜失败重试
  const handleRetryJob = (shotId: string) => {
    executorEngine.retryJob(shotId, visualPlans)
  }

  // 交付播放器单镜重新生成
  const handleRegenerateSingleShot = (shotId: string) => {
    // O2 修复：succeeded 是终态，retryJob（failed→queued 路径）会抛 FSM Violation。
    // 已成功的镜走受控 requeueJob（succeeded→queued 专项放行，旧凭据释放后重新冻结）；
    // 其余状态（failed 等）保持原 retryJob 语义。
    const job = jobs.find((j) => j.shotId === shotId)
    if (job?.status === 'succeeded' || job?.status === 'running') {
      void executorEngine.requeueJob(shotId, visualPlans, 'regenerate')
    } else {
      void executorEngine.retryJob(shotId, visualPlans)
    }
    setCurrentStep(5)
  }

  // 新建下一条带货视频（彻底重置全链路状态）
  const handleRestartPipeline = () => {
    setScript(null)
    setCriticResult(null)
    setSellStory(null)
    setVisualPlans([])
    setJobs([])
    executorEngine.loadJobs([])
    setCurrentStep(0)
    setMaxReachedStep(0)
    clearPipelineSession()
    savePipelineSession({
      version: 2,
      id: `pipeline-${Date.now()}`,
      activeStep: 0,
      productInput,
      selectedTemplateId,
      updatedAt: Date.now(),
    })
  }

  return (
    <div className="workbench-app">
      {/* 顶部导航 Header */}
      <WorkbenchHeader
        mode="sell"
        onModeChange={(m) => {
          if (m === 'drama') onSwitchToDrama()
        }}
        currentStep={currentStep}
        onStepChange={(s) => setCurrentStep(s)}
        maxReachedStep={maxReachedStep}
        studioMode={studioMode}
        onStudioModeChange={setStudioMode}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWallet={() => setIsWalletOpen(true)}
        onOpenFeedback={() => setIsFeedbackOpen(true)}
        hasToken={hasToken}
      />

      <FeedbackDashboard isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />

      <TokenSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSaved={() => {
          try {
            const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
            setHasToken(Boolean(raw && (JSON.parse(raw) as TokenConfig).apiKey?.trim()))
          } catch {
            setHasToken(false)
          }
        }}
      />

      <WalletModal
        isOpen={isWalletOpen}
        onClose={() => setIsWalletOpen(false)}
      />

      <main className="workbench-main-content">
        {studioMode === 'single-agent' && (
          <SingleAgentStudio onOpenSettings={() => setIsSettingsOpen(true)} />
        )}

        {studioMode === 'multi-agent' && (
          <MultiAgentStudio onOpenSettings={() => setIsSettingsOpen(true)} />
        )}

        {studioMode === 'pipeline' && (
          <>
            {/* 全链路常驻引擎条：7 步全程可见，选择与设置弹窗双向同步；<768px 可折叠（M1d 手机适配） */}
            <PipelineEngineBar providerId={pipelineProvider} onSelectProvider={handleSelectPipelineProvider} />

            {/* ComfyUI 选中后的 Ping 状态条 */}
            {pipelineProvider === 'comfyui' && comfyPing.status !== 'idle' && (
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

            {/* 全局醒目错误与 API 配置引导条（与两个工作室同款） */}
            {pipelineErrorMsg && (
              <div className="studio-error-banner global-studio-alert">
                <div className="alert-content">
                  <span className="alert-icon">⚠️</span>
                  <span className="alert-text">{pipelineErrorMsg}</span>
                </div>
                <div className="alert-actions">
                  {(pipelineErrorMsg.includes('Key') || pipelineErrorMsg.includes('API')) && (
                    <button
                      type="button"
                      className="btn-alert-action"
                      onClick={() => setIsSettingsOpen(true)}
                    >
                      ⚙️ 前往配置 API Key
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-alert-dismiss"
                    onClick={() => setPipelineErrorMsg(null)}
                  >
                    ✕ 关闭提示
                  </button>
                </div>
              </div>
            )}

            {currentStep === 0 && (
              <ProductStep
                productInput={productInput}
                onChange={setProductInput}
                onNext={() => advanceToStep(1)}
              />
            )}

            {currentStep === 1 && (
              <TemplateStep
                selectedTemplateId={selectedTemplateId}
                onSelectTemplate={setSelectedTemplateId}
                onNext={handleGenerateScript}
                isLoading={isExpanding}
              />
            )}

            {currentStep === 2 && script && (
              <ScriptStep
                script={script}
                criticResult={criticResult}
                onChange={setScript}
                onNext={handleScriptToStoryboard}
                onReCritique={async () => {
                  try {
                    const token = readToken()
                    const res = await critiqueScript(script, token?.apiKey ? token : null)
                    setCriticResult(res)
                    setPipelineErrorMsg(null)
                  } catch (err) {
                    setPipelineErrorMsg(
                      `剧本评审失败：${err instanceof Error ? err.message : '未知错误'}。请检查网络与 API Key 配置后重试。`
                    )
                  }
                }}
              />
            )}

            {currentStep === 3 && sellStory && (
              <StoryboardStep
                story={sellStory}
                onStoryChange={setSellStory}
                onNext={handleStoryboardToVisual}
              />
            )}

            {currentStep === 4 && (
              <VisualStep
                visualPlans={visualPlans}
                onChange={setVisualPlans}
                onNext={handleStartGeneration}
              />
            )}

            {currentStep === 5 && (
              <GenerateBoard
                jobs={jobs}
                onRetryShot={handleRetryJob}
                onNext={() => advanceToStep(6)}
              />
            )}

            {currentStep === 6 && sellStory && (
              <DeliverPlayer
                jobs={jobs}
                story={sellStory}
                visualPlans={visualPlans}
                onRegenerateSingleShot={handleRegenerateSingleShot}
                onRestartPipeline={handleRestartPipeline}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
