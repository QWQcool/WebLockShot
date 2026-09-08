import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canTransition,
  assertTransition,
  canTransitionJobStatus,
  assertJobStatusTransition,
  canRequeueJobStatus,
  assertJobRequeue,
  circuitBreaker,
} from '../fsm.ts'
import { idempotencyManager } from '../idempotency.ts'
import { setPollingWindow } from '../pollingConfig.ts'

test('FSM 有限状态机：允许合法状态迁移', () => {
  assert.equal(canTransition('idle', 'validating'), true)
  assert.equal(canTransition('validating', 'frozen'), true)
  assert.equal(canTransition('frozen', 'submitting'), true)
  assert.equal(canTransition('submitting', 'running'), true)
  assert.equal(canTransition('running', 'succeeded'), true)
  assert.equal(canTransition('running', 'failed'), true)
  assert.equal(canTransition('failed', 'refunded'), true)
})

test('FSM 有限状态机：拦截非法逆向与越级迁移', () => {
  assert.equal(canTransition('succeeded', 'running'), false)
  assert.equal(canTransition('succeeded', 'idle'), false)
  assert.equal(canTransition('refunded', 'submitting'), false)

  assert.throws(() => {
    assertTransition('succeeded', 'running', '测试非法变更')
  }, /FSM Violation/)
})

test('FSM 有限状态机：终态自迁移必须被拒绝（堵 from===to 洞）', () => {
  // 旧实现 canTransition(from === to) 恒为 true，导致 succeeded -> succeeded 也放行
  assert.equal(canTransition('succeeded', 'succeeded'), false, 'succeeded 终态不得自迁移')
  assert.equal(canTransition('refunded', 'refunded'), false, 'refunded 终态不得自迁移')

  assert.throws(() => {
    assertTransition('succeeded', 'succeeded', '终态自迁移测试')
  }, /FSM Violation/)

  // 非终态自迁移仍然放行（幂等写入）
  assert.equal(canTransition('running', 'running'), true)
})

test('FSM 有限状态机：ShotJob.status 转移表合法迁移放行', () => {
  assert.equal(canTransitionJobStatus('queued', 'running'), true)
  assert.equal(canTransitionJobStatus('queued', 'failed'), true)
  assert.equal(canTransitionJobStatus('running', 'succeeded'), true)
  assert.equal(canTransitionJobStatus('running', 'failed'), true)
  assert.equal(canTransitionJobStatus('failed', 'queued'), true, '失败后允许重试重新入队')

  // 非终态幂等自迁移放行
  assert.equal(canTransitionJobStatus('queued', 'queued'), true)
  assert.equal(canTransitionJobStatus('running', 'running'), true)
})

test('FSM 有限状态机：ShotJob.status 非法迁移与终态锁定', () => {
  assert.equal(canTransitionJobStatus('succeeded', 'succeeded'), false, 'succeeded 终态不得再转移')
  assert.equal(canTransitionJobStatus('succeeded', 'failed'), false)
  assert.equal(canTransitionJobStatus('succeeded', 'running'), false)
  assert.equal(canTransitionJobStatus('queued', 'succeeded'), false, '不得跳过 running 直达成功')
  assert.equal(canTransitionJobStatus('running', 'queued'), false, '运行中不得回退到排队')

  assert.throws(() => {
    assertJobStatusTransition('succeeded', 'running', '终态篡改测试')
  }, /FSM Violation/)

  assert.throws(() => {
    assertJobStatusTransition('queued', 'succeeded', '越级迁移测试')
  }, /FSM Violation/)
})

test('熔断器 CircuitBreaker：连续失败 3 次触发熔断并在恢复前阻断任务', () => {
  circuitBreaker.reset()
  const p = 'kling'

  assert.equal(circuitBreaker.isAvailable(p).allowed, true)

  circuitBreaker.recordFailure(p)
  assert.equal(circuitBreaker.isAvailable(p).allowed, true)

  circuitBreaker.recordFailure(p)
  assert.equal(circuitBreaker.isAvailable(p).allowed, true)

  // 第 3 次失败触发熔断
  const res3 = circuitBreaker.recordFailure(p)
  assert.equal(res3.tripped, true)

  const check = circuitBreaker.isAvailable(p)
  assert.equal(check.allowed, false)
  assert.match(check.reason || '', /自动熔断保护/)

  // 成功后重置
  circuitBreaker.recordSuccess(p)
  assert.equal(circuitBreaker.isAvailable(p).allowed, true)
})

test('任务幂等性与防连击锁：In-flight 互斥锁定与释放', () => {
  idempotencyManager.clear()
  const key = idempotencyManager.generateKey({
    intent: 'test-gen',
    providerId: 'mock',
    prompt: 'luxury diamond ring 8k',
    durationSec: 5,
  })

  // 第一次获取锁应成功
  const first = idempotencyManager.acquireLock(key)
  assert.equal(first.success, true)

  // 在未释放前再次连击提交，应被拦截
  const second = idempotencyManager.acquireLock(key)
  assert.equal(second.success, false)
  assert.match(second.reason || '', /已在后台执行中/)

  // 释放锁后可再次获取
  idempotencyManager.releaseLock(key)
  const third = idempotencyManager.acquireLock(key)
  assert.equal(third.success, true)
  idempotencyManager.releaseLock(key)
})

