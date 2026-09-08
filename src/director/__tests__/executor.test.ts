import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTaskKey } from '../../domain/shotJob.ts'
import type { ShotJob } from '../../domain/shotJob.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import { ExecutorEngine } from '../nodes/executorNode.ts'
import { setPollingWindow } from '../../domain/pollingConfig.ts'
import { walletManager } from '../../domain/wallet.ts'
import type { VideoGenRequest, VideoProvider, PollResult } from '../../media/types.ts'

// 测试用极小轮询窗口，避免真实等待
setPollingWindow({ intervalMs: 20, maxAttempts: 50 })

const testVisualPlans: VisualPlan[] = [
  {
    shotId: 's1',
    order: 1,
    kind: 'text2video',
    positive: '9:16 vertical commercial video, product hook close-up',
    negative: 'blurry, low quality',
    ratio: '9:16',
    durationSec: 3,
    caption: '反常识爆款开场',
  },
  {
    shotId: 's2',
    order: 2,
    kind: 'text2video',
    positive: '9:16 vertical commercial video, pain scene wide shot',
    negative: 'blurry, low quality',
    ratio: '9:16',
    durationSec: 3,
    caption: '传统做法又贵又难用',
  },
]

test('任务幂等键：同意图参数产生完全一致的 taskKey，不同参数产生不同 taskKey', async () => {
  const key1 = await computeTaskKey('s1', testVisualPlans[0], 'mock')
  const key2 = await computeTaskKey('s1', testVisualPlans[0], 'mock')
  const key3 = await computeTaskKey('s1', { ...testVisualPlans[0], positive: 'changed prompt' }, 'mock')
  const key4 = await computeTaskKey('s2', testVisualPlans[1], 'mock')

  assert.equal(key1, key2, '相同参数必须产生完全相同的 taskKey')
  assert.notEqual(key1, key3, '正向提示词改变必须产生不同的 taskKey')
  assert.notEqual(key1, key4, '不同镜号必须产生不同的 taskKey')
})

test('ExecutorEngine：任务排队与幂等防重（同镜连点两次只有 1 个 job）', async () => {
  const dummyProvider: VideoProvider = {
    id: 'mock',
    async submit(req: VideoGenRequest) {
      return { taskId: `task_${req.shotId}` }
    },
    async poll(): Promise<PollResult> {
      return { status: 'succeeded', progress: 100 }
    },
    async getAsset(taskId: string) {
      return { shotId: taskId, url: `https://asset.local/${taskId}.webm`, durationSec: 3 }
    },
    estimateCost() {
      return '¥0'
    },
  }

  const engine = new ExecutorEngine(dummyProvider)

  // 首次提交 2 镜
  const jobs1 = await engine.enqueueShots(testVisualPlans, 'mock')
  assert.equal(jobs1.length, 2, '首次提交应有 2 个 job')

  // 再次提交完全相同的计划（模拟连续重复点击）
  const jobs2 = await engine.enqueueShots(testVisualPlans, 'mock')
  assert.equal(jobs2.length, 2, '幂等防重保障：同意图重复提交不得新增重复任务')
  assert.equal(jobs1[0].taskKey, jobs2[0].taskKey, '已存在的任务保持原 taskKey 不变')
})

test('ExecutorEngine：单镜重试机制', async () => {
  const dummyProvider: VideoProvider = {
    id: 'mock',
    async submit(req: VideoGenRequest) {
      return { taskId: `task_${req.shotId}` }
    },
    async poll(): Promise<PollResult> {
      return { status: 'failed', error: '模拟临时网络错误' }
    },
    async getAsset() {
      throw new Error('未就绪')
    },
    estimateCost() {
      return '¥0'
    },
  }

  const engine = new ExecutorEngine(dummyProvider)
  await engine.enqueueShots(testVisualPlans, 'mock')

  // 等待队列执行一轮并失败
  await new Promise((r) => setTimeout(r, 300))

  const jobs = engine.getJobs()
  const s1 = jobs.find((j) => j.shotId === 's1')
  assert.ok(s1, '应存在 s1 任务')
  assert.equal(s1?.status, 'failed', 's1 应标记为 failed')

  // 触发单镜重试
  await engine.retryJob('s1', testVisualPlans)
  const retriedJobs = engine.getJobs()
  const s1Retried = retriedJobs.find((j) => j.shotId === 's1')
  assert.ok(s1Retried, '重试后 s1 依然存在')
  assert.ok((s1Retried?.attempt ?? 0) > 0, 'attempt 次数应递增')
})

