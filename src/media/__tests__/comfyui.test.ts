import test from 'node:test'
import assert from 'node:assert/strict'
import { ComfyUIVideoProvider } from '../providers/comfyui.ts'

test('ComfyUI 视频 Provider：定价预估应标明自建算力 0 成本', () => {
  const provider = new ComfyUIVideoProvider()
  const cost = provider.estimateCost({
    clientTaskId: 'test-key',
    prompt: 'test prompt',
    durationSec: 5,
    ratio: '9:16',
    shotId: 's1',
  })
  assert.match(cost, /0 元/)
  assert.match(cost, /自有显卡/)
})

test('ComfyUI 视频 Provider：离线环境 testConnection 应捕获并返回连接失败提示', async () => {
  const provider = new ComfyUIVideoProvider({ baseUrl: 'http://127.0.0.1:9999' })
  const result = await provider.testConnection()
  assert.equal(result.ok, false)
  assert.ok(result.error && result.error.length > 0)
})

test('ComfyUI 视频 Provider：getAsset 应返回有效 view 接口 URL', async () => {
  const provider = new ComfyUIVideoProvider({ baseUrl: 'http://127.0.0.1:8188' })
  const asset = await provider.getAsset('fake-task-id')
  assert.ok(asset.url.includes('/view?filename='))
  assert.equal(typeof asset.durationSec, 'number')
})
