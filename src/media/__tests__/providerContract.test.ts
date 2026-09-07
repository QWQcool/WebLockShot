import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { KlingVideoProvider, klingErrorMessage } from '../providers/kling.ts'
import { JimengVideoProvider, jimengErrorMessage } from '../providers/jimeng.ts'

/**
 * 引擎契约测试（M2b）：请求体形状 vs fixtures 断言、响应解析（各 status 映射）、
 * 错误码 → 用户可读信息映射。fixtures 按官方文档真实结构整理于 test/fixtures/。
 */

const FIXTURE_ROOT = fileURLToPath(new URL('../../../test/fixtures/', import.meta.url))

function loadFixture(engine: 'kling' | 'jimeng', name: string): any {
  return JSON.parse(readFileSync(`${FIXTURE_ROOT}${engine}/${name}.json`, 'utf8'))
}

type MockCall = { url: string; init?: RequestInit }

function installFetchMock(respond: (call: MockCall, index: number) => unknown) {
  const calls: MockCall[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: any, init?: any) => {
    const call: MockCall = { url: String(url), init }
    const index = calls.length
    calls.push(call)
    return respond(call, index)
  }) as typeof fetch
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}

function jsonResponse(payload: unknown): unknown {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

// ---------------- 可灵 (Kling) 契约 ----------------

const KLING_SESSION = {
  getItem: (key: string) => (key === 'weblockshot.kling_key' ? 'test-key' : null),
}

test('可灵契约：submit 请求体形状与 fixtures 完全一致', async () => {
  const fixture = loadFixture('kling', 'submit-request')
  const mock = installFetchMock(() =>
    jsonResponse(loadFixture('kling', 'submit-response'))
  )
  const originalSession = (globalThis as any).sessionStorage
  ;(globalThis as any).sessionStorage = KLING_SESSION

  try {
    const provider = new KlingVideoProvider('https://mock-kling.local')
    await provider.submit({
      clientTaskId: 'k-t2v',
      prompt: fixture.body.prompt,
      negative: fixture.body.negative_prompt,
      durationSec: 5,
      ratio: '9:16',
      shotId: 's1',
    })

    assert.equal(mock.calls[0].url, `https://mock-kling.local${fixture.endpoint}`)
    const sentBody = JSON.parse(String(mock.calls[0].init?.body))
    // 请求体键集合与契约完全一致（不多不少，字段级契约）
    assert.deepEqual(Object.keys(sentBody).sort(), Object.keys(fixture.body).sort())
    assert.equal(sentBody.model_name, fixture.body.model_name)
    assert.equal(sentBody.duration, fixture.body.duration) // 字符串形态（契约）
    assert.equal(sentBody.aspect_ratio, fixture.body.aspect_ratio)

    // Authorization 走 Bearer 模式（裸 key 现状）
    const headers = mock.calls[0].init?.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer test-key')
  } finally {
    mock.restore()
    ;(globalThis as any).sessionStorage = originalSession
  }
})

test('可灵契约：poll 各 task_status 精确映射', async () => {
  const cases = [
    { fixture: 'poll-submitted', expected: 'queued' },
    { fixture: 'poll-processing', expected: 'running' },
    { fixture: 'poll-succeed', expected: 'succeeded' },
    { fixture: 'poll-failed', expected: 'failed' },
  ] as const

  for (const { fixture, expected } of cases) {
    const payload = loadFixture('kling', fixture)
    const mock = installFetchMock(() => jsonResponse(payload))
    const originalSession = (globalThis as any).sessionStorage
    ;(globalThis as any).sessionStorage = KLING_SESSION
    try {
      const provider = new KlingVideoProvider('https://mock-kling.local')
      const result = await provider.poll('kling-task-1')
      assert.equal(result.status, expected, `fixture ${fixture} 应映射为 ${expected}`)
      if (expected === 'failed') {
        assert.match(result.error || '', /内容审核未通过/)
      }
    } finally {
      mock.restore()
      ;(globalThis as any).sessionStorage = originalSession
    }
  }
})

test('可灵契约：错误码映射为用户可读中文；未知码保持历史格式', () => {
  const table = loadFixture('kling', 'error-codes').codes as Record<string, { message: string }>
  for (const [code, meta] of Object.entries(table)) {
    const msg = klingErrorMessage(code, 'raw')
    assert.equal(msg, meta.message, `错误码 ${code} 应映射为契约文案`)
    assert.notEqual(msg, 'raw')
  }
  // 未知错误码 → 历史格式（现状兼容）
  assert.equal(klingErrorMessage(999999, 'oops'), '可灵返回错误 [999999]: oops')
})

// ---------------- 即梦 (Jimeng) 契约 ----------------

const JIMENG_SESSION = {
  getItem: (key: string) => (key === 'weblockshot.jimeng_key' ? 'test-key' : null),
}

test('即梦契约：submit 请求体形状与 fixtures 完全一致', async () => {
  const fixture = loadFixture('jimeng', 'submit-request')
  const mock = installFetchMock(() => jsonResponse(loadFixture('jimeng', 'submit-response')))
  const originalSession = (globalThis as any).sessionStorage
  ;(globalThis as any).sessionStorage = JIMENG_SESSION

  try {
    const provider = new JimengVideoProvider('https://mock-jimeng.local')
    await provider.submit({
      clientTaskId: 'j-t2v',
      prompt: fixture.body.prompt,
      negative: fixture.body.negative_prompt,
      durationSec: 5,
      ratio: '9:16',
      shotId: 's1',
    })

    assert.equal(mock.calls[0].url, `https://mock-jimeng.local${fixture.endpoint}`)
    const sentBody = JSON.parse(String(mock.calls[0].init?.body))
    assert.deepEqual(Object.keys(sentBody).sort(), Object.keys(fixture.body).sort())
    assert.equal(sentBody.model_name, fixture.body.model_name)
    assert.equal(sentBody.duration, fixture.body.duration) // 数值形态（契约，与可灵的字符串不同）
    assert.equal(sentBody.negative_prompt, fixture.body.negative_prompt)

    // Authorization 走 Bearer 模式（裸 key 现状）
    const headers = mock.calls[0].init?.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer test-key')
  } finally {
    mock.restore()
    ;(globalThis as any).sessionStorage = originalSession
  }
})

test('即梦契约：poll 各 task_status 精确映射', async () => {
  const cases = [
    { fixture: 'poll-queued', expected: 'running' },
    { fixture: 'poll-processing', expected: 'running' },
    { fixture: 'poll-succeed', expected: 'succeeded' },
    { fixture: 'poll-failed', expected: 'failed' },
  ] as const

  for (const { fixture, expected } of cases) {
    const payload = loadFixture('jimeng', fixture)
    const mock = installFetchMock(() => jsonResponse(payload))
    const originalSession = (globalThis as any).sessionStorage
    ;(globalThis as any).sessionStorage = JIMENG_SESSION
    try {
      const provider = new JimengVideoProvider('https://mock-jimeng.local')
      const result = await provider.poll('jimeng-task-1')
      assert.equal(result.status, expected, `fixture ${fixture} 应映射为 ${expected}`)
      if (expected === 'failed') {
        assert.match(result.error || '', /平台规范/)
      }
      if (expected === 'running' && fixture === 'poll-processing') {
        assert.equal(result.progress, 55) // 契约：透传官方进度
      }
    } finally {
      mock.restore()
      ;(globalThis as any).sessionStorage = originalSession
    }
  }
})

test('即梦契约：错误码映射为用户可读中文；未知码透传原文', () => {
  const table = loadFixture('jimeng', 'error-codes').codes as Record<string, { message: string }>
  for (const [code, meta] of Object.entries(table)) {
    const msg = jimengErrorMessage(code, 'raw')
    assert.equal(msg, meta.message, `错误码 ${code} 应映射为契约文案`)
  }
  assert.equal(jimengErrorMessage(999999, '原始错误'), '原始错误')
})

test('即梦契约：JSON ak/sk 凭据走 V4 签名模式（请求头形态）', async () => {
  const fixture = loadFixture('jimeng', 'submit-request')
  const mock = installFetchMock(() => jsonResponse(loadFixture('jimeng', 'submit-response')))
  const originalSession = (globalThis as any).sessionStorage
  ;(globalThis as any).sessionStorage = {
    getItem: (key: string) =>
      key === 'weblockshot.jimeng_key' ? JSON.stringify({ ak: 'AKTEST', sk: 'SKTEST' }) : null,
  }

  try {
    const provider = new JimengVideoProvider('https://mock-jimeng.local')
    await provider.submit({
      clientTaskId: 'j-signed',
      prompt: fixture.body.prompt,
      negative: fixture.body.negative_prompt,
      durationSec: 5,
      ratio: '9:16',
      shotId: 's1',
    })

    const headers = mock.calls[0].init?.headers as Record<string, string>
    assert.match(headers['X-Date'], /^\d{8}T\d{6}Z$/) // UTC 格式
    assert.equal(headers['X-Content-Sha256'], createHash('sha256').update(String(mock.calls[0].init?.body)).digest('hex'))
    assert.match(
      headers.Authorization,
      /^HMAC-SHA256 Credential=AKTEST\/\d{8}\/cn-north-1\/cv\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$/
    )
  } finally {
    mock.restore()
    ;(globalThis as any).sessionStorage = originalSession
  }
})