test('ExecutorEngine：处理中 retry 不丢任务（竞态回归测试）', async () => {
  // s1 快速失败；s2 先 running 若干轮再成功，用于占据处理窗口
  const s2PollCounts = new Map<string, number>()
  const failingProvider: VideoProvider = {
    id: 'mock',
    async submit(req: VideoGenRequest) {
      return { taskId: `task_${req.shotId}` }
    },
    async poll(taskId: string): Promise<PollResult> {
      if (taskId.includes('s2')) {
        const count = (s2PollCounts.get(taskId) || 0) + 1
        s2PollCounts.set(taskId, count)
        // 前 12 轮 (~250ms+) 保持 running，确保重试落在处理窗口内
        if (count <= 12) {
          return { status: 'running', progress: 50 }
        }
        return { status: 'succeeded', progress: 100 }
      }
      return { status: 'failed', error: 's1 立即失败' }
    },
    async getAsset(taskId: string) {
      return { shotId: taskId, url: `https://asset.local/${taskId}.webm`, durationSec: 3 }
    },
    estimateCost() {
      return '¥0'
    },
  }

  const engine = new ExecutorEngine(failingProvider)
  await engine.enqueueShots(testVisualPlans, 'mock')

  // 等待 s1 首轮失败（轮询间隔 20ms，留足余量）
  await new Promise((r) => setTimeout(r, 200))
  let s1 = engine.getJobs().find((j) => j.shotId === 's1')
  assert.ok(s1, '应存在 s1 任务')
  assert.equal(s1?.status, 'failed', 's1 应在首轮失败')

  // 关键：在 s2 仍在处理中时对 s1 发起重试。
  // 旧实现（fire-and-forget + isProcessing 早退）会让 s1 永久卡在 queued。
  await engine.retryJob('s1', testVisualPlans)

  // 等待 s2 处理完毕、调度循环再次拾起 s1 并执行完毕
  await new Promise((r) => setTimeout(r, 600))
  s1 = engine.getJobs().find((j) => j.shotId === 's1')
  assert.ok(s1, '重试后 s1 依然存在')
  assert.notEqual(s1?.status, 'queued', '处理中发起的重试不得永久卡在 queued（竞态修复）')
  assert.equal(s1?.status, 'failed', 's1 重试后应再次执行并失败（provider 恒定失败）')
  assert.ok((s1?.attempt ?? 0) >= 1, `重试的 attempt 应递增到 >= 1，实际: ${s1?.attempt}`)
})

// ---------------- R4：生成中刷新 → 僵尸任务受控恢复 ----------------

function makeJob(shotId: string, taskKey: string, status: ShotJob['status'], extra: Partial<ShotJob> = {}): ShotJob {
  return {
    shotId,
    taskKey,
    provider: 'mock',
    status,
    attempt: 1,
    progress: status === 'running' ? 60 : 0,
    ...extra,
  }
}

