import test from 'node:test'
import assert from 'node:assert/strict'
import { walletManager, INITIAL_BALANCE } from '../wallet.ts'

test('虚拟钱包：初始化账户状态与体验金', () => {
  walletManager.resetToDefault()
  const snapshot = walletManager.getSnapshot()
  assert.equal(snapshot.balance, INITIAL_BALANCE)
  assert.equal(snapshot.frozen, 0)
  assert.equal(snapshot.total, INITIAL_BALANCE)
})

test('虚拟钱包：资费预估正确映射', () => {
  assert.equal(walletManager.getCost('mock', 6), 0)
  assert.equal(walletManager.getCost('comfyui', 6), 0)
  assert.equal(walletManager.getCost('kling', 6), 60)
  assert.equal(walletManager.getCost('jimeng', 6), 48)
})

test('虚拟钱包：两阶段事务 (预冻结 -> 成功核销)', () => {
  walletManager.resetToDefault()
  const refId = 'test-shot-1'
  const cost = 20

  // 1. 预冻结
  const freezeRes = walletManager.freeze(cost, refId, 'kling', '第 1 镜生片测试')
  assert.equal(freezeRes, true)
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE - cost)
  assert.equal(walletManager.getSnapshot().frozen, cost)

  // 2. 成功结算
  walletManager.settle(refId, cost, 'kling', '出片成功核销')
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE - cost)
  assert.equal(walletManager.getSnapshot().frozen, 0)
  assert.equal(walletManager.getSnapshot().total, INITIAL_BALANCE - cost)
})

test('虚拟钱包：两阶段事务 (预冻结 -> 失败全额退款回滚)', () => {
  walletManager.resetToDefault()
  const refId = 'test-shot-failed'
  const cost = 30

  // 1. 预冻结
  const freezeRes = walletManager.freeze(cost, refId, 'jimeng', '第 2 镜测试')
  assert.equal(freezeRes, true)
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE - cost)
  assert.equal(walletManager.getSnapshot().frozen, cost)

  // 2. 失败退款
  walletManager.refund(refId, cost, 'jimeng', '任务异常回滚')
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE)
  assert.equal(walletManager.getSnapshot().frozen, 0)
  assert.equal(walletManager.getSnapshot().total, INITIAL_BALANCE)
})

test('虚拟钱包：余额不足时拦截预冻结', () => {
  walletManager.resetToDefault()
  const freezeRes = walletManager.freeze(999999, 'excessive', 'kling', '超额扣款测试')
  assert.equal(freezeRes, false)
  // 余额保持不变
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE)
})

test('虚拟钱包：模拟充值与流水记录', () => {
  walletManager.resetToDefault()
  walletManager.recharge(500, '测试充值')
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE + 500)
  const txs = walletManager.getTransactions()
  assert.ok(txs.length >= 2)
  assert.equal(txs[0].type, 'recharge')
})

test('虚拟钱包：settle 必须有对应 freeze 记录，无凭据拒绝核销', () => {
  walletManager.resetToDefault()
  const balanceBefore = walletManager.getSnapshot().balance
  const frozenBefore = walletManager.getSnapshot().frozen

  // 无 freeze 记录直接 settle：必须被拒绝，余额与冻结均不变
  const result = walletManager.settle('ghost-ref', 50, 'kling', '无凭据核销测试')
  assert.equal(result, false, '无 freeze 记录的 settle 必须被拒绝')
  assert.equal(walletManager.getSnapshot().balance, balanceBefore, '余额不得被扣减')
  assert.equal(walletManager.getSnapshot().frozen, frozenBefore, '冻结不得变化')
})

test('虚拟钱包：refund 必须有对应 freeze 记录，无凭据拒绝退款', () => {
  walletManager.resetToDefault()
  const balanceBefore = walletManager.getSnapshot().balance

  const result = walletManager.refund('ghost-ref', 50, 'jimeng', '无凭据退款测试')
  assert.equal(result, false, '无 freeze 记录的 refund 必须被拒绝')
  assert.equal(walletManager.getSnapshot().balance, balanceBefore, '余额不得凭空增加')
})

