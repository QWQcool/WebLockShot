import test from 'node:test'
import assert from 'node:assert/strict'
import { pollSleep, createPollFailureTolerance, POLL_FAILURE_TOLERANCE } from '../pollingConfig.ts'

/** 无 document 的 Node 环境：pollSleep 应退化为纯 setTimeout 语义 */

// ---------------- O9：轮询连续失败容忍器（miniapp 与主仓共用纯函数） ----------------

test('O9 pollFailureTolerance：连续失败达上限才判死，中途成功即恢复', () => {
  assert.equal(POLL_FAILURE_TOLERANCE, 3)
  const t = createPollFailureTolerance()

  // 前两次失败：不判死，继续轮询
  assert.equal(t.onFailure(), false)
  assert.equal(t.onFailure(), false)
  assert.equal(t.consecutiveFailures, 2)

  // 中途成功：计数清零恢复
  t.onSuccess()
  assert.equal(t.consecutiveFailures, 0)
  assert.equal(t.onFailure(), false, '成功后重新计数')

  // 连续 3 次失败：判死
  assert.equal(t.onFailure(), false)
  assert.equal(t.onFailure(), true, '第 3 次连续失败应判死')
  assert.equal(t.onFailure(), true, '判死后继续失败仍返回 true')
})

test('O9 pollFailureTolerance：容忍上限可注入', () => {
  const t = createPollFailureTolerance(1)
  assert.equal(t.onFailure(), true, '上限 1 → 首次失败即判死')

  const t5 = createPollFailureTolerance(5)
  for (let i = 0; i < 4; i++) assert.equal(t5.onFailure(), false)
  assert.equal(t5.onFailure(), true)
})

test('pollSleep：正常等待后 resolve', async () => {
  const start = Date.now()
  await pollSleep(60)
  assert.ok(Date.now() - start >= 50, '应至少等待约 interval 时长')
})

test('pollSleep：非正间隔立即 resolve', async () => {
  const start = Date.now()
  await pollSleep(0)
  assert.ok(Date.now() - start < 50)
})

test('pollSleep：abort 信号提前唤醒', async () => {
  const controller = new AbortController()
  const start = Date.now()
  setTimeout(() => controller.abort(), 30)
  await pollSleep(10_000, controller.signal)
  assert.ok(Date.now() - start < 5_000, 'abort 应提前结束等待')
})

test('pollSleep：document 桩下「切后台 → 回前台」立即唤醒（手机正确性核心路径）', async () => {
  // 构造最小 document 桩（handlers 数组规避 TS 对回调赋值的控制流收窄）
  let visibilityState = 'hidden'
  const handlers: Array<() => void> = []
  ;(globalThis as { document?: unknown }).document = {
    get visibilityState() {
      return visibilityState
    },
    addEventListener: (_type: string, fn: () => void) => {
      handlers.push(fn)
    },
    removeEventListener: () => {
      handlers.length = 0
    },
  }

  try {
    const start = Date.now()
    const pending = pollSleep(10_000)
    // 回到前台：模拟 visibilitychange 事件
    visibilityState = 'visible'
    assert.ok(handlers.length > 0, '应注册 visibilitychange 监听')
    for (const fn of handlers) fn()
    await pending
    assert.ok(Date.now() - start < 5_000, '回前台应立即唤醒轮询')
  } finally {
    delete (globalThis as { document?: unknown }).document
  }
})

test('pollSleep：全程前台不提前唤醒（保持原节奏）', async () => {
  let visibilityState = 'visible'
  const handlers: Array<() => void> = []
  ;(globalThis as { document?: unknown }).document = {
    get visibilityState() {
      return visibilityState
    },
    addEventListener: (_type: string, fn: () => void) => {
      handlers.push(fn)
    },
    removeEventListener: () => {
      handlers.length = 0
    },
  }

  try {
    const start = Date.now()
    const pending = pollSleep(80)
    // 前台期间触发事件（无 hidden 经历）不应提前唤醒
    for (const fn of handlers) fn()
    await pending
    assert.ok(Date.now() - start >= 60, '无后台经历时保持原始间隔')
  } finally {
    delete (globalThis as { document?: unknown }).document
  }
})