test('R4 水合恢复：running/queued 僵尸任务降级为可重入 queued 并重新调度，FSM 不抛错', async () => {
  const succeedingProvider: VideoProvider = {
    id: 'mock',
    async submit(req: VideoGenRequest) {
      return { taskId: `task_${req.shotId}` }
    },
    async poll(): Promise<PollResult> {
      return { status: 'succeeded', progress: 100 }
    },
    async getAsset(taskId: string) {
      return { shotId: taskId, url: `https://asset.local/${taskId}.webm`, durationSec: 3 }
    },
    estimateCost() {
      return '¥0'
    },
  }

  const engine = new ExecutorEngine(succeedingProvider)
  // 模拟持久化快照：s1 running（刷新中断）、s2 queued、s3 succeeded（终态不动）
  const persisted = [
    makeJob('s1', 'key-s1', 'running', { providerTaskId: 'task_s1' }),
    makeJob('s2', 'key-s2', 'queued'),
    makeJob('s3', 'key-s3', 'succeeded', {
      asset: { shotId: 's3', url: 'https://asset.local/s3.webm', durationSec: 3 },
    }),
  ]

  // 经 notify 监听器捕获「调度前」快照（resumeJobs 内 notify 先于 scheduleProcessing）；
  // 跳过 loadJobs 的原状态通知，以 requeued 标记作为恢复完成的信号
  const captured: { snapshot: Array<ShotJob> | null } = { snapshot: null }
  const unsub = engine.subscribe((jobs) => {
    if (!captured.snapshot && jobs.some((j) => j.requeued === true)) {
      captured.snapshot = jobs.map((j) => ({ ...j }))
    }
  })

  await engine.resumeJobs(persisted, testVisualPlans)
  unsub()
  assert.ok(captured.snapshot, '水合过程应触发一次 notify')

  const s1 = captured.snapshot!.find((j) => j.shotId === 's1')
  const s2 = captured.snapshot!.find((j) => j.shotId === 's2')
  const s3 = captured.snapshot!.find((j) => j.shotId === 's3')

  assert.equal(s1?.status, 'queued', 'running 僵尸任务应受控降级为 queued')
  assert.equal(s1?.requeued, true, '应标记 requeued 供 UI 显示「已恢复，可继续」')
  assert.equal(s2?.status, 'queued', 'queued 任务保持 queued（本就重入）')
  assert.equal(s2?.requeued, true)
  assert.equal(s3?.status, 'succeeded', 'succeeded 终态不受影响')
  assert.equal(s3?.requeued, undefined)

  // 重新调度后 s1/s2 应被执行完毕（mock provider 直接成功）
  await new Promise((r) => setTimeout(r, 400))
  const done = engine.getJobs()
  assert.equal(done.find((j) => j.shotId === 's1')?.status, 'succeeded', '恢复后的任务应被重新执行')
  assert.equal(done.find((j) => j.shotId === 's2')?.status, 'succeeded', '排队任务应被重新执行')
})

test('R4 水合恢复：旧冻结凭据仍在 → 先原路退回，重跑时不双倍冻结', async () => {
  const succeedingProvider: VideoProvider = {
    id: 'mock',
    async submit(req: VideoGenRequest) {
      return { taskId: `task_${req.shotId}` }
    },
    async poll(): Promise<PollResult> {
      return { status: 'succeeded', progress: 100 }
    },
    async getAsset(taskId: string) {
      return { shotId: taskId, url: `https://asset.local/${taskId}.webm`, durationSec: 3 }
    },
    estimateCost() {
      return '¥0'
    },
  }

  // 模拟 kling 计费引擎（freeze 10 / settle 10）
  const engine = new ExecutorEngine(succeedingProvider)
  // 刷新中断前：freeze 已发生但任务 running 未结算 → 手动构造冻结凭据
  walletManager.resetToDefault()
  const before = walletManager.getSnapshot()
  const frozenOk = walletManager.freeze(10, 's1', 'kling', '刷新前遗留冻结（测试构造）')
  assert.equal(frozenOk, true)
  assert.equal(walletManager.hasFrozenRef('s1'), true)

  // notify 快照时点：遗留冻结已释放、重跑尚未开始（不重冻结）——确定性地断言释放行为
  // （以 requeued 标记为恢复完成信号，跳过 loadJobs 的原状态通知）
  let frozenAtNotify: boolean | null = null
  const unsub = engine.subscribe((jobs) => {
    if (frozenAtNotify === null && jobs.some((j) => j.shotId === 's1' && j.requeued === true)) {
      frozenAtNotify = walletManager.hasFrozenRef('s1')
    }
  })

  const persisted = [makeJob('s1', 'key-s1', 'running', { provider: 'kling' })]
  await engine.resumeJobs(persisted, testVisualPlans)
  unsub()

  assert.equal(frozenAtNotify, false, 'resumeJobs 应释放遗留冻结款（重跑前凭据已清）')

  // 等待重新调度执行完毕：正常流程重新 freeze → settle（净消耗一次 kling 单价）
  await new Promise((r) => setTimeout(r, 400))
  const job = engine.getJobs().find((j) => j.shotId === 's1')
  assert.equal(job?.status, 'succeeded', '恢复任务应重新执行成功')
  const afterDone = walletManager.getSnapshot()
  assert.equal(afterDone.frozen, 0, '执行完毕后无残留冻结')
  assert.equal(afterDone.balance, before.balance - 10, '净消耗应恰好一次单价（10），不得双倍')
})