test('虚拟钱包：同一 refId 重复 settle 幂等，不重复扣款', () => {
  walletManager.resetToDefault()
  const refId = 'idempotent-settle'
  const cost = 25

  assert.equal(walletManager.freeze(cost, refId, 'kling', '幂等核销测试'), true)

  // 第一次 settle：核销成功
  assert.equal(walletManager.settle(refId, cost, 'kling', '第一次核销'), true)
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE - cost)
  assert.equal(walletManager.getSnapshot().frozen, 0)

  // 第二次 settle（同 refId）：幂等拒绝，不得重复扣款
  assert.equal(walletManager.settle(refId, cost, 'kling', '重复核销测试'), false)
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE - cost, '重复 settle 不得再次扣款')
  assert.equal(walletManager.getSnapshot().frozen, 0)
})

test('虚拟钱包：settle 消费凭据后 refund 被拒绝（防双重回滚）', () => {
  walletManager.resetToDefault()
  const refId = 'settle-then-refund'
  const cost = 15

  walletManager.freeze(cost, refId, 'jimeng', '双重回滚防护测试')
  walletManager.settle(refId, cost, 'jimeng', '成功核销')

  // 已核销的任务不得再退款
  const result = walletManager.refund(refId, cost, 'jimeng', '已核销后恶意退款')
  assert.equal(result, false, 'settle 后同 refId 的 refund 必须被拒绝')
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE - cost, '余额不得被错误回滚')
})

test('虚拟钱包：失败退款后同 refId 可重新冻结重试', () => {
  walletManager.resetToDefault()
  const refId = 'retry-after-refund'
  const cost = 12

  walletManager.freeze(cost, refId, 'jimeng', '第一次冻结')
  walletManager.refund(refId, cost, 'jimeng', '失败退款')
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE)

  // 退款后凭据已消耗，允许重新冻结（模拟重试）
  assert.equal(walletManager.freeze(cost, refId, 'jimeng', '重试重新冻结'), true)
  walletManager.settle(refId, cost, 'jimeng', '重试成功核销')
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE - cost)
})

test('虚拟钱包：部分核销时保留剩余凭据，凭据余额可追', () => {
  walletManager.resetToDefault()
  const refId = 'partial-settle'
  const cost = 30

  walletManager.freeze(cost, refId, 'kling', '部分核销测试')

  // 只核销 10 币（凭据记录 30 币）：凭据保留剩余 20 币
  assert.equal(walletManager.settle(refId, 10, 'kling', '部分核销'), true)
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE - cost)
  assert.equal(walletManager.getSnapshot().frozen, cost - 10)

  // 剩余凭据仍可完成核销
  assert.equal(walletManager.settle(refId, 20, 'kling', '补齐核销'), true)
  assert.equal(walletManager.getSnapshot().frozen, 0)
  // 凭据已消耗完，再 settle 幂等拒绝
  assert.equal(walletManager.settle(refId, 20, 'kling', '超额核销'), false)
})

test('虚拟钱包：孤儿冻结 TTL 自动回收退回余额', () => {
  walletManager.resetToDefault()
  const refId = 'orphan-freeze'
  const cost = 40

  walletManager.freeze(cost, refId, 'jimeng', '孤儿冻结模拟')
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE - cost)
  assert.equal(walletManager.getSnapshot().frozen, cost)

  // 未到期：不回收
  const sweptEarly = walletManager.sweepOrphanFrozen(30 * 60_000, Date.now() + 1000)
  assert.equal(sweptEarly, 0)
  assert.equal(walletManager.getSnapshot().frozen, cost)

  // 超过 TTL：自动原路退回
  const sweptLate = walletManager.sweepOrphanFrozen(30 * 60_000, Date.now() + 31 * 60_000)
  assert.equal(sweptLate, 1)
  assert.equal(walletManager.getSnapshot().balance, INITIAL_BALANCE, '孤儿冻结应全额退回余额')
  assert.equal(walletManager.getSnapshot().frozen, 0)

  // 回收后同 refId 幂等拒绝
  assert.equal(walletManager.refund(refId, cost, 'jimeng', '重复回收'), false)
})

test('虚拟钱包：订阅者在本页资金操作时收到通知', () => {
  walletManager.resetToDefault()
  let events = 0
  const unsubscribe = walletManager.subscribe(() => {
    events++
  })

  walletManager.recharge(100, '订阅通知测试')
  assert.ok(events >= 1, 'recharge 应触发订阅通知')

  unsubscribe()
  const after = events
  walletManager.recharge(100, '退订后操作')
  assert.equal(events, after, '退订后不再收到通知')
})
