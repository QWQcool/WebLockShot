import React, { useEffect, useState } from 'react'
import { circuitBreaker, type BreakerStatus } from '../../domain/fsm.ts'
import type { VideoProviderId } from '../../domain/shotJob.ts'

/**
 * 引擎状态可视化徽章 (Engine Status Badge)
 *
 * 实时呈现当前供应商的熔断器状态：closed(正常) / open(熔断) / half_open(半开探测)，
 * 与 circuitBreaker 单一事实源对齐，杜绝「显示正常实际熔断」的误导。
 */

const STATUS_META: Record<BreakerStatus, { label: string; className: string; title: string }> = {
  closed: {
    label: '引擎正常',
    className: 'engine-status-badge status-closed',
    title: '该供应商服务正常，可正常派发生片任务',
  },
  open: {
    label: '熔断保护中',
    className: 'engine-status-badge status-open',
    title: '该供应商连续失败触发熔断，任务将被拦截；等待重置窗口后自动进入半开探测',
  },
  half_open: {
    label: '半开探测中',
    className: 'engine-status-badge status-half-open',
    title: '熔断重置窗口已过，允许尝试派发；成功则恢复，失败将重新熔断',
  },
}

export const EngineStatusBadge: React.FC<{ providerId: VideoProviderId; pollMs?: number }> = ({
  providerId,
  pollMs = 5000,
}) => {
  const [status, setStatus] = useState<BreakerStatus>(() => circuitBreaker.getStatus(providerId))

  useEffect(() => {
    setStatus(circuitBreaker.getStatus(providerId))
    const timer = setInterval(() => {
      setStatus(circuitBreaker.getStatus(providerId))
    }, pollMs)
    return () => clearInterval(timer)
  }, [providerId, pollMs])

  const meta = STATUS_META[status]
  return (
    <span className={meta.className} title={meta.title}>
      <span className="engine-status-dot" aria-hidden="true" />
      {providerId.toUpperCase()} · {meta.label}
    </span>
  )
}
