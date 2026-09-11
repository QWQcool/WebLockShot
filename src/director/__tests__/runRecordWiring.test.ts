/**
 * S3「单一收口」接线测试 —— TODO.md P1 · S3
 *
 * 契约（runRecord.ts）与存储（runStore.ts）各自已有单测；本文件专门验证**执行器真的落记录**：
 * 成功 / 失败+退款 / 余额不足（不虚报消耗）三条路径各落一条，字段（状态 / 耗时 / 费用 /
 * 是否退款 / 失败原因 / 演示标注 / 节点关联）如实。
 *
 * 这也是 S4「🕘 运行历史」抽屉的数据来源回归——若收口被误删，本文件立刻红。
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import { setPollingWindow } from '../../domain/pollingConfig.ts'
import { walletManager } from '../../domain/wallet.ts'
import { ExecutorEngine } from '../nodes/executorNode.ts'
import type { MediaAsset } from '../../domain/shotJob.ts'
import type { VideoProvider } from '../../media/types.ts'
import { __resetRunStoreCacheForTest, listRunRecords } from '../../persist/runStore.ts'
import { installFakeIndexedDb, restoreIndexedDb } from '../../persist/__tests__/fakeIndexedDb.ts'

const testPlan: VisualPlan = {
  shotId: 's1',
  order: 1,
  kind: 'text2video',
  positive: '9:16 vertical commercial video, product hook close-up',
  negative: 'blurry, low quality',
  ratio: '9:16',
  durationSec: 3,
  caption: '反常识爆款开场',
}

const okProvider: VideoProvider = {
  id: 'mock',
  async submit() {
    return { taskId: 'task-ok' }
  },
  async poll() {
    return { status: 'succeeded' as const, progress: 100 }
  },
  async getAsset(taskId: string): Promise<MediaAsset> {
    return { shotId: 's1', url: `blob:mock/${taskId}`, durationSec: 3 }
  },
  estimateCost() {
    return '0 灵感币/镜'
  },
}

const failProvider: VideoProvider = {
  id: 'kling',
  async submit() {
    return { taskId: 'task-fail' }
  },
  async poll() {
    return { status: 'failed' as const, error: '模拟上游 4xx' }
  },
  async getAsset(): Promise<MediaAsset> {
    throw new Error('失败路径不应读取产物')
  },
  estimateCost() {
    return '10 灵感币/镜'
  },
}

/** 演示引擎（mock，0 币/镜）失败：验证「0 币失败不显示为已退款」（S4 观察项修正） */
const failMockProvider: VideoProvider = {
  id: 'mock',
  async submit() {
    return { taskId: 'task-mock-fail' }
  },
  async poll() {
    return { status: 'failed' as const, error: '模拟上游 4xx（演示引擎）' }
  },
  async getAsset(): Promise<MediaAsset> {
    throw new Error('失败路径不应读取产物')
  },
  estimateCost() {
    return '0 灵感币/镜'
  },
}

async function waitFor(predicate: () => boolean | Promise<boolean>, label: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`等待超时：${label}`)
}

const waitForJob = (engine: ExecutorEngine, shotId: string, status: string) =>
  waitFor(() => engine.getJobs().find((j) => j.shotId === shotId)?.status === status, `job ${shotId} → ${status}`)

const waitForRecordCount = (n: number) =>
  waitFor(async () => (await listRunRecords()).length >= n, `run records ≥ ${n}`)

function setup() {
  installFakeIndexedDb()
  __resetRunStoreCacheForTest()
  walletManager.resetToDefault()
  setPollingWindow({ intervalMs: 5, maxAttempts: 10 })
}

afterEach(() => {
  __resetRunStoreCacheForTest()
  walletManager.resetToDefault()
  restoreIndexedDb()
})

