import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WalletModal } from '../WalletModal.tsx'
import { walletManager, INITIAL_BALANCE } from '../../../domain/wallet.ts'

describe('WalletModal 钱包交互冒烟测试', () => {
  beforeEach(() => {
    walletManager.resetToDefault()
    localStorage.clear()
  })

  it('关闭状态不渲染任何内容', () => {
    const { container } = render(<WalletModal isOpen={false} onClose={() => {}} />)
    expect(container.textContent).toBe('')
  })

  it('打开后展示初始余额与冻结金额', () => {
    render(<WalletModal isOpen onClose={() => {}} />)
    expect(screen.getByText('可用余额')).toBeTruthy()
    expect(screen.getByText('任务冻结中')).toBeTruthy()
    // 初始赠送 2000 币
    expect(screen.getAllByText(/2,000/).length).toBeGreaterThan(0)
  })

  it('点击模拟充值后余额与流水实时更新（订阅机制生效）', () => {
    render(<WalletModal isOpen onClose={() => {}} />)
    const rechargeBtn = screen.getByText('+ 500 币')
    fireEvent.click(rechargeBtn)
    expect(screen.getAllByText(/2,500/).length).toBeGreaterThan(0)
    // 流水列表出现充值记录
    expect(screen.getByText(/模拟快速充值 \+500 灵感币/)).toBeTruthy()
    expect(walletManager.getSnapshot().balance).toBe(INITIAL_BALANCE + 500)
  })

  it('重置按钮恢复初始体验金', () => {
    walletManager.recharge(1000, '测试充值')
    render(<WalletModal isOpen onClose={() => {}} />)
    fireEvent.click(screen.getByText(/重置 2,000 体验金/))
    expect(walletManager.getSnapshot().balance).toBe(INITIAL_BALANCE)
  })
})
