import test from 'node:test'
import assert from 'node:assert/strict'
import { KlingVideoProvider } from '../providers/kling.ts'

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