describe('ExecutorEngine → RunRecord 单一收口', () => {
  it('成功动作：落一条 succeeded 记录（含节点关联 / 耗时 / 演示标注）', async () => {
    setup()
    const engine = new ExecutorEngine(okProvider)
    engine.setRunContext({ nodeId: 'shape:wls-1', kind: 'generate' })

    await engine.enqueueShots([testPlan], 'mock')
    await waitForJob(engine, 's1', 'succeeded')
    await waitForRecordCount(1)

    const records = await listRunRecords()
    assert.equal(records.length, 1, '一次动作恰好落一条记录')
    const r = records[0]
    assert.equal(r.status, 'succeeded')
    assert.equal(r.nodeId, 'shape:wls-1')
    assert.equal(r.kind, 'generate')
    assert.equal(r.shotId, 's1')
    assert.equal(r.demo, true, 'mock 供应商 → 应标记为演示（UI 标注「演示 · 非真实生成」）')
    assert.equal(r.refunded, false)
    assert.equal(r.cost, 0, 'mock 0 灵感币/镜')
    assert.ok((r.durationMs ?? -1) >= 0, '应派生耗时')
    assert.ok(r.outputRef?.startsWith('blob:'), '应记录输出引用')
  })

  it('失败动作：落一条 failed 记录，如实标记已退款与失败原因（kling 10 币）', async () => {
    setup()
    const engine = new ExecutorEngine(failProvider)
    engine.setRunContext({ nodeId: 'shape:wls-2' }) // kind 缺省 → 'generate'

    await engine.enqueueShots([testPlan], 'kling')
    await waitForJob(engine, 's1', 'failed')
    await waitForRecordCount(1)

    const r = (await listRunRecords())[0]
    assert.equal(r.status, 'failed')
    assert.equal(r.refunded, true, '失败自动退款应如实标记')
    assert.equal(r.cost, 10, 'kling 10 灵感币/镜')
    assert.equal(r.demo, false, 'kling 为真实引擎，不是演示')
    assert.match(r.error ?? '', /模拟上游 4xx/, '应保留失败原因')
    assert.equal(r.nodeId, 'shape:wls-2')
    assert.equal(walletManager.getSnapshot().frozen, 0, '失败后冻结款应已全额退回')
  })

  it('余额不足：不虚报消耗（cost=0 / refunded=false），但仍落一条失败记录', async () => {
    setup()
    // 冻结全部余额，制造 kling(10 币) 余额不足
    const snap = walletManager.getSnapshot()
    assert.equal(walletManager.freeze(snap.balance, 'drain-test', 'kling', '测试：冻结全部余额'), true)

    const engine = new ExecutorEngine(okProvider)
    await engine.enqueueShots([testPlan], 'kling')
    await waitForJob(engine, 's1', 'failed')
    await waitForRecordCount(1)

    const r = (await listRunRecords())[0]
    assert.equal(r.status, 'failed')
    assert.equal(r.cost, 0, '未成功冻结 → 不虚报消耗')
    assert.equal(r.refunded, false, '未发生冻结 → 也无退款')
    assert.match(r.error ?? '', /余额不足/)
  })

  it('0 币失败（演示引擎）不标记为「已退款」（S3 观察项修正）', async () => {
    setup()
    const engine = new ExecutorEngine(failMockProvider)
    await engine.enqueueShots([testPlan], 'mock')
    await waitForJob(engine, 's1', 'failed')
    await waitForRecordCount(1)

    const r = (await listRunRecords())[0]
    assert.equal(r.status, 'failed')
    assert.equal(r.cost, 0, 'mock 0 灵感币/镜')
    assert.equal(r.refunded, false, '0 币无可退 → 不应标记已退款（否则 UI 会误显示「已退款」）')
    assert.equal(r.demo, true)
    assert.match(r.error ?? '', /模拟上游 4xx/)
  })

  it('记录数随动作递增（S4 面板「记录数递增」的数据前提）', async () => {
    setup()
    const engine = new ExecutorEngine(okProvider)
    await engine.enqueueShots([testPlan], 'mock')
    await waitForJob(engine, 's1', 'succeeded')
    await waitForRecordCount(1)

    // 重生成同一镜 → 第二次动作 → 第二条记录
    await engine.requeueJob('s1', [testPlan], 'regenerate')
    await waitForJob(engine, 's1', 'succeeded')
    await waitForRecordCount(2)

    const records = await listRunRecords()
    assert.equal(records.length, 2)
    assert.ok(
      records.every((r) => r.status === 'succeeded'),
      '两条记录都应为 succeeded'
    )
  })
})
