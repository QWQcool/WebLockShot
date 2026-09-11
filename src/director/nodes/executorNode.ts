import { computeTaskKey, type ShotJob, type VideoProviderId } from '../../domain/shotJob.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import type { VideoProvider } from '../../media/types.ts'
import { mockVideoProvider } from '../../media/providers/mock.ts'
import { klingVideoProvider } from '../../media/providers/kling.ts'
import { jimengVideoProvider } from '../../media/providers/jimeng.ts'
import { comfyUIVideoProvider } from '../../media/providers/comfyui.ts'
import { runwayVideoProvider } from '../../media/providers/runway.ts'
import { lumaVideoProvider } from '../../media/providers/luma.ts'
import { walletManager } from '../../domain/wallet.ts'
import { circuitBreaker, assertJobStatusTransition, assertJobRequeue } from '../../domain/fsm.ts'
import { getPollingWindow, pollSleep } from '../../domain/pollingConfig.ts'
import { idempotencyManager } from '../../domain/idempotency.ts'
import { appendRunRecord } from '../../persist/runStore.ts'
import type { RunRecordInput } from '../../domain/runRecord.ts'

export type JobUpdateListener = (jobs: ShotJob[]) => void

/**
 * S3：执行器运行上下文。由调用方（画布 generate 节点）注入，
 * 用于把执行历史关联回具体节点。sell 6 镜管线可不注入（nodeId 缺省）。
 */
export type RunContext = {
  /** 触发本次执行的画布节点 id（sell 管线 / 未接线时缺省） */
  nodeId?: string
  /** 动作类型（画布 CanvasNodeKind；缺省 'generate'） */
  kind?: string
}

