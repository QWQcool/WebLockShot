import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canTransition,
  assertTransition,
  canTransitionJobStatus,
  assertJobStatusTransition,
  circuitBreaker,
} from '../fsm.ts'
import { idempotencyManager } from '../idempotency.ts'

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