// ---------------- O1：幂等锁 TTL 与轮询窗口对齐 ----------------

test('O1 幂等锁：TTL 与轮询窗口对齐（不再固定 120s 提前释放）', () => {
  // 20 分钟轮询窗口（400 次 x 3s）→ TTL 必须 >= 轮询窗口时长 + 缓冲
  setPollingWindow({ intervalMs: 3000, maxAttempts: 400 })
  const ttl = idempotencyManager.getLockTtlMs()
  const windowMs = 3000 * 400
  assert.ok(ttl >= windowMs, `TTL (${ttl}ms) 必须 >= 轮询窗口 (${windowMs}ms)`)
  assert.ok(ttl < windowMs + 120_000 + 1000, 'TTL = 窗口 + 缓冲（约 60s），不无限放大')

  // 恢复默认窗口（200 次 x 3s = 10 分钟）
  setPollingWindow({ intervalMs: 3000, maxAttempts: 200 })
})

test('O1 幂等锁：长轮询场景锁不提前释放；看门狗超 TTL 后仍兜底释放', async () => {
  idempotencyManager.clear()
  const key = 'o1-long-poll-key'

  // 默认 TTL（10min 窗口 ≈ 660s）下，模拟轮询开始后 200ms：锁必须仍被持有
  const first = idempotencyManager.acquireLock(key)
  assert.equal(first.success, true)
  await new Promise((r) => setTimeout(r, 200))
  const second = idempotencyManager.acquireLock(key)
  assert.equal(second.success, false, '长轮询进行中（< TTL）锁不得被看门狗提前释放')
  idempotencyManager.releaseLock(key)

  // 看门狗兜底：显式注入极短 TTL，超时后锁自动释放，可重新获取
  const key2 = 'o1-watchdog-key'
  const short = idempotencyManager.acquireLock(key2, 50)
  assert.equal(short.success, true)
  await new Promise((r) => setTimeout(r, 120))
  const reAcquire = idempotencyManager.acquireLock(key2, 50)
  assert.equal(reAcquire.success, true, '超 TTL 后看门狗应兜底释放锁（防死锁）')
  idempotencyManager.releaseLock(key2)
})

test('O1 幂等锁：多标签页 storage CAS（尽力而为）与释放清理', () => {
  idempotencyManager.clear()
  // 构造 localStorage 桩（Node 环境无 localStorage）
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }

  try {
    const key = 'o1-crosstab-key'
    const first = idempotencyManager.acquireLock(key)
    assert.equal(first.success, true)
    // 本页持锁后应写入锁元数据（带 token + 时间戳）
    assert.ok(store.get(`weblockshot.idempotency.lock.${key}`), '应写入跨页锁元数据')

    // 释放后元数据应被清理
    idempotencyManager.releaseLock(key)
    assert.equal(store.get(`weblockshot.idempotency.lock.${key}`), undefined, '释放后应清理跨页锁元数据')

    // 模拟另一标签页的新鲜锁元数据 → 本页拒绝获取（尽力而为第二道防线）
    store.set(`weblockshot.idempotency.lock.${key}`, JSON.stringify({ token: 'other-tab', at: Date.now() }))
    const blocked = idempotencyManager.acquireLock(key)
    assert.equal(blocked.success, false, '检测到其它标签页新鲜锁应拒绝')
    assert.match(blocked.reason || '', /其它标签页/)
    store.delete(`weblockshot.idempotency.lock.${key}`)

    // 陈旧锁元数据（超 TTL）不阻塞
    store.set(`weblockshot.idempotency.lock.${key}`, JSON.stringify({ token: 'stale-tab', at: 0 }))
    const stale = idempotencyManager.acquireLock(key)
    assert.equal(stale.success, true, '陈旧锁元数据不应阻塞获取')
    idempotencyManager.releaseLock(key)
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage
    idempotencyManager.clear()
  }
})

// ---------------- R4/O2：受控 requeue 语义 ----------------

test('R4/O2 受控 requeue：仅 running/succeeded 放行，queued/failed/succeeded 常规路径不变', () => {
  assert.equal(canRequeueJobStatus('running'), true)
  assert.equal(canRequeueJobStatus('succeeded'), true)
  assert.equal(canRequeueJobStatus('queued'), false)
  assert.equal(canRequeueJobStatus('failed'), false, 'failed 走 retryJob 的 failed→queued 路径')
  assert.equal(canRequeueJobStatus('idle'), false)

  // 常规转移表保持终态锁定（不受 requeue API 影响）
  assert.equal(canTransitionJobStatus('succeeded', 'queued'), false, '常规写入路径 succeeded 仍不可变')
  assert.equal(canTransitionJobStatus('running', 'queued'), false, '常规写入路径 running 仍不可回退')
  assert.throws(() => assertJobRequeue('failed', '非法 requeue'), /FSM Violation/)
  assert.doesNotThrow(() => assertJobRequeue('succeeded', '交付页重生成'))
})
