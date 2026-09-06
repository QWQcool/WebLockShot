import test from 'node:test'
import assert from 'node:assert/strict'
import { walletManager, INITIAL_BALANCE, PROVIDER_UNIT_COSTS } from '../wallet.ts'

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
