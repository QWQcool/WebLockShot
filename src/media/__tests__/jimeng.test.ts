import test from 'node:test'
import assert from 'node:assert/strict'
import { JimengVideoProvider } from '../providers/jimeng.ts'

test('字节即梦 (Jimeng) Provider：无 Key 时拦截并提示用户配置', async () => {
  const provider = new JimengVideoProvider()
  await assert.rejects(
    async () => {
      await provider.submit({
        clientTaskId: 'test-task-1',
        shotId: 's1',
        prompt: 'test prompt',
        durationSec: 5,
        ratio: '9:16',
      })
    },
    (err: any) => {
      return (
        err instanceof Error &&
        err.message.includes('未检测到字节即梦') &&
        err.message.includes('API 设置')
      )
    }
  )
})

test('字节即梦 (Jimeng) Provider：定价预估', () => {
  const provider = new JimengVideoProvider()
  const cost = provider.estimateCost({
    clientTaskId: 'test-cost',
    shotId: 's1',
    prompt: 'test',
    durationSec: 5,
    ratio: '9:16',
  })
  assert.ok(cost.includes('8 积分'))
})

test('字节即梦 (Jimeng) Provider：网络失败必须显式抛错，绝不静默降级返回假视频', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed: 模拟断网')
  }) as typeof fetch

  try {
    // 注入假 Key 以越过 Key 校验，专测网络异常路径
    const originalSession = globalThis.sessionStorage
    ;(globalThis as any).sessionStorage = {
      getItem: () => 'test-key',
    }

    const provider = new JimengVideoProvider('https://mock-jimeng.local')
    await assert.rejects(
      async () => {
        await provider.submit({
          clientTaskId: 'test-task-net-fail',
          shotId: 's1',
          prompt: 'test prompt',
          durationSec: 5,
          ratio: '9:16',
        })
      },
      (err: any) => {
        return (
          err instanceof Error &&
          err.message.includes('即梦视频提交失败') &&
          !err.message.includes('jimeng-sim')
        )
      },
      '网络失败必须抛错，不得降级为 jimeng-sim- 假视频'
    )
    ;(globalThis as any).sessionStorage = originalSession
  } finally {
    globalThis.fetch = originalFetch
  }
})
