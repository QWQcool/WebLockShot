/**
 * 任务幂等性与防连击防重管理器 (Idempotency & Debounce Manager)
 * 
 * 核心设计：
 * 1. 结构化特征哈希：同入参、同意图在指定时间窗口内生成恒定幂等键
 * 2. In-flight 互斥执行锁：同一任务未完结前，拦截用户连击并阻止二次派发
 * 3. 结果缓存与短路保护：在有效缓存窗口内支持瞬间幂等复用，省算力防风暴
 */

import { getPollingWindow } from './pollingConfig.ts'

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

/** 多标签页锁元数据 localStorage 前缀（尽力而为语义，非强互斥，见 acquireLock 注释） */
const LOCK_META_PREFIX = 'weblockshot.idempotency.lock.'

/** 本页实例 id 的 sessionStorage 键：**同标签页跨刷新保持**、**跨标签页互不相同** */
const PAGE_ID_KEY = 'weblockshot.page_instance_id'

type CrossTabLockMeta = {
  token: string
  at: number
  /**
   * 写入该锁的页实例 id（见 PAGE_ID_KEY）。用于区分「其它标签页的锁」与
   * 「本页刷新前留下的陈旧锁」——后者必须忽略，否则刷新后会在 TTL 内无法重试。
   * 可能为 null（sessionStorage 不可用，如隐私模式）。
   */
  pageId?: string | null
}

/**
 * 读取/生成当前页实例 id。
 * 用 `sessionStorage` 是刻意的：它在**同一标签页跨刷新保持**（所以刷新后仍是「我自己」），
 * 而不同标签页之间互不共享（所以另一页是「别人」）。
 * 不可用（隐私模式 / 无 sessionStorage / 抛错）时返回 null —— 调用方按「未知」处理，见 acquireLock。
 */
