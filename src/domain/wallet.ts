/**
 * 虚拟钱包与计费结算两阶段事务系统 (Wallet & 2-Phase Billing Ledger)
 * 
 * 核心设计：
 * 1. 虚拟代币 (灵感币 / Token)：可灵 10 币/镜，即梦 8 币/镜，ComfyUI 0 币 (自有显卡)，Mock 0 币
 * 2. 两阶段提交事务 (Two-Phase Commit)：
 *    - 阶段 1 (Freeze)：任务开始前预校验并冻结预估金额，避免透支并发
 *    - 阶段 2A (Settle)：出片成功后正式划扣冻结款项，记录结账流水
 *    - 阶段 2B (Refund)：出片失败、超时或取消，全额解冻并原路退回，记录回滚流水
 * 3. 完整资金交易流水账单 (Audit Ledger)
 */

export type TransactionType = 'initial' | 'recharge' | 'freeze' | 'settle' | 'refund'

export type WalletTransaction = {
  id: string
  timestamp: number
  type: TransactionType
  amount: number
  balanceAfter: number
  frozenAfter: number
  refId?: string
  providerId?: string
  description: string
}

export type WalletState = {
  balance: number
  frozen: number
  transactions: WalletTransaction[]
}

export const WALLET_STORAGE_KEY = 'weblockshot.wallet_ledger'
export const INITIAL_BALANCE = 2000 // 初始赠送 2,000 灵感币

export const PROVIDER_UNIT_COSTS: Record<string, number> = {
  mock: 0,
  comfyui: 0,
  jimeng: 8,
  kling: 10,
}

class WalletManager {
  private state: WalletState

  constructor() {
    this.state = this.loadFromStorage()
  }

  private loadFromStorage(): WalletState {
    try {
      if (typeof window === 'undefined') {
        return { balance: INITIAL_BALANCE, frozen: 0, transactions: [] }
      }
      const raw = localStorage.getItem(WALLET_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as WalletState
        if (typeof parsed.balance === 'number' && typeof parsed.frozen === 'number') {
          return parsed
        }
      }
    } catch {
      // ignore
    }

    const initial: WalletState = {
      balance: INITIAL_BALANCE,
      frozen: 0,
      transactions: [
        {
          id: `tx_${Date.now()}_init`,
          timestamp: Date.now(),
          type: 'initial',
          amount: INITIAL_BALANCE,
          balanceAfter: INITIAL_BALANCE,
          frozenAfter: 0,
          description: '注册体验初始赠送灵感币',
        },
      ],
    }
    this.persist(initial)
    return initial
  }

  private persist(state: WalletState) {
    this.state = state
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(state))
      }
    } catch {
      // ignore
    }
  }

  public getSnapshot(): { balance: number; frozen: number; total: number } {
    return {
      balance: this.state.balance,
      frozen: this.state.frozen,
      total: this.state.balance + this.state.frozen,
    }
  }

  public getTransactions(): WalletTransaction[] {
    return [...this.state.transactions].reverse()
  }

  public getCost(providerId: string, count = 1): number {
    const unit = PROVIDER_UNIT_COSTS[providerId] ?? 0
    return unit * count
  }

  /**
   * 阶段 1：预扣款/冻结 (Freeze)
   * 返回 true 表示资金充足并成功冻结；返回 false 表示余额不足
   */
  public freeze(amount: number, refId: string, providerId: string, description: string): boolean {
    if (amount <= 0) return true
    if (this.state.balance < amount) {
      return false
    }

    const nextBalance = this.state.balance - amount
    const nextFrozen = this.state.frozen + amount
    const tx: WalletTransaction = {
      id: `tx_${Date.now()}_frz_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      type: 'freeze',
      amount: -amount,
      balanceAfter: nextBalance,
      frozenAfter: nextFrozen,
      refId,
      providerId,
      description: `[预冻结] ${description}`,
    }

    this.persist({
      balance: nextBalance,
      frozen: nextFrozen,
      transactions: [...this.state.transactions, tx],
    })
    return true
  }

  /**
   * 阶段 2A：成功履约结算 (Settle)
   * 从 frozen 中正式核销
   */
  public settle(refId: string, amount: number, providerId: string, description: string): void {
    if (amount <= 0) return
    const actualDeductFromFrozen = Math.min(this.state.frozen, amount)
    const nextFrozen = Math.max(0, this.state.frozen - actualDeductFromFrozen)
    const tx: WalletTransaction = {
      id: `tx_${Date.now()}_stl_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      type: 'settle',
      amount: -actualDeductFromFrozen,
      balanceAfter: this.state.balance,
      frozenAfter: nextFrozen,
      refId,
      providerId,
      description: `[正式核销] ${description}`,
    }

    this.persist({
      balance: this.state.balance,
      frozen: nextFrozen,
      transactions: [...this.state.transactions, tx],
    })
  }

  /**
   * 阶段 2B：失败回滚解冻 (Refund)
   * 将 frozen 款项原路退回 balance
   */
  public refund(refId: string, amount: number, providerId: string, reason: string): void {
    if (amount <= 0) return
    const actualRefund = Math.min(this.state.frozen, amount)
    const nextFrozen = Math.max(0, this.state.frozen - actualRefund)
    const nextBalance = this.state.balance + actualRefund

    const tx: WalletTransaction = {
      id: `tx_${Date.now()}_ref_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      type: 'refund',
      amount: actualRefund,
      balanceAfter: nextBalance,
      frozenAfter: nextFrozen,
      refId,
      providerId,
      description: `[全额退款] ${reason}`,
    }

    this.persist({
      balance: nextBalance,
      frozen: nextFrozen,
      transactions: [...this.state.transactions, tx],
    })
  }

  /**
   * 模拟充值
   */
  public recharge(amount: number, description = '手动模拟充值'): void {
    if (amount <= 0) return
    const nextBalance = this.state.balance + amount
    const tx: WalletTransaction = {
      id: `tx_${Date.now()}_rec_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      type: 'recharge',
      amount,
      balanceAfter: nextBalance,
      frozenAfter: this.state.frozen,
      description,
    }

    this.persist({
      balance: nextBalance,
      frozen: this.state.frozen,
      transactions: [...this.state.transactions, tx],
    })
  }

  /**
   * 重置账户（测试/演示用）
   */
  public resetToDefault(): void {
    const initial: WalletState = {
      balance: INITIAL_BALANCE,
      frozen: 0,
      transactions: [
        {
          id: `tx_${Date.now()}_reset`,
          timestamp: Date.now(),
          type: 'initial',
          amount: INITIAL_BALANCE,
          balanceAfter: INITIAL_BALANCE,
          frozenAfter: 0,
          description: '系统重置并补齐测试体验币',
        },
      ],
    }
    this.persist(initial)
  }
}

export const walletManager = new WalletManager()
