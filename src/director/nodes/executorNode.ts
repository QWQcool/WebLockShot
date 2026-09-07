import { computeTaskKey, type ShotJob, type VideoProviderId } from '../../domain/shotJob.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import type { VideoProvider } from '../../media/types.ts'
import { mockVideoProvider } from '../../media/providers/mock.ts'
import { klingVideoProvider } from '../../media/providers/kling.ts'
import { jimengVideoProvider } from '../../media/providers/jimeng.ts'
import { comfyUIVideoProvider } from '../../media/providers/comfyui.ts'
import { walletManager } from '../../domain/wallet.ts'
import { circuitBreaker, assertJobStatusTransition } from '../../domain/fsm.ts'
import { getPollingWindow, pollSleep } from '../../domain/pollingConfig.ts'
import { idempotencyManager } from '../../domain/idempotency.ts'

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
  /**
   * 待处理视觉方案缓存：processQueue 循环末尾重查队列时，
   * 处理期间新入队 / 重试的任务依然能找到对应 plan，不会丢失。
   */
  private pendingPlans: Map<string, VisualPlan> = new Map()
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
    // 显式无返回值（React effect cleanup 约定），避免 StrictMode 双挂载歧义
    return () => {
      this.listeners.delete(listener)
    }
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
   * FSM 守卫的状态写入：非法迁移直接抛错（含 succeeded 终态再变更）
   */
  private setJobStatus(job: ShotJob, to: ShotJob['status'], context = '') {
    assertJobStatusTransition(job.status, to, context)
    job.status = to
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
        this.pendingPlans.set(plan.shotId, plan)
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
      this.pendingPlans.set(plan.shotId, plan)
    }

    this.notify()
    this.scheduleProcessing()
    return this.getJobs()
  }

  /**
   * 单镜失败重试
   */
  async retryJob(shotId: string, visualPlans: VisualPlan[]) {
    const job = this.jobs.get(shotId)
    if (!job) return

    // FSM 守卫：failed -> queued 合法迁移；终态/运行中任务拒绝重试
    this.setJobStatus(job, 'queued', `retryJob(${shotId})`)
    job.error = undefined
    job.progress = 0
    job.attempt += 1

    for (const plan of visualPlans) {
      this.pendingPlans.set(plan.shotId, plan)
    }

    this.notify()
    this.scheduleProcessing()
  }

  /**
   * 浏览器单机串行队列调度器（如实注明单机并发，不夸大为分布式）
   *
   * 竞态修复：不再使用 fire-and-forget + isProcessing 早退（会导致处理期间
   * retry/enqueue 的任务永久卡在 queued）。改为循环末尾重查队列，
   * 直到没有可运行任务才退出；处理期间新入队的任务在下一轮被拾起。
   */
  private scheduleProcessing() {
    if (this.isProcessing) return
    this.isProcessing = true
    void this.runQueue()
  }

  private async runQueue() {
    try {
      while (true) {
        const queued = Array.from(this.jobs.values()).filter((j) => j.status === 'queued')
        const runnable = queued.filter((j) => this.pendingPlans.has(j.shotId))
        if (runnable.length === 0) break

        for (const job of runnable) {
          const plan = this.pendingPlans.get(job.shotId)
          if (!plan) continue
          await this.processJob(job, plan)
        }
      }
    } finally {
      this.isProcessing = false
    }
  }

  /** 处理单个任务：熔断检查 -> 幂等锁 -> 资金冻结 -> 提交 -> 轮询 -> 结算/退款 */
  private async processJob(job: ShotJob, plan: VisualPlan) {
    // 0. 熔断检查与防连击幂等锁
    const breakerCheck = circuitBreaker.isAvailable(job.provider)
    if (!breakerCheck.allowed) {
      this.setJobStatus(job, 'failed', 'circuit breaker open')
      job.error = breakerCheck.reason
      this.notify()
      return
    }

    const lockResult = idempotencyManager.acquireLock(job.taskKey)
    if (!lockResult.success) {
      this.setJobStatus(job, 'failed', 'idempotency lock conflict')
      job.error = lockResult.reason
      this.notify()
      return
    }

    // 1. 资金两阶段事务：阶段 1 (预冻结)
    const cost = walletManager.getCost(job.provider, 1)
    const freezeSuccess = walletManager.freeze(
      cost,
      job.shotId,
      job.provider,
      `第 ${plan.order || job.shotId} 镜生片 (${job.provider})`
    )

    if (!freezeSuccess) {
      idempotencyManager.releaseLock(job.taskKey)
      this.setJobStatus(job, 'failed', 'insufficient wallet balance')
      job.error = `钱包可用余额不足 (需 ${cost} 灵感币)，请在顶部虚拟钱包中模拟充值。`
      this.notify()
      return
    }

    this.setJobStatus(job, 'running', 'submit to provider')
    job.progress = 10
    this.notify()

    const provider = this.resolveProvider(job.provider)
    const pollingWindow = getPollingWindow()

    try {
      // 2. 提交至 provider
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

      // 3. 轮询状态直到终态（轮询窗口可配置，默认 10 分钟）
      let finished = false
      let pollAttempts = 0
      while (!finished && pollAttempts < pollingWindow.maxAttempts) {
        // 统一轮询睡眠：切后台回来立即刷新一次状态（pollSleep 统一实现）
        await pollSleep(pollingWindow.intervalMs)
        pollAttempts++

        const result = await provider.poll(taskId)
        job.progress = Math.max(job.progress, result.progress || 0)

        if (result.status === 'succeeded') {
          finished = true
          job.asset = await provider.getAsset(taskId)
          this.setJobStatus(job, 'succeeded', 'generation succeeded')
          job.progress = 100

          // 资金两阶段事务：阶段 2A (成功核销结算)
          walletManager.settle(job.shotId, cost, job.provider, `第 ${plan.order || job.shotId} 镜出片成功核销`)
          circuitBreaker.recordSuccess(job.provider)
          idempotencyManager.releaseLock(job.taskKey)
          this.notify()
        } else if (result.status === 'failed') {
          finished = true
          this.setJobStatus(job, 'failed', 'provider reported failure')
          job.error = result.error || '生成失败'

          // 资金两阶段事务：阶段 2B (失败全额回滚退还)
          walletManager.refund(job.shotId, cost, job.provider, `第 ${plan.order || job.shotId} 镜生成异常自动退还`)
          circuitBreaker.recordFailure(job.provider)
          idempotencyManager.releaseLock(job.taskKey)
          this.notify()
        } else {
          this.notify()
        }
      }

      if (!finished) {
        // 轮询超时：绝不 settle，必须全额退款
        this.setJobStatus(job, 'failed', 'polling window timeout')
        job.error = '轮询超时'
        walletManager.refund(job.shotId, cost, job.provider, `第 ${plan.order || job.shotId} 镜生成超时自动退款`)
        circuitBreaker.recordFailure(job.provider)
        idempotencyManager.releaseLock(job.taskKey)
        this.notify()
      }
    } catch (err) {
      this.setJobStatus(job, 'failed', 'submit/poll exception')
      job.error = err instanceof Error ? err.message : String(err)
      walletManager.refund(job.shotId, cost, job.provider, `第 ${plan.order || job.shotId} 镜提交异常自动退款`)
      circuitBreaker.recordFailure(job.provider)
      idempotencyManager.releaseLock(job.taskKey)
      this.notify()
    }
  }
}

export const executorEngine = new ExecutorEngine()
