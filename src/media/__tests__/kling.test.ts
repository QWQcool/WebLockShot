import test from 'node:test'
import assert from 'node:assert/strict'
import { KlingVideoProvider } from '../providers/kling.ts'

type MockFetchCall = { url: string; init?: RequestInit }

function installKlingMocks() {
  const calls: MockFetchCall[] = []
  const originalFetch = globalThis.fetch
  const originalSession = (globalThis as any).sessionStorage

  ;(globalThis as any).sessionStorage = {
    getItem: (_key: string) => 'test-key',
    setItem: () => {},
  }
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url: String(url), init })
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-task-1' } }),
      text: async () => '',
    } as any
  }) as typeof fetch

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch
      ;(globalThis as any).sessionStorage = originalSession
    },
  }
}

test('可灵 (Kling) 视频 Provider：无 Key 时拦截并提示用户配置', async () => {
  const provider = new KlingVideoProvider()

  // 此时无 Key，submit 应直接抛出友好提示，不盲目发网络请求
  await assert.rejects(
    async () => {
      await provider.submit({
        clientTaskId: 'test-key',
        prompt: 'test prompt',
        durationSec: 5,
        ratio: '9:16',
        shotId: 's1',
      })
    },
    {
      message: /未检测到快手可灵 API Key/,
    }
  )
})

test('可灵 (Kling) 视频 Provider：定价预估', () => {
  const provider = new KlingVideoProvider()
  const cost = provider.estimateCost({
    clientTaskId: 'test-key',
    prompt: 'test prompt',
    durationSec: 5,
    ratio: '9:16',
    shotId: 's1',
  })
  assert.match(cost, /灵感点/)
})

test('可灵 (Kling) Provider：按任务类型区分 text2video / image2video 端点', async () => {
  const mocks = installKlingMocks()
  try {
    const provider = new KlingVideoProvider('https://mock-kling.local')

    // 文生视频
    await provider.submit({
      clientTaskId: 'k-t2v',
      prompt: 'test prompt',
      durationSec: 5,
      ratio: '9:16',
      shotId: 's1',
    })
    assert.equal(mocks.calls[0].url, 'https://mock-kling.local/v1/videos/text2video')

    // 图生视频
    await provider.submit({
      clientTaskId: 'k-i2v',
      prompt: 'test prompt',
      imageBase64: 'data:image/png;base64,AAAA',
      durationSec: 5,
      ratio: '9:16',
      shotId: 's2',
    })
    assert.equal(mocks.calls[1].url, 'https://mock-kling.local/v1/videos/image2video')

    // poll：两个任务分别命中与 submit 同模式的查询端点
    await provider.poll('kling-task-1')
    const lastUrl = mocks.calls[mocks.calls.length - 1].url
    assert.match(lastUrl, /\/v1\/videos\/(text2video|image2video)\/kling-task-1$/)
  } finally {
    mocks.restore()
  }
})

test('可灵 (Kling) Provider：5xx 网络抖动经 withRetry 自动重试后成功', async () => {
  const originalFetch = globalThis.fetch
  const originalSession = (globalThis as any).sessionStorage
  ;(globalThis as any).sessionStorage = { getItem: () => 'test-key' }

  let attempts = 0
  globalThis.fetch = (async () => {
    attempts++
    if (attempts < 3) {
      // 前两次模拟网关 502
      return {
        ok: false,
        status: 502,
        json: async () => ({}),
        text: async () => 'bad gateway',
      } as any
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_id: 'kling-task-retry' } }),
      text: async () => '',
    } as any
  }) as typeof fetch

  try {
    const provider = new KlingVideoProvider('https://mock-kling.local')
    const { taskId } = await provider.submit({
      clientTaskId: 'k-retry',
      prompt: 'test prompt',
      durationSec: 5,
      ratio: '9:16',
      shotId: 's1',
    })
    assert.equal(taskId, 'kling-task-retry')
    assert.ok(attempts >= 3, `应自动重试至第 3 次成功，实际请求次数: ${attempts}`)
  } finally {
    globalThis.fetch = originalFetch
    ;(globalThis as any).sessionStorage = originalSession
  }
})
