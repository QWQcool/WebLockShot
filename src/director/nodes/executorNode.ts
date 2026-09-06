import { computeTaskKey, type ShotJob, type VideoProviderId } from '../../domain/shotJob.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import type { VideoProvider } from '../../media/types.ts'
import { mockVideoProvider } from '../../media/providers/mock.ts'
import { klingVideoProvider } from '../../media/providers/kling.ts'
import { jimengVideoProvider } from '../../media/providers/jimeng.ts'
import { comfyUIVideoProvider } from '../../media/providers/comfyui.ts'

export type JobUpdateListener = (jobs: ShotJob[]) => void

export function resolveVideoProvider(providerId: VideoProviderId): VideoProvider {
  if (providerId === 'kling') {
    return klingVideoProvider
  }
  if (providerId === 'jimeng') {
    return jimengVideoProvider
  }
  if (providerId === 'comfyui') {
    return comfyUIVideoProvider
  }
  return mockVideoProvider
}

export class ExecutorEngine {
  private jobs: Map<string, ShotJob> = new Map()
  private customProvider?: VideoProvider
  private isProcessing = false
  private listeners: Set<JobUpdateListener> = new Set()

  constructor(customProvider?: VideoProvider) {
    this.customProvider = customProvider
  }

  setProvider(provider: VideoProvider) {
    this.customProvider = provider
  }

  resolveProvider(providerId: VideoProviderId): VideoProvider {
    if (this.customProvider) {
      return this.customProvider
    }
    return resolveVideoProvider(providerId)
  }

  subscribe(listener: JobUpdateListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    const list = Array.from(this.jobs.values())
    this.listeners.forEach((fn) => fn(list))
  }

  getJobs(): ShotJob[] {
    return Array.from(this.jobs.values())
  }

  loadJobs(jobs: ShotJob[]) {
    this.jobs.clear()
    for (const j of jobs) {
      this.jobs.set(j.shotId, j)
    }
    this.notify()
  }

  /**
   * 提交或排队 6 镜任务（带幂等排重保障）
   */
  async enqueueShots(
    visualPlans: VisualPlan[],
    providerId: VideoProviderId = 'mock'
  ): Promise<ShotJob[]> {
    for (const plan of visualPlans) {
      const taskKey = await computeTaskKey(
        plan.shotId,
        { positive: plan.positive, durationSec: plan.durationSec },
        providerId
      )

      const existing = this.jobs.get(plan.shotId)

      // 幂等防重：若同意图任务已经在排队、运行或已成功，直接保留，绝不重复创建
      if (
        existing &&
        existing.taskKey === taskKey &&
        (existing.status === 'queued' ||
          existing.status === 'running' ||
          existing.status === 'succeeded')
      ) {
        continue
      }

      const job: ShotJob = {
        shotId: plan.shotId,
        taskKey,
        provider: providerId,
        status: 'queued',
        attempt: existing ? existing.attempt + 1 : 0,
        progress: 0,
      }

      this.jobs.set(plan.shotId, job)
    }

    this.notify()
    this.processQueue(visualPlans)
    return this.getJobs()
  }

  /**
   * 单镜失败重试
   */
  async retryJob(shotId: string, visualPlans: VisualPlan[]) {
    const job = this.jobs.get(shotId)
    if (!job) return

    job.status = 'queued'
    job.error = undefined
    job.progress = 0
    job.attempt += 1

    this.notify()
    this.processQueue(visualPlans)
  }

  /**
   * 浏览器单机串行队列调度器（如实注明单机并发，不夸大为分布式）
   */
  private async processQueue(visualPlans: VisualPlan[]) {
    if (this.isProcessing) return
    this.isProcessing = true

    try {
      for (const [shotId, job] of this.jobs.entries()) {
        if (job.status !== 'queued') continue

        const plan = visualPlans.find((p) => p.shotId === shotId)
        if (!plan) continue

        job.status = 'running'
        job.progress = 10
        this.notify()

        const provider = this.resolveProvider(job.provider)

        try {
          // 1. 提交至 provider
          const { taskId } = await provider.submit({
            clientTaskId: job.taskKey,
            prompt: plan.positive,
            negative: plan.negative,
            imageBase64: plan.referenceImage,
            durationSec: plan.durationSec,
            ratio: plan.ratio,
            shotId: plan.shotId,
            caption: plan.caption,
            title: plan.caption || plan.positive || plan.shotId,
          })

          job.providerTaskId = taskId
          this.notify()

          // 2. 轮询状态直到终态
          let finished = false
          let pollAttempts = 0
          while (!finished && pollAttempts < 60) {
            await new Promise((r) => setTimeout(r, 600))
            pollAttempts++

            const result = await provider.poll(taskId)
            job.progress = Math.max(job.progress, result.progress || 0)

            if (result.status === 'succeeded') {
              finished = true
              job.status = 'succeeded'
              job.progress = 100
              job.asset = await provider.getAsset(taskId)
              this.notify()
            } else if (result.status === 'failed') {
              finished = true
              job.status = 'failed'
              job.error = result.error || '生成失败'
              this.notify()
            } else {
              job.status = 'running'
              this.notify()
            }
          }

          if (!finished) {
            job.status = 'failed'
            job.error = '轮询超时'
            this.notify()
          }
        } catch (err) {
          job.status = 'failed'
          job.error = err instanceof Error ? err.message : String(err)
          this.notify()
        }
      }
    } finally {
      this.isProcessing = false
    }
  }
}

export const executorEngine = new ExecutorEngine()
