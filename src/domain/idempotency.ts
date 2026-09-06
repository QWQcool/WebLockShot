/**
 * 任务幂等性与防连击防重管理器 (Idempotency & Debounce Manager)
 * 
 * 核心设计：
 * 1. 结构化特征哈希：同入参、同意图在指定时间窗口内生成恒定幂等键
 * 2. In-flight 互斥执行锁：同一任务未完结前，拦截用户连击并阻止二次派发
 * 3. 结果缓存与短路保护：在有效缓存窗口内支持瞬间幂等复用，省算力防风暴
 */

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // 转换为 32 位整数
  }
  return Math.abs(hash).toString(36)
}

export type IdempotentPayload = {
  intent: string
  shotId?: string
  providerId: string
  prompt: string
  durationSec?: number
  ratio?: string
  extra?: string
}

class IdempotencyManager {
  private inFlightLocks = new Map<string, { timestamp: number; timeoutTimer: any }>()
  private completedCache = new Map<string, { timestamp: number; result: any }>()
  private readonly defaultLockTimeoutMs = 120_000 // 锁最大保持 2 分钟，防死锁
  private readonly cacheTtlMs = 600_000 // 已完成缓存保留 10 分钟

  /**
   * 生成规范化幂等键
   */
  public generateKey(payload: IdempotentPayload): string {
    const norm = [
      payload.intent.trim().toLowerCase(),
      (payload.shotId || '').trim(),
      payload.providerId.trim().toLowerCase(),
      payload.prompt.trim().replace(/\s+/g, ' '),
      payload.durationSec ?? 5,
      payload.ratio ?? '9:16',
      payload.extra || '',
    ].join('|#|')

    return `idemp_${simpleHash(norm)}`
  }

  /**
   * 尝试获取执行锁（防连击与防重复提交）
   * 如果该 key 正在执行中，返回 success: false
   */
  public acquireLock(key: string, lockTimeoutMs = this.defaultLockTimeoutMs): { success: boolean; reason?: string } {
    if (this.inFlightLocks.has(key)) {
      const entry = this.inFlightLocks.get(key)!
      const elapsed = Math.round((Date.now() - entry.timestamp) / 1000)
      return {
        success: false,
        reason: `任务 [${key}] 已在后台执行中（已运行 ${elapsed} 秒），请勿重复连击或同时提交相同任务。`,
      }
    }

    // 设置看门狗自动释放锁，避免异常挂起死锁
    const timer = setTimeout(() => {
      this.releaseLock(key)
    }, lockTimeoutMs)

    this.inFlightLocks.set(key, {
      timestamp: Date.now(),
      timeoutTimer: timer,
    })

    return { success: true }
  }

  /**
   * 释放执行锁
   */
  public releaseLock(key: string): void {
    const entry = this.inFlightLocks.get(key)
    if (entry) {
      clearTimeout(entry.timeoutTimer)
      this.inFlightLocks.delete(key)
    }
  }

  /**
   * 记录已完成的结果
   */
  public recordResult(key: string, result: any): void {
    this.completedCache.set(key, {
      timestamp: Date.now(),
      result,
    })
  }

  /**
   * 检查是否有可复用的已完成结果
   */
  public getCachedResult(key: string): any | null {
    const cached = this.completedCache.get(key)
    if (!cached) return null

    if (Date.now() - cached.timestamp > this.cacheTtlMs) {
      this.completedCache.delete(key)
      return null
    }

    return cached.result
  }

  public clear(): void {
    for (const entry of this.inFlightLocks.values()) {
      clearTimeout(entry.timeoutTimer)
    }
    this.inFlightLocks.clear()
    this.completedCache.clear()
  }
}

export const idempotencyManager = new IdempotencyManager()
