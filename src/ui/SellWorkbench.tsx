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
import {
  loadPipelineSession,
  savePipelineSession,
  type PipelineSessionV2,
} from '../persistV2.ts'

import { WorkbenchHeader, type WorkbenchStep } from './components/WorkbenchHeader.tsx'
import { TokenSettingsModal } from './components/TokenSettingsModal.tsx'
import { ProductStep } from './steps/ProductStep.tsx'
import { TemplateStep } from './steps/TemplateStep.tsx'
import { ScriptStep } from './steps/ScriptStep.tsx'
import { StoryboardStep } from './steps/StoryboardStep.tsx'
import { VisualStep } from './steps/VisualStep.tsx'
import { GenerateBoard } from './steps/GenerateBoard.tsx'
import { DeliverPlayer } from './steps/DeliverPlayer.tsx'

const DEFAULT_PRODUCT_INPUT: ProductInput = {
  source: 'link',
  link: 'https://item.taobao.com/item.htm?id=sample_dryer',
  title: '高速负离子静音电吹风',
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

  const [currentStep, setCurrentStep] = useState<WorkbenchStep>(
    (initialSession?.activeStep as WorkbenchStep) || 0
  )
  const [maxReachedStep, setMaxReachedStep] = useState<WorkbenchStep>(
    (initialSession?.activeStep as WorkbenchStep) || 0
  )
  const [productInput, setProductInput] = useState<ProductInput>(
    initialSession?.productInput || DEFAULT_PRODUCT_INPUT
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    initialSession?.selectedTemplateId || STRUCTURE_TEMPLATES[0].id
  )
  const [script, setScript] = useState<Script | null>(initialSession?.script || null)
  const [criticResult, setCriticResult] = useState<CriticReviewResult | null>(null)
  const [sellStory, setSellStory] = useState<Story | null>(initialSession?.story || null)
  const [visualPlans, setVisualPlans] = useState<VisualPlan[]>(initialSession?.visualPlans || [])
  const [jobs, setJobs] = useState<ShotJob[]>(initialSession?.jobs || [])
  const [isExpanding, setIsExpanding] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
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
      advanceToStep(2)
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
      return 'mock'
    } catch {
      return 'mock'
    }
  }

  // 4 -> 5：确认视觉方案，开始向调度引擎提交 6 镜
  const handleStartGeneration = async () => {
    if (visualPlans.length === 0) return
    advanceToStep(5)
    const provider = readVideoProvider()
    await executorEngine.enqueueShots(visualPlans, provider)
  }

  // 单镜失败重试
  const handleRetryJob = (shotId: string) => {
    executorEngine.retryJob(shotId, visualPlans)
  }

  // 交付播放器单镜重新生成
  const handleRegenerateSingleShot = (shotId: string) => {
    executorEngine.retryJob(shotId, visualPlans)
    setCurrentStep(5)
  }

  // 新建下一条带货视频
  const handleRestartPipeline = () => {
    setScript(null)
    setCriticResult(null)
    setSellStory(null)
    setVisualPlans([])
    setJobs([])
    advanceToStep(0)
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
        onOpenSettings={() => setIsSettingsOpen(true)}
        hasToken={hasToken}
      />

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

      <main className="workbench-main-content">
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
              const token = readToken()
              const res = await critiqueScript(script, token?.apiKey ? token : null)
              setCriticResult(res)
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
      </main>
    </div>
  )
}