function readOrCreatePageId(): string | null {
  try {
    const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage
    if (!storage) return null
    const existing = storage.getItem(PAGE_ID_KEY)
    if (existing && existing.trim()) return existing
    const id = `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    storage.setItem(PAGE_ID_KEY, id)
    return id
  } catch {
    return null
  }
}

export class IdempotencyManager {
  private inFlightLocks = new Map<
    string,
    { timestamp: number; timeoutTimer: ReturnType<typeof setTimeout>; crossTabToken?: string | null }
  >()
  private completedCache = new Map<string, { timestamp: number; result: unknown }>()
  /** O1：锁 TTL 对齐轮询窗口后的缓冲（轮询收尾 + settle/refund 的时间余量） */
  private readonly lockBufferMs = 60_000
  private readonly cacheTtlMs = 600_000 // 已完成缓存保留 10 分钟
  /** 本页实例 id（sessionStorage；不可用时为 null → 跨页判定退化为「不阻断」，见 acquireLock） */
  private readonly pageId: string | null = readOrCreatePageId()

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
   * O1 修复：锁 TTL 与轮询窗口对齐（maxAttempts * intervalMs + 缓冲）。
   * 此前固定 120s 看门狗，而轮询最长 20min —— 锁会在任务仍在轮询时被提前释放，
   * 同意图第二次提交得以进入 → 双提交双计费。现在看门狗仅在超轮询窗口 + 缓冲后兜底。
   */
  public getLockTtlMs(): number {
    const window = getPollingWindow()
    return window.intervalMs * window.maxAttempts + this.lockBufferMs
  }

  /** 多标签页锁元数据读取（无 localStorage 环境 —— Node 测试 —— 返回 null） */
  private crossTabRead(key: string): CrossTabLockMeta | null {
    try {
      const storage = (globalThis as { localStorage?: Storage }).localStorage
      const raw = storage?.getItem(LOCK_META_PREFIX + key)
      return raw ? (JSON.parse(raw) as CrossTabLockMeta) : null
    } catch {
      return null
    }
  }

  /** 写入本页持有的锁元数据（带 token + 时间戳 + pageId，供其它标签页 CAS 检查与释放比对） */
  private crossTabWrite(key: string): string | null {
    try {
      const storage = (globalThis as { localStorage?: Storage }).localStorage
      if (!storage) return null
      const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      storage.setItem(
        LOCK_META_PREFIX + key,
        JSON.stringify({ token, at: Date.now(), pageId: this.pageId })
      )
      return token
    } catch {
      return null
    }
  }

  /**
   * 该跨页锁元数据是否应**阻断**本页获取锁（纯判定，便于单测）。
   * 只有同时满足三条才算「他人持有」：
   * 1. 未过期（超过 TTL 视为陈旧，不阻断）；
   * 2. 元数据带 pageId **且**本页也有 pageId（否则无法判定归属 → 不阻断，见下）；
   * 3. pageId 与本页不同（不同标签页）。
   */
  private isForeignCrossTabLock(meta: CrossTabLockMeta, lockTimeoutMs: number, now = Date.now()): boolean {
    if (now - meta.at >= lockTimeoutMs) return false
    if (!meta.pageId || !this.pageId) return false
    return meta.pageId !== this.pageId
  }

  private crossTabRemove(key: string, token?: string | null): void {
    try {
      const storage = (globalThis as { localStorage?: Storage }).localStorage
      if (!storage) return
      const meta = this.crossTabRead(key)
      // 仅清理自己写入的元数据，避免误删其它标签页新持有的锁
      if (!token || !meta || meta.token === token) {
        storage.removeItem(LOCK_META_PREFIX + key)
      }
    } catch {
      // ignore
    }
  }

  /**
   * 尝试获取执行锁（防连击与防重复提交）
   * 如果该 key 正在执行中，返回 success: false
   *
   * 多标签页语义（尽力而为，非强互斥）：localStorage 中若存在**属于其它页实例**的新鲜锁元数据，
   * 本页拒绝获取 —— 这是 CAS 风格的乐观检查，无法防止两页同时通过检查的竞态窗口，
   * 仅作为第二道防线。
   *
   * ⚠️ 诚实边界（**不要把本检查当成「有兜底的弱保护」**）：本仓库内**无法证实**存在更强的
   * 跨标签页去重兜底 —— `clientTaskId` 虽会随提交传给 provider（`executorNode`），但本仓库
   * 不包含 provider 的去重实现（是否按它去重取决于供应商），`server/` 侧无任何幂等键逻辑，
   * mock / 演示路径更是完全没有去重。因此下文「pageId 不可用 → 不阻断」的降级**确有代价**：
   * 该罕见场景（隐私模式等）下，跨标签页同任务防重会从「拦截」退化为「**不拦截**」。
   *
   * 页身份（pageId）：锁元数据写入时带上本页 `sessionStorage` 中的实例 id，
   * 于是「本页刷新前留下的陈旧锁」可被识别并忽略（刷新后可立即重试），
   * 而「另一标签页的锁」仍然互斥。取不到 pageId 时按「未知 = 不阻断」降级（见下方注释）。
   */
  public acquireLock(key: string, lockTimeoutMs = this.getLockTtlMs()): { success: boolean; reason?: string } {
    if (this.inFlightLocks.has(key)) {
      const entry = this.inFlightLocks.get(key)!
      const elapsed = Math.round((Date.now() - entry.timestamp) / 1000)
      return {
        success: false,
        reason: `任务 [${key}] 已在后台执行中（已运行 ${elapsed} 秒），请勿重复连击或同时提交相同任务。`,
      }
    }

    // 多标签页尽力而为检查（第二道防线）：只有「带页身份 + 与本页不同 + 未过期」才视为他人持有。
    // - 本页自己的陈旧锁（同 pageId，如刷新页面时上一批任务未释放）→ 忽略并覆盖：
    //   否则刷新后会在 TTL（轮询窗口 + 60s ≈ 11 分钟）内无法重试，且「其它标签页执行中」的提示
    //   具有误导性（用户并没有开第二个标签页）。
    // - pageId 不可用（隐私模式 / 无 sessionStorage）→ **不阻断**（未知 = 不阻断）：
    //   此时无法判定锁的归属，若按「不可判定即拒绝」处理，会把用户自己的陈旧锁误判成他人锁
    //   （那正是本次修复要解决的误导性提示）。
    //   ⚠️ 代价（如实标注）：该罕见场景下，跨标签页同任务防重由「会拦截」退化为「**不拦截**」。
    //   这是为修 bug 付出的、可接受的代价；但**不要**用「反正有服务端幂等键兜底」来安慰自己 ——
    //   该兜底在本仓库内无法证实（provider 是否按 clientTaskId 去重取决于供应商、server/ 无幂等键、
    //   mock/演示路径无去重），属**未验证假设**。
    const crossTabMeta = this.crossTabRead(key)
    if (crossTabMeta && this.isForeignCrossTabLock(crossTabMeta, lockTimeoutMs)) {
      return {
        success: false,
        reason: '相同任务似乎正在其它标签页执行中（检测到跨页任务锁），请勿重复提交。',
      }
    }

    // 设置看门狗自动释放锁（TTL = 轮询窗口 + 缓冲），仅作异常挂起时的兜底
    const timer = setTimeout(() => {
      this.releaseLock(key)
    }, lockTimeoutMs)
    // 看门狗不阻止进程退出（Node 测试 / SSR 环境）
    if (typeof timer === 'object' && 'unref' in timer) {
      ;(timer as { unref: () => void }).unref()
    }

    const crossTabToken = this.crossTabWrite(key)

    this.inFlightLocks.set(key, {
      timestamp: Date.now(),
      timeoutTimer: timer,
      crossTabToken,
    })

    return { success: true }
  }

  /**
   * 释放执行锁（幂等：重复调用 / 锁已被看门狗释放时均安全无副作用）
   */
  public releaseLock(key: string): void {
    const entry = this.inFlightLocks.get(key)
    if (entry) {
      clearTimeout(entry.timeoutTimer)
      this.crossTabRemove(key, entry.crossTabToken)
      this.inFlightLocks.delete(key)
    }
  }

  /**
   * 记录已完成的结果
   */
  public recordResult(key: string, result: unknown): void {
    this.completedCache.set(key, {
      timestamp: Date.now(),
      result,
    })
  }

  /**
   * 检查是否有可复用的已完成结果
   */
  public getCachedResult(key: string): unknown | null {
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