/** 单次动作的过程内累加器（动作结束时汇总成一条 RunRecord） */
type RunAcc = {
  startedAt: number
  /** 实际发生冻结的灵感币消耗（未成功冻结保持 0，不虚报） */
  cost: number
  /** 是否发生退款（由 refundRun 在退款成功时置真） */
  refunded: boolean
}

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
  // M1 海外引擎（契约先行，待真实环境验证）
  if (providerId === 'runway') {
    return runwayVideoProvider
  }
  if (providerId === 'luma') {
    return lumaVideoProvider
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
  /** S3：执行历史上下文（由调用方注入；缺省 kind='generate'） */
  private runContext: RunContext = {}

  constructor(customProvider?: VideoProvider) {
    this.customProvider = customProvider
  }

  setProvider(provider: VideoProvider) {
    this.customProvider = provider
  }

  /**
   * S3：注入执行历史上下文（画布 generate 节点用 `{ nodeId: shape.id, kind: 'generate' }`）。
   * 增量合并，便于调用方只覆盖关心的字段。
   */
  setRunContext(ctx: RunContext) {
    this.runContext = { ...this.runContext, ...ctx }
  }

  /** S3：读取当前执行历史上下文（副本） */
  getRunContext(): RunContext {
    return { ...this.runContext }
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
   * R4/O2：释放该任务遗留的旧冻结凭据。
   * 冻结款仍在（settle/refund 尚未发生，如刷新中断）→ 原路退回，避免重跑时双重冻结双倍占用；
   * 已被孤儿回收 → 无操作，重跑时按正常流程重新 freeze。
   */
  private releaseStaleFreeze(job: ShotJob, reason: string) {
    if (!walletManager.hasFrozenRef(job.shotId)) return
    const info = walletManager.getFrozenRef(job.shotId)
    if (!info) return
    walletManager.refund(job.shotId, info.amount, info.providerId, reason)
  }

  /**
   * R4：刷新后僵尸任务恢复（水合入口）。
   * 引擎内存态（provider 提交句柄、轮询循环）随页面刷新丢失，持久化快照中的
   * queued/running 任务既不能续跑也无法重试（FSM 禁止 running→queued / succeeded→queued）。
   * 水合时一次性降级为可重入 queued 并重新入队 executor：
   * - 旧冻结凭据仍在 → 原路退回（重跑时重新冻结，不双倍计费）
   * - 已被孤儿回收 → 直接按正常流程重新冻结
   */
  async resumeJobs(jobs: ShotJob[], visualPlans: VisualPlan[]): Promise<ShotJob[]> {
    this.loadJobs(jobs)
    for (const plan of visualPlans) {
      this.pendingPlans.set(plan.shotId, plan)
    }
    for (const job of this.jobs.values()) {
      if (job.status === 'running' || job.status === 'queued') {
        // running → queued 是受控迁移（requeue 语义，FSM 专项放行）；
        // queued 本就是可重入状态，仅需补标记（引擎内存态已随刷新丢失）
        if (job.status === 'running') {
          assertJobRequeue(job.status, `resumeJobs(${job.shotId})`)
          this.releaseStaleFreeze(job, `页面刷新任务恢复：释放中断前遗留冻结款 (${job.shotId})`)
        }
        job.status = 'queued'
        job.requeued = true
        job.progress = 0
        job.error = '检测到页面刷新导致任务中断，已自动恢复排队，可继续等待或手动重试。'
      }
    }
    this.notify()
    this.scheduleProcessing()
    return this.getJobs()
  }

  /**
   * O2：succeeded 单镜受控重生成（交付页「重新生成此镜」）。
   * 前置条件：该任务凭据已 settle 完毕无冻结（succeeded 正常路径如此；异常残留由
   * releaseStaleFreeze 兜底释放）。重生成走正常流程重新 freeze，不产生双倍计费。
   */
  async requeueJob(shotId: string, visualPlans: VisualPlan[], reason = 'regenerate') {
    const job = this.jobs.get(shotId)
    if (!job) return

    // FSM 受控迁移：仅 running/succeeded 可 requeue；其它状态走 retryJob（failed→queued）
    assertJobRequeue(job.status, `requeueJob(${shotId}, ${reason})`)
    this.releaseStaleFreeze(job, `任务重生成：释放旧冻结款 (${reason})`)
    job.status = 'queued'
    job.requeued = false
    job.error = undefined
    job.progress = 0
    job.asset = undefined
    job.providerTaskId = undefined
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

  /**
   * S3 单一收口：包一层，保证**所有**终态分支（熔断 / 幂等冲突 / 余额不足 / 提交异常 /
   * 轮询超时 / 成功）都恰好落一条 RunRecord —— 包括各处提前 return 的失败分支。
   * 记录写在 finally，避免遗漏；落库 fire-and-forget，不阻塞串行队列。
   */
  private async processJob(job: ShotJob, plan: VisualPlan) {
    const run: RunAcc = { startedAt: Date.now(), cost: 0, refunded: false }
    try {
      await this.executeJob(job, plan, run)
    } finally {
      this.recordRun(job, run)
    }
  }

  /** 处理单个任务：熔断检查 -> 幂等锁 -> 资金冻结 -> 提交 -> 轮询 -> 结算/退款 */
  private async executeJob(job: ShotJob, plan: VisualPlan, run: RunAcc) {
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

    // S3：仅记录**实际发生**的冻结消耗（余额不足等失败路径保持 0，不虚报）
    run.cost = cost

    this.setJobStatus(job, 'running', 'submit to provider')
    // 恢复/重生成任务重新开跑：清除恢复提示与标记
    job.requeued = false
    job.error = undefined
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
          this.refundRun(job, cost, `第 ${plan.order || job.shotId} 镜生成异常自动退还`, run)
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
        this.refundRun(job, cost, `第 ${plan.order || job.shotId} 镜生成超时自动退款`, run)
        circuitBreaker.recordFailure(job.provider)
        idempotencyManager.releaseLock(job.taskKey)
        this.notify()
      }
    } catch (err) {
      this.setJobStatus(job, 'failed', 'submit/poll exception')
      job.error = err instanceof Error ? err.message : String(err)
      this.refundRun(job, cost, `第 ${plan.order || job.shotId} 镜提交异常自动退款`, run)
      circuitBreaker.recordFailure(job.provider)
      idempotencyManager.releaseLock(job.taskKey)
      this.notify()
    }
  }

  // ---------------- S3：执行历史（RunRecord）单一收口 ----------------

  /**
   * 退款并记录「本次是否发生退款」。
   * - 只有钱包真的完成退款（返回 true）才置真——无凭据被拒的退款不算，避免虚报；
   * - **S4 观察项修正**：`walletManager.refund` 对 `amount<=0` 直接返回 true（无款项可退），
   *   若据此置真，会把「0 币失败」（如 mock 演示出片失败）显示成「已退款」。语义上
   *   「是否发生退款」应指「有款项被退回」，故要求 `amount > 0` 且真的退成功。
   */
  private refundRun(job: ShotJob, amount: number, reason: string, run: RunAcc) {
    const ok = walletManager.refund(job.shotId, amount, job.provider, reason)
    if (amount > 0 && ok) run.refunded = true
  }

  /**
   * 落一条执行历史（S3 单一收口；UI 层不各自记录）。
   * - demo：provider 为 mock（演示引擎）→ UI 需标注「演示 · 非真实生成」；
   * - outputRef：可能为 idbref://（持久）或 blob:（刷新后失效），UI 需按失效语义处理；
   * - fire-and-forget：不阻塞串行队列；存储不可用时 runStore 静默降级。
   */
  private recordRun(job: ShotJob, run: RunAcc) {
    const input: RunRecordInput = {
      kind: this.runContext.kind ?? 'generate',
      status: job.status === 'succeeded' ? 'succeeded' : 'failed',
      startedAt: run.startedAt,
      endedAt: Date.now(),
      cost: run.cost,
      refunded: run.refunded,
      demo: job.provider === 'mock',
      provider: job.provider,
      shotId: job.shotId,
      attempt: job.attempt,
      ...(this.runContext.nodeId ? { nodeId: this.runContext.nodeId } : {}),
      ...(job.error ? { error: job.error } : {}),
      ...(job.asset?.url ? { outputRef: job.asset.url } : {}),
    }
    void appendRunRecord(input)
  }
}

export const executorEngine = new ExecutorEngine()
