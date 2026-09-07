import React, { useState, useEffect } from 'react'
import {
  walletManager,
  type WalletTransaction,
  PROVIDER_UNIT_COSTS,
} from '../../domain/wallet.ts'

type Props = {
  isOpen: boolean
  onClose: () => void
}

export const WalletModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [snapshot, setSnapshot] = useState(walletManager.getSnapshot())
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [rechargeTip, setRechargeTip] = useState<string | null>(null)

  const refresh = () => {
    setSnapshot(walletManager.getSnapshot())
    setTransactions(walletManager.getTransactions())
  }

  useEffect(() => {
    if (isOpen) {
      refresh()
      setRechargeTip(null)
    }
    // 订阅钱包变更：本页资金操作与其它标签页 storage 同步均实时刷新
    const unsubscribe = walletManager.subscribe(() => {
      setSnapshot(walletManager.getSnapshot())
      setTransactions(walletManager.getTransactions())
    })
    return unsubscribe
  }, [isOpen])

  if (!isOpen) return null

  const handleRecharge = (amount: number) => {
    walletManager.recharge(amount, `模拟快速充值 +${amount} 灵感币`)
    refresh()
    setRechargeTip(`已成功充值 +${amount} 灵感币！`)
    setTimeout(() => setRechargeTip(null), 3000)
  }

  const handleReset = () => {
    walletManager.resetToDefault()
    refresh()
    setRechargeTip('已重置钱包并补齐 2,000 初始体验金！')
    setTimeout(() => setRechargeTip(null), 3000)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card wallet-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '680px', width: '90%' }}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-icon">💰</span>
            <div>
              <h3>虚拟钱包中心 (两阶段资金结算)</h3>
              <p className="modal-sub">
                工业级生片资金闭环：生片前预冻结，成功核销，失败/超时/取消 100% 原路秒退
              </p>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* 生产级充值与额度仿真占位说明 */}
          <div
            className="security-notice-box"
            style={{
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '8px',
              padding: '0.65rem 0.9rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.6rem',
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>⚠️</span>
            <div style={{ fontSize: '0.78rem', color: '#fbbf24', lineHeight: 1.5 }}>
              <strong>生产级资金闭环仿真占位说明：</strong>
              本界面用于在前端完整模拟工业级两阶段结算体系（预冻结 → 成功核销 / 异常全额退还）。当前所有充值额度与代币消耗均为<strong>模拟演示体验金</strong>，非真实人民币扣费。
            </div>
          </div>

          {rechargeTip && (
            <div className="token-save-hint" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
              ✓ {rechargeTip}
            </div>
          )}

          {/* 账户资产卡片 */}
          <div className="wallet-balance-row">
            <div className="balance-box">
              <span className="balance-label">可用余额</span>
              <div className="balance-val main-balance">{snapshot.balance.toLocaleString()} <small>币</small></div>
              <span className="balance-sub">随时可用于新镜头生成</span>
            </div>

            <div className="balance-box">
              <span className="balance-label">任务冻结中</span>
              <div className="balance-val frozen-balance">{snapshot.frozen.toLocaleString()} <small>币</small></div>
              <span className="balance-sub">渲染中临时锁定，失败立退</span>
            </div>

            <div className="balance-box">
              <span className="balance-label">资产总计</span>
              <div className="balance-val total-balance">{snapshot.total.toLocaleString()} <small>币</small></div>
              <span className="balance-sub">可用 + 冻结中总额</span>
            </div>
          </div>

          {/* 快速充值操作与资费 */}
          <div className="wallet-action-row">
            <div className="recharge-buttons">
              <span className="action-label">模拟充值：</span>
              <button
                type="button"
                className="btn-recharge"
                onClick={() => handleRecharge(500)}
              >
                + 500 币
              </button>
              <button
                type="button"
                className="btn-recharge primary"
                onClick={() => handleRecharge(1000)}
              >
                + 1,000 币
              </button>
              <button
                type="button"
                className="btn-recharge-reset"
                onClick={handleReset}
              >
                重置 2,000 体验金
              </button>
            </div>

            <div className="costs-guide">
              <span>可灵: {PROVIDER_UNIT_COSTS.kling}币/镜</span>
              <span>即梦: {PROVIDER_UNIT_COSTS.jimeng}币/镜</span>
              <span className="free-tag">ComfyUI / Mock: 0 免费</span>
            </div>
          </div>

          {/* 流水明细列表 */}
          <div className="wallet-tx-section">
            <div className="tx-section-header">
              <h4>📋 资金收支与退费审计流水 ({transactions.length})</h4>
            </div>

            <div className="tx-list-container">
              {transactions.length === 0 ? (
                <div className="empty-tx-tip">暂无交易记录</div>
              ) : (
                transactions.map((tx) => {
                  const isPositive = tx.amount > 0
                  const isZero = tx.amount === 0
                  return (
                    <div key={tx.id} className={`tx-item tx-type-${tx.type}`}>
                      <div className="tx-left">
                        <span className={`tx-type-tag type-${tx.type}`}>
                          {tx.type === 'freeze'
                            ? '🔒 预冻结'
                            : tx.type === 'settle'
                            ? '✓ 正式划扣'
                            : tx.type === 'refund'
                            ? '↩ 全额退款'
                            : tx.type === 'recharge'
                            ? '⚡ 模拟充值'
                            : '🎁 初始赠送'}
                        </span>
                        <span className="tx-desc">{tx.description}</span>
                      </div>

                      <div className="tx-right">
                        <span className={`tx-amount ${isPositive ? 'plus' : isZero ? 'zero' : 'minus'}`}>
                          {isPositive ? `+${tx.amount}` : tx.amount} 币
                        </span>
                        <span className="tx-time">
                          {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <span style={{ fontSize: '0.75rem', color: 'var(--wls-text-muted)' }}>
            数据本地持久化存储（localStorage），刷新不丢失
          </span>
          <button type="button" className="btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
