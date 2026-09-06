/**
 * 有限状态机 (FSM) 与边界容错熔断器 (Circuit Breaker)
 * 
 * 核心设计：
 * 1. 严格的状态转移守卫：防止非法状态篡改与回跳
 * 2. 状态终态锁定：已成功的任务绝不重复执行，已取消/超时的任务安全闭环
 * 3. 熔断降级 (Circuit Breaker)：针对远端 API 连续失败触发自动熔断，降级至 Mock / 自建算力并保护用户资金
 */

export type JobState =
  | 'idle'
  | 'validating'
  | 'frozen'
  | 'submitting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'cancelled'
  | 'timed_out'

export const VALID_TRANSITIONS: Record<JobState, JobState[]> = {
  idle: ['validating', 'failed'],
  validating: ['frozen', 'failed'],
  frozen: ['submitting', 'failed', 'refunded'],
  submitting: ['running', 'failed', 'refunded'],
  running: ['succeeded', 'failed', 'timed_out', 'cancelled'],
  failed: ['refunded', 'idle'], // 允许进入退款终态或重试回到 idle
  timed_out: ['refunded'],
  cancelled: ['refunded'],
  succeeded: [], // 终态，不可变
  refunded: [],  // 终态，不可变
}

export function canTransition(from: JobState, to: JobState): boolean {
  if (from === to) return true
  const allowed = VALID_TRANSITIONS[from]
  return allowed ? allowed.includes(to) : false
}

export function assertTransition(from: JobState, to: JobState, context = ''): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `[FSM Violation] 非法状态迁移: 无法从 "${from}" 跳转至 "${to}"。${context ? `上下文: ${context}` : ''}`
    )
  }
}

/**
 * 供应商熔断器 (Circuit Breaker)
 * 针对某一 API 供应商（如 Kling 或 Jimeng）在短时间内连续失败 3 次时切入熔断状态，
 * 避免无意义的重试轰炸与用户资金持续冻结。
 */
export type BreakerStatus = 'closed' | 'open' | 'half_open'

class CircuitBreaker {
  private failureCounts = new Map<string, number>()
  private openedAt = new Map<string, number>()
  private readonly failureThreshold = 3
  private readonly resetTimeoutMs = 30_000 // 30秒后尝试半开

  public recordSuccess(providerId: string): void {
    this.failureCounts.set(providerId, 0)
    this.openedAt.delete(providerId)
  }

  public recordFailure(providerId: string): { tripped: boolean; count: number } {
    const current = (this.failureCounts.get(providerId) || 0) + 1
    this.failureCounts.set(providerId, current)

    if (current >= this.failureThreshold) {
      this.openedAt.set(providerId, Date.now())
      return { tripped: true, count: current }
    }
    return { tripped: false, count: current }
  }

  public getStatus(providerId: string): BreakerStatus {
    const openedTime = this.openedAt.get(providerId)
    if (!openedTime) return 'closed'

    const elapsed = Date.now() - openedTime
    if (elapsed > this.resetTimeoutMs) {
      return 'half_open'
    }
    return 'open'
  }

  public isAvailable(providerId: string): { allowed: boolean; reason?: string } {
    // mock 与 comfyui 自建集群免熔断检查
    if (providerId === 'mock' || providerId === 'comfyui') {
      return { allowed: true }
    }

    const status = this.getStatus(providerId)
    if (status === 'open') {
      const openedTime = this.openedAt.get(providerId) || 0
      const remainingSec = Math.max(1, Math.round((this.resetTimeoutMs - (Date.now() - openedTime)) / 1000))
      return {
        allowed: false,
        reason: `供应商 [${providerId}] 连续失败多次触发自动熔断保护，请等待 ${remainingSec} 秒后重试或切换至 ComfyUI / Mock 模式。`,
      }
    }

    return { allowed: true }
  }

  public reset(providerId?: string): void {
    if (providerId) {
      this.failureCounts.delete(providerId)
      this.openedAt.delete(providerId)
    } else {
      this.failureCounts.clear()
      this.openedAt.clear()
    }
  }
}

export const circuitBreaker = new CircuitBreaker()
