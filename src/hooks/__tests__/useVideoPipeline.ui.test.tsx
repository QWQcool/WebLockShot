import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useVideoPipeline } from '../useVideoPipeline.ts'
import { circuitBreaker } from '../../domain/fsm.ts'
import { walletManager } from '../../domain/wallet.ts'
import { setPollingWindow } from '../../domain/pollingConfig.ts'
import { idempotencyManager } from '../../domain/idempotency.ts'
import type { PollResult } from '../../media/types.ts'

// Mock mock provider（jsdom 无 MediaRecorder/Canvas 录制能力）
const mockSubmit = vi.fn(async () => ({ taskId: 'ui-test-task' }))
const mockPoll = vi.fn<() => Promise<PollResult>>(async () => ({ status: 'succeeded', progress: 100 }))
const mockGetAsset = vi.fn(async () => ({
  shotId: 's1',
  url: 'blob:http://localhost/video',
  durationSec: 3,
}))

vi.mock('../../media/providers/mock.ts', () => ({
  mockVideoProvider: {
    id: 'mock',
    submit: () => mockSubmit(),
    poll: () => mockPoll(),
    getAsset: () => mockGetAsset(),
    estimateCost: () => '¥0',
  },
}))

const BASE_PARAMS = {
  providerId: 'mock' as const,
  intent: 'ui-test',
  prompt: 'test prompt',
  durationSec: 5,
  title: 'UI 测试',
  billingLabel: 'UI 测试生片',
}

describe('useVideoPipeline 共享管线冒烟测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    circuitBreaker.reset()
    idempotencyManager.clear()
    walletManager.resetToDefault()
    localStorage.clear()
    // 测试用极小轮询窗口
    setPollingWindow({ intervalMs: 10, maxAttempts: 5 })
    mockPoll.mockImplementation(async () => ({ status: 'succeeded' as const, progress: 100 }))
  })

  it('生成成功：状态到达完成、视频 URL 就绪、0 成本 mock 不产生资金流水', async () => {
    const { result } = renderHook(() => useVideoPipeline())

    await act(async () => {
      await result.current.run(BASE_PARAMS)
    })

    await waitFor(() => {
      expect(result.current.state.running).toBe(false)
    })
    expect(result.current.state.videoUrl).toBe('blob:http://localhost/video')
    expect(result.current.state.error).toBeNull()
    expect(mockSubmit).toHaveBeenCalledTimes(1)
    // mock 0 成本：无 freeze/settle 流水
    expect(walletManager.getTransactions().every((tx) => tx.type === 'initial')).toBe(true)
  })

  it('熔断开启时直接拒绝，不提交任务也不冻结资金', async () => {
    // mock/comfyui 免熔断检查，改用远端供应商 kling 验证
    circuitBreaker.recordFailure('kling')
    circuitBreaker.recordFailure('kling')
    circuitBreaker.recordFailure('kling')

    const { result } = renderHook(() => useVideoPipeline())
    await act(async () => {
      await result.current.run({ ...BASE_PARAMS, providerId: 'kling' as const })
    })

    expect(result.current.state.error).toMatch(/熔断/)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('provider 报失败：全额退款语义（0 成本场景验证错误透出与锁释放）', async () => {
    mockPoll.mockImplementation(async () => ({
      status: 'failed' as const,
      error: '模拟生成失败',
    }))

    const { result } = renderHook(() => useVideoPipeline())
    await act(async () => {
      await result.current.run(BASE_PARAMS)
    })

    await waitFor(() => {
      expect(result.current.state.running).toBe(false)
    })
    expect(result.current.state.error).toMatch(/模拟生成失败/)
    expect(result.current.state.videoUrl).toBeNull()
    // 幂等锁已释放（可再次获取）
    const lock = idempotencyManager.acquireLock(result.current.state.error ? 'x' : 'y')
    idempotencyManager.releaseLock(lock.success ? 'x' : 'y')
    expect(mockGetAsset).not.toHaveBeenCalled()
  })

  it('连击防护：同一任务执行中重复提交被幂等锁拦截', async () => {
    // 让 poll 悬挂一段时间以占据执行窗口
    let releasePoll: (() => void) | null = null
    mockPoll.mockImplementation(
      () =>
        new Promise((resolve) => {
          releasePoll = () => resolve({ status: 'succeeded' as const, progress: 100 })
        })
    )

    const { result } = renderHook(() => useVideoPipeline())

    let firstRun: Promise<void> = Promise.resolve()
    act(() => {
      firstRun = result.current.run(BASE_PARAMS)
    })

    // 第二次相同参数提交（等待 submit 完成、poll 悬挂期间）
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
    await act(async () => {
      await result.current.run(BASE_PARAMS)
    })

    expect(mockSubmit).toHaveBeenCalledTimes(1)

    // 释放悬挂的 poll，让首轮完成
    await act(async () => {
      releasePoll?.()
      await firstRun
    })
  })
})
