import test from 'node:test'
import assert from 'node:assert/strict'
import { KlingVideoProvider, recordKlingTaskKind, resolveKlingTaskKind } from '../providers/kling.ts'

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

test('O10 可灵 kind 持久化：刷新后（内存缓存清空）image2video 任务 poll 用正确端点', async () => {
  // localStorage 桩：模拟跨页面刷新的持久化层
  const store = new Map<string, string>()
  const originalLocalStorage = (globalThis as any).localStorage
  const originalFetch = globalThis.fetch
  const originalSession = (globalThis as any).sessionStorage

  ;(globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  ;(globalThis as any).sessionStorage = { getItem: (_k: string) => 'test-key' }

  const calls: Array<{ url: string }> = []
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url: String(url) })
    if (init?.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { task_id: 'o10-i2v-task' } }),
        text: async () => '',
      } as any
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { task_status: 'processing' } }),
      text: async () => '',
    } as any
  }) as typeof fetch

  try {
    // 第 1 次「会话」：submit 路径会把 kind 双写（内存缓存 + localStorage）。
    // 此处直接用导出的 recordKlingTaskKind 模拟已发生的 submit 落盘，
    // 以保证后续 poll 走的是「持久化恢复」路径而非同进程模块级缓存命中。
    recordKlingTaskKind('o10-i2v-task', 'image2video')

    // 模拟刷新：localStorage 保留，进程内存态（含 klingCache）丢失
    // 关键断言 1：持久化映射已落盘
    const persisted = JSON.parse(store.get('weblockshot.kling.task_kind_map') || '{}')
    assert.equal(persisted['o10-i2v-task'], 'image2video', 'kind 应持久化到 localStorage')
    assert.equal(resolveKlingTaskKind('o10-i2v-task'), 'image2video', '恢复函数应命中持久化映射')

    // 关键断言 2：新「会话」poll 走 image2video 端点（kind 恢复自持久化层）
    {
      const provider = new KlingVideoProvider('https://mock-kling.local')
      await provider.poll('o10-i2v-task')
      const pollUrl = calls[calls.length - 1].url
      assert.match(pollUrl, /\/v1\/videos\/image2video\/o10-i2v-task$/, '刷新后 poll 应命中 image2video 端点')
    }

    // 未持久化的任务回退 text2video 默认行为不变
    {
      const provider = new KlingVideoProvider('https://mock-kling.local')
      await provider.poll('o10-unknown-task')
      const pollUrl = calls[calls.length - 1].url
      assert.match(pollUrl, /\/v1\/videos\/text2video\/o10-unknown-task$/, '未知任务保持 text2video 默认')
    }
  } finally {
    ;(globalThis as any).localStorage = originalLocalStorage
    globalThis.fetch = originalFetch
    ;(globalThis as any).sessionStorage = originalSession
  }
})
