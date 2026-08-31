export const MAX_RETRIES = 3
export const RETRY_DELAYS_MS = [500, 1000, 2000] as const

export type RetryClassify = {
  retry: boolean
  retryAfter?: string | null
}

export type RetryClock = {
  now: () => number
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  jitter: () => number
}

export const defaultRetryClock: RetryClock = {
  now: () => Date.now(),
  sleep: sleepWithSignal,
  jitter: () => Math.random() * 0.4 - 0.2,
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

export function abortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('请求已取消', 'AbortError')
  }
  const err = new Error('请求已取消')
  err.name = 'AbortError'
  return err
}

export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500
}

export function classifyTokenError(err: {
  kind: string
  status?: number
  retryAfter?: string | null
}): RetryClassify {
  if (err.kind === 'network') return { retry: true }
  if (
    err.kind === 'http' &&
    typeof err.status === 'number' &&
    isRetryableHttpStatus(err.status)
  ) {
    return { retry: true, retryAfter: err.retryAfter }
  }
  return { retry: false }
}

export function parseRetryAfterMs(
  header: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (!trimmed) return null
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number(trimmed) * 1000))
  }
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - now)
}

export function resolveRetryDelayMs(
  retryIndex: number,
  retryAfterHeader: string | null | undefined,
  jitterUnit: number,
  now = Date.now(),
): number {
  const fromHeader = parseRetryAfterMs(retryAfterHeader, now)
  if (fromHeader !== null) return Math.min(fromHeader, 30_000)
  const base =
    RETRY_DELAYS_MS[retryIndex] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
  const unit = Number.isFinite(jitterUnit) ? jitterUnit : 0
  return Math.max(0, Math.round(base * (1 + unit)))
}

export function decorateRetryExhausted(message: string): string {
  if (message.includes('重试 3 次仍失败')) return message
  return `${message}（重试 ${MAX_RETRIES} 次仍失败）`
}

export async function withRetry<T>(
  run: () => Promise<T>,
  options: {
    signal?: AbortSignal
    classify: (err: unknown) => RetryClassify
    clock?: RetryClock
    decorateExhausted?: (err: unknown) => unknown
    onRetry?: (info: {
      retry: number
      delayMs: number
      error: unknown
    }) => void
  },
): Promise<T> {
  const clock = options.clock ?? defaultRetryClock
  let last: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (options.signal?.aborted) throw abortError()
    try {
      return await run()
    } catch (err) {
      last = err
      if (isAbortError(err) || options.signal?.aborted) throw err
      const verdict = options.classify(err)
      const retriesUsed = attempt
      const canRetryMore = retriesUsed < MAX_RETRIES
      if (!verdict.retry || !canRetryMore) {
        if (verdict.retry && !canRetryMore && options.decorateExhausted) {
          throw options.decorateExhausted(err)
        }
        throw err
      }
      const delayMs = resolveRetryDelayMs(
        retriesUsed,
        verdict.retryAfter,
        clock.jitter(),
        clock.now(),
      )
      options.onRetry?.({ retry: retriesUsed + 1, delayMs, error: err })
      await clock.sleep(delayMs, options.signal)
    }
  }

  throw last
}
