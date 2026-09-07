import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTaskKey } from '../../domain/shotJob.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import { ExecutorEngine } from '../nodes/executorNode.ts'
import { setPollingWindow } from '../../domain/pollingConfig.ts'
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
