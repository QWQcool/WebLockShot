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
