import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getApiProxyBase,
  getEngineProxyBase,
  isLoopbackHostname,
  localEngineProxyUrl,
} from '../proxyConfig.ts'

test('反代前缀：默认 /api，与既有约定一致', () => {
  assert.equal(getApiProxyBase(), '/api')
  assert.equal(getEngineProxyBase('comfyui'), '/api/comfyui')
  assert.equal(getEngineProxyBase('kling'), '/api/kling')
})

test('回环主机名判定：localhost / 127.0.0.1 / ::1 及其带端口形态', () => {
  for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]', 'app.localhost', ' 127.0.0.1 ']) {
    assert.equal(isLoopbackHostname(h), true, `${h} 应判为回环`)
  }
  for (const h of ['example.com', '192.168.1.10', '10.0.0.2', '127.0.0.1.evil.com', '']) {
    assert.equal(isLoopbackHostname(h), false, `${h} 不应判为回环`)
  }
})

test('本机 → 反代绝对 URL（产物必须能过 persistentUrlSchema，相对路径不合法）', () => {
  const local = localEngineProxyUrl('comfyui', { hostname: '127.0.0.1', origin: 'http://127.0.0.1:24562' })
  assert.equal(local, 'http://127.0.0.1:24562/api/comfyui')
  // 负向：绝不能返回相对路径 —— 画布契约只接受 idbref:// 或 http(s)://
  assert.ok(local?.startsWith('http://'), '必须是绝对 URL')
  assert.equal(
    localEngineProxyUrl('comfyui', { hostname: 'localhost', origin: 'http://localhost:5173' }),
    'http://localhost:5173/api/comfyui'
  )
  // 非本机 → null（调用方回落上游官方地址，不硬塞反代）
  assert.equal(localEngineProxyUrl('comfyui', { hostname: '192.168.1.10', origin: 'http://192.168.1.10:3000' }), null)
  assert.equal(localEngineProxyUrl('kling', { hostname: 'example.com', origin: 'https://example.com' }), null)
  // origin 非法时不得抛错，如实返回 null
  assert.equal(localEngineProxyUrl('comfyui', { hostname: 'localhost', origin: 'not a url' }), null)
})
