import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EngineStatusBadge } from '../EngineStatusBadge.tsx'
import { circuitBreaker } from '../../../domain/fsm.ts'

describe('EngineStatusBadge 引擎状态可视化冒烟测试', () => {
  beforeEach(() => {
    circuitBreaker.reset()
  })

  it('供应商正常时显示「引擎正常」', () => {
    render(<EngineStatusBadge providerId="kling" />)
    expect(screen.getByText(/引擎正常/)).toBeTruthy()
    expect(screen.getByText(/KLING/)).toBeTruthy()
  })

  it('连续失败触发熔断后显示「熔断保护中」', () => {
    circuitBreaker.recordFailure('jimeng')
    circuitBreaker.recordFailure('jimeng')
    circuitBreaker.recordFailure('jimeng')
    render(<EngineStatusBadge providerId="jimeng" />)
    expect(screen.getByText(/熔断保护中/)).toBeTruthy()
  })

  it('熔断重置窗口过后显示「半开探测中」', () => {
    circuitBreaker.recordFailure('kling')
    circuitBreaker.recordFailure('kling')
    circuitBreaker.recordFailure('kling')
    // 注入：把 openedAt 拨回 31 秒前，模拟重置窗口已过
    const internal = circuitBreaker as unknown as {
      openedAt: Map<string, number>
      resetTimeoutMs: number
    }
    const openedAt = internal.openedAt.get('kling')
    if (openedAt !== undefined) {
      internal.openedAt.set('kling', openedAt - (internal.resetTimeoutMs + 1000))
    }
    render(<EngineStatusBadge providerId="kling" />)
    expect(screen.getByText(/半开探测中/)).toBeTruthy()
  })
})
