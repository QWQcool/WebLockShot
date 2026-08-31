import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_RETRIES,
  abortError,
  classifyTokenError,
  decorateRetryExhausted,
  parseRetryAfterMs,
  resolveRetryDelayMs,
  withRetry,
  type RetryClock,
} from './retry.ts'

function clockWithLog(sleeps: number[]): RetryClock {
  return {
    now: () => 0,
    jitter: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  }
}

test('network 错误重试 3 次后仍抛错，退避 500/1000/2000', async () => {
  const sleeps: number[] = []
  let calls = 0
  const network = { kind: 'network', message: '无法连到该 API' }

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1
          throw network
        },
        {
          classify: (err) => classifyTokenError(err as { kind: string }),
          clock: clockWithLog(sleeps),
          decorateExhausted: (err) => {
            const e = err as { kind: string; message: string }
            return {
              ...e,
              message: decorateRetryExhausted(e.message),
              retries: MAX_RETRIES,
            }
          },
        },
      ),
    (err: unknown) => {
      const e = err as { kind: string; message: string }
      assert.equal(e.kind, 'network')
      assert.match(e.message, /重试 3 次仍失败/)
      return true
    },
  )

  assert.equal(calls, 4)
  assert.deepEqual(sleeps, [500, 1000, 2000])
})

test('config 错误不重试', async () => {
  const sleeps: number[] = []
  let calls = 0

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1
          throw { kind: 'config', message: '还没有填写 API Key' }
        },
        {
          classify: (err) => classifyTokenError(err as { kind: string }),
          clock: clockWithLog(sleeps),
        },
      ),
    (err: unknown) => {
      const e = err as { kind: string; message: string }
      assert.equal(e.kind, 'config')
      assert.equal(e.message.includes('重试'), false)
      return true
    },
  )

  assert.equal(calls, 1)
  assert.deepEqual(sleeps, [])
})

test('empty / 4xx 不重试，429 与 5xx 重试', () => {
  assert.deepEqual(classifyTokenError({ kind: 'empty' }), { retry: false })
  assert.deepEqual(classifyTokenError({ kind: 'http', status: 400 }), {
    retry: false,
  })
  assert.deepEqual(
    classifyTokenError({ kind: 'http', status: 429, retryAfter: '2' }),
    { retry: true, retryAfter: '2' },
  )
  assert.deepEqual(classifyTokenError({ kind: 'http', status: 503 }), {
    retry: true,
    retryAfter: undefined,
  })
})

test('AbortSignal 立即中断，不再进入下一次请求', async () => {
  const sleeps: number[] = []
  let calls = 0
  const ac = new AbortController()
  ac.abort()

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1
          throw { kind: 'network' }
        },
        {
          signal: ac.signal,
          classify: (err) => classifyTokenError(err as { kind: string }),
          clock: clockWithLog(sleeps),
        },
      ),
    (err: unknown) => {
      assert.equal(err instanceof Error && err.name, 'AbortError')
      return true
    },
  )

  assert.equal(calls, 0)
  assert.deepEqual(sleeps, [])
})

test('等待退避时 abort 会停掉重试链', async () => {
  const ac = new AbortController()
  let calls = 0

  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1
          throw { kind: 'network' }
        },
        {
          signal: ac.signal,
          classify: (err) => classifyTokenError(err as { kind: string }),
          clock: {
            now: () => 0,
            jitter: () => 0,
            sleep: async (_ms, signal) => {
              ac.abort()
              if (signal?.aborted) throw abortError()
            },
          },
        },
      ),
    (err: unknown) => {
      assert.equal(err instanceof Error && err.name, 'AbortError')
      return true
    },
  )

  assert.equal(calls, 1)
})

test('429 优先使用 Retry-After 秒数', () => {
  assert.equal(parseRetryAfterMs('2', 0), 2000)
  assert.equal(resolveRetryDelayMs(0, '1.5', 0, 0), 1500)
  assert.equal(resolveRetryDelayMs(0, null, 0, 0), 500)
})