// ---------------- O2：succeeded 单镜重生成（交付页「重新生成此镜」） ----------------

test('O2 succeeded 任务重生成：受控 requeue 重新入队 + 重新冻结，无 FSM 异常', async () => {
  const succeedingProvider: VideoProvider = {
    id: 'mock',
    async submit(req: VideoGenRequest) {
      return { taskId: `task_${req.shotId}` }
    },
    async poll(): Promise<PollResult> {
      return { status: 'succeeded', progress: 100 }
    },
    async getAsset(taskId: string) {
      return { shotId: taskId, url: `https://asset.local/${taskId}.webm`, durationSec: 3 }
    },
    estimateCost() {
      return '¥0'
    },
  }

  const engine = new ExecutorEngine(succeedingProvider)
  walletManager.resetToDefault()

  // 首轮生成成功（kling 计费路径：freeze 10 → settle 10）
  await engine.enqueueShots([testVisualPlans[0]], 'kling')
  await new Promise((r) => setTimeout(r, 400))
  const job = engine.getJobs().find((j) => j.shotId === 's1')
  assert.equal(job?.status, 'succeeded', '首轮应成功')
  assert.equal(walletManager.hasFrozenRef('s1'), false, 'settle 后凭据应清算完毕')

  // 经 notify 快照捕获调度前状态（requeueJob 内 notify 先于 scheduleProcessing）
  const captured: { snapshot: ShotJob | null; frozenAtNotify: boolean | null } = {
    snapshot: null,
    frozenAtNotify: null,
  }
  const unsub = engine.subscribe((jobs) => {
    const j = jobs.find((x) => x.shotId === 's1')
    if (j && !captured.snapshot && j.status === 'queued' && !j.asset) {
      captured.snapshot = { ...j }
      captured.frozenAtNotify = walletManager.hasFrozenRef('s1')
    }
  })

  // 关键：对 succeeded 任务发起重生成 —— 旧实现走 retryJob 会抛 FSM Violation
  await assert.doesNotReject(engine.requeueJob('s1', testVisualPlans, 'regenerate'))
  unsub()
  assert.ok(captured.snapshot, '重生成应先进入 queued 状态')
  assert.equal(captured.snapshot!.attempt, 1, 'attempt 应递增（首轮 0 → 重生成 1）')
  assert.equal(captured.snapshot!.asset, undefined, '旧资产应清空待重新生成')
  assert.equal(captured.frozenAtNotify, false, '重生成排队时旧凭据已清算（重新冻结发生在重跑阶段）')

  // 重新执行：按正常流程重新 freeze → settle，净消耗仍是一次单价
  await new Promise((r) => setTimeout(r, 400))
  const regenerated = engine.getJobs().find((j) => j.shotId === 's1')
  assert.equal(regenerated?.status, 'succeeded', '重生成应再次成功')
  assert.equal(walletManager.hasFrozenRef('s1'), false, '重生成结算后无冻结残留')
  const snap = walletManager.getSnapshot()
  assert.equal(snap.balance, 2000 - 10 - 10, '两轮生成净消耗恰好两次单价')
  assert.equal(snap.frozen, 0)
})

test('O2 requeueJob：非法状态（queued/failed）拒绝 requeue', async () => {
  const engine = new ExecutorEngine()
  await engine.loadJobs([makeJob('s1', 'key-s1', 'failed')])
  await assert.rejects(
    engine.requeueJob('s1', testVisualPlans),
    /FSM Violation/,
    'failed 任务应走 retryJob 而非 requeueJob'
  )
})
