import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { KlingVideoProvider, klingErrorMessage } from '../providers/kling.ts'
import { JimengVideoProvider, jimengErrorMessage } from '../providers/jimeng.ts'
import {
  RunwayVideoProvider,
  RUNWAY_API_VERSION,
  RUNWAY_KEY_STORAGE,
  normalizeRunwayImage,
  runwayDuration,
  runwayErrorMessage,
} from '../providers/runway.ts'
import {
  LumaVideoProvider,
  LUMA_KEY_STORAGE,
  lumaDuration,
  lumaErrorMessage,
  normalizeLumaImage,
} from '../providers/luma.ts'

/**
 * 引擎契约测试（M2b）：请求体形状 vs fixtures 断言、响应解析（各 status 映射）、
 * 错误码 → 用户可读信息映射。fixtures 按官方文档真实结构整理于 test/fixtures/。
 */

const FIXTURE_ROOT = fileURLToPath(new URL('../../../test/fixtures/', import.meta.url))

function loadFixture(engine: 'kling' | 'jimeng' | 'runway' | 'luma', name: string): any {
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

// ---------------- Runway（M1 海外引擎 · 契约先行） ----------------

function withSession(storage: { getItem: (k: string) => string | null }, fn: () => Promise<void>) {
  const originalSession = (globalThis as any).sessionStorage
  ;(globalThis as any).sessionStorage = storage
  return fn().finally(() => {
    ;(globalThis as any).sessionStorage = originalSession
  })
}

const RUNWAY_SESSION = { getItem: (key: string) => (key === RUNWAY_KEY_STORAGE ? 'test-key' : null) }
const LUMA_SESSION = { getItem: (key: string) => (key === LUMA_KEY_STORAGE ? 'test-key' : null) }

test('Runway 契约：text_to_video 请求体/端点/请求头与 fixtures 完全一致', async () => {
  const fixture = loadFixture('runway', 'submit-request')
  const mock = installFetchMock(() => jsonResponse(loadFixture('runway', 'submit-response')))
  await withSession(RUNWAY_SESSION, async () => {
    try {
      const provider = new RunwayVideoProvider('https://mock-runway.local')
      await provider.submit({
        clientTaskId: 'rw-t2v',
        prompt: fixture.body.promptText,
        durationSec: 5,
        ratio: '9:16',
        shotId: 's1',
      })

      assert.equal(mock.calls[0].url, `https://mock-runway.local${fixture.endpoint}`)
      const sentBody = JSON.parse(String(mock.calls[0].init?.body))
      // 字段级契约：键集合完全一致（不多不少）
      assert.deepEqual(Object.keys(sentBody).sort(), Object.keys(fixture.body).sort())
      assert.equal(sentBody.model, fixture.body.model)
      assert.equal(sentBody.ratio, fixture.body.ratio)
      assert.equal(sentBody.duration, fixture.body.duration)
      // 请求头契约：Bearer + 官方版本头
      const headers = mock.calls[0].init?.headers as Record<string, string>
      assert.equal(headers.Authorization, 'Bearer test-key')
      assert.equal(headers['X-Runway-Version'], RUNWAY_API_VERSION)
    } finally {
      mock.restore()
    }
  })
})

test('Runway 契约：有参考图 → 切 image_to_video 端点 + promptImage 补 data URI 前缀', async () => {
  const fixture = loadFixture('runway', 'submit-request-i2v')
  const mock = installFetchMock(() => jsonResponse(loadFixture('runway', 'submit-response')))
  await withSession(RUNWAY_SESSION, async () => {
    try {
      const provider = new RunwayVideoProvider('https://mock-runway.local')
      await provider.submit({
        clientTaskId: 'rw-i2v',
        prompt: fixture.body.promptText,
        imageBase64: 'AAAA',
        durationSec: 5,
        ratio: '9:16',
        shotId: 's1',
      })

      assert.equal(mock.calls[0].url, `https://mock-runway.local${fixture.endpoint}`)
      const sentBody = JSON.parse(String(mock.calls[0].init?.body))
      assert.deepEqual(Object.keys(sentBody).sort(), Object.keys(fixture.body).sort())
      assert.equal(sentBody.promptImage, fixture.body.promptImage)
      // 归一化纯函数：https / data URI 原样透传，裸 base64 补前缀
      assert.equal(normalizeRunwayImage('https://cdn/x.jpg'), 'https://cdn/x.jpg')
      assert.equal(normalizeRunwayImage('data:image/png;base64,AA'), 'data:image/png;base64,AA')
      assert.equal(normalizeRunwayImage(undefined), undefined)
    } finally {
      mock.restore()
    }
  })
})

test('Runway 契约：poll 各 status 精确映射（progress 0~1 → 0~100）', async () => {
  const cases = [
    { fixture: 'poll-pending', expected: 'queued', progress: 0 },
    { fixture: 'poll-throttled', expected: 'running', progress: 10 },
    { fixture: 'poll-running', expected: 'running', progress: 42 },
    { fixture: 'poll-succeed', expected: 'succeeded', progress: 100 },
    { fixture: 'poll-failed', expected: 'failed', progress: undefined },
  ] as const

  for (const { fixture, expected, progress } of cases) {
    const mock = installFetchMock(() => jsonResponse(loadFixture('runway', fixture)))
    await withSession(RUNWAY_SESSION, async () => {
      try {
        const provider = new RunwayVideoProvider('https://mock-runway.local')
        const result = await provider.poll('runway-task-1')
        assert.equal(result.status, expected, `fixture ${fixture} 应映射为 ${expected}`)
        if (progress !== undefined) assert.equal(result.progress, progress, `${fixture} 进度换算错误`)
        if (expected === 'failed') assert.match(result.error || '', /内容审核未通过/)
      } finally {
        mock.restore()
      }
    })
  }
})

test('Runway 契约：failure 文案映射（命中关键词中文，未知透传，缺失兜底）', () => {
  const fixture = loadFixture('runway', 'error-cases')
  for (const c of fixture.cases as Array<{ failure: string; message: string }>) {
    assert.equal(runwayErrorMessage(c.failure, 'FAILED'), c.message)
  }
  assert.equal(runwayErrorMessage(undefined, fixture.empty.status), fixture.empty.message)
  // 时长档位契约：gen4_turbo 只接受 5 / 10 秒
  assert.equal(runwayDuration(3), 5)
  assert.equal(runwayDuration(5), 5)
  assert.equal(runwayDuration(8), 10)
})

test('Runway 契约：无 Key 时不发起任何请求（诚实灰态）', async () => {
  const mock = installFetchMock(() => jsonResponse({}))
  await withSession({ getItem: () => null }, async () => {
    try {
      const provider = new RunwayVideoProvider('https://mock-runway.local')
      await assert.rejects(
        () => provider.submit({ clientTaskId: 'x', prompt: 'p', durationSec: 5, ratio: '9:16', shotId: 's1' }),
        /未检测到 Runway API Key/
      )
      await assert.rejects(() => provider.poll('t'), /未检测到 Runway API Key/)
      assert.equal(mock.calls.length, 0, '无 Key 时不得发起任何网络请求')
    } finally {
      mock.restore()
    }
  })
})

// ---------------- Luma（M1 海外引擎 · 契约先行） ----------------

test('Luma 契约：text-to-video 请求体/端点/请求头与 fixtures 完全一致', async () => {
  const fixture = loadFixture('luma', 'submit-request')
  const mock = installFetchMock(() => jsonResponse(loadFixture('luma', 'submit-response')))
  await withSession(LUMA_SESSION, async () => {
    try {
      const provider = new LumaVideoProvider('https://mock-luma.local')
      await provider.submit({
        clientTaskId: 'lm-t2v',
        prompt: fixture.body.prompt,
        durationSec: 5,
        ratio: '9:16',
        shotId: 's1',
      })

      assert.equal(mock.calls[0].url, `https://mock-luma.local${fixture.endpoint}`)
      const sentBody = JSON.parse(String(mock.calls[0].init?.body))
      assert.deepEqual(Object.keys(sentBody).sort(), Object.keys(fixture.body).sort())
      assert.equal(sentBody.model, fixture.body.model)
      assert.equal(sentBody.aspect_ratio, fixture.body.aspect_ratio)
      assert.equal(sentBody.duration, fixture.body.duration)
      assert.equal(sentBody.loop, fixture.body.loop)
      const headers = mock.calls[0].init?.headers as Record<string, string>
      assert.equal(headers.Authorization, 'Bearer test-key')
    } finally {
      mock.restore()
    }
  })
})

test('Luma 契约：有参考图 → keyframes.frame0（type=image + data URI）', async () => {
  const fixture = loadFixture('luma', 'submit-request-i2v')
  const mock = installFetchMock(() => jsonResponse(loadFixture('luma', 'submit-response')))
  await withSession(LUMA_SESSION, async () => {
    try {
      const provider = new LumaVideoProvider('https://mock-luma.local')
      await provider.submit({
        clientTaskId: 'lm-i2v',
        prompt: fixture.body.prompt,
        imageBase64: 'AAAA',
        durationSec: 5,
        ratio: '9:16',
        shotId: 's1',
      })
      const sentBody = JSON.parse(String(mock.calls[0].init?.body))
      assert.deepEqual(Object.keys(sentBody).sort(), Object.keys(fixture.body).sort())
      assert.deepEqual(sentBody.keyframes, fixture.body.keyframes)
      assert.equal(normalizeLumaImage('AAAA'), 'data:image/jpeg;base64,AAAA')
      assert.equal(normalizeLumaImage('https://cdn/x.jpg'), 'https://cdn/x.jpg')
    } finally {
      mock.restore()
    }
  })
})

test('Luma 契约：poll 各 state 精确映射', async () => {
  const cases = [
    { fixture: 'poll-queued', expected: 'queued', progress: 10 },
    { fixture: 'poll-dreaming', expected: 'running', progress: 50 },
    { fixture: 'poll-succeed', expected: 'succeeded', progress: 100 },
    { fixture: 'poll-failed', expected: 'failed', progress: undefined },
  ] as const

  for (const { fixture, expected, progress } of cases) {
    const mock = installFetchMock(() => jsonResponse(loadFixture('luma', fixture)))
    await withSession(LUMA_SESSION, async () => {
      try {
        const provider = new LumaVideoProvider('https://mock-luma.local')
        const result = await provider.poll('luma-gen-1')
        assert.equal(result.status, expected, `fixture ${fixture} 应映射为 ${expected}`)
        if (progress !== undefined) assert.equal(result.progress, progress)
        if (expected === 'failed') assert.match(result.error || '', /内容审核未通过/)
      } finally {
        mock.restore()
      }
    })
  }
})

test('Luma 契约：failure_reason 文案映射（命中关键词中文，未知透传，缺失兜底）', () => {
  const fixture = loadFixture('luma', 'error-cases')
  for (const c of fixture.cases as Array<{ failure: string; message: string }>) {
    assert.equal(lumaErrorMessage(c.failure, 'failed'), c.message)
  }
  assert.equal(lumaErrorMessage(undefined, fixture.empty.state), fixture.empty.message)
  // 时长档位契约：ray-2 只有 5s / 9s
  assert.equal(lumaDuration(3), '5s')
  assert.equal(lumaDuration(5), '5s')
  assert.equal(lumaDuration(8), '9s')
})

test('Luma 契约：无 Key 时不发起任何请求（诚实灰态）', async () => {
  const mock = installFetchMock(() => jsonResponse({}))
  await withSession({ getItem: () => null }, async () => {
    try {
      const provider = new LumaVideoProvider('https://mock-luma.local')
      await assert.rejects(
        () => provider.submit({ clientTaskId: 'x', prompt: 'p', durationSec: 5, ratio: '9:16', shotId: 's1' }),
        /未检测到 Luma API Key/
      )
      await assert.rejects(() => provider.poll('t'), /未检测到 Luma API Key/)
      assert.equal(mock.calls.length, 0, '无 Key 时不得发起任何网络请求')
    } finally {
      mock.restore()
    }
  })
})

test('海外引擎契约：provider id 与解析器一致（executor 可路由）', async () => {
  const { resolveVideoProvider } = await import('../../director/nodes/executorNode.ts')
  assert.equal(resolveVideoProvider('runway').id, 'runway')
  assert.equal(resolveVideoProvider('luma').id, 'luma')
  // 既有引擎行为不变
  assert.equal(resolveVideoProvider('mock').id, 'mock')
  assert.equal(resolveVideoProvider('kling').id, 'kling')
  assert.equal(resolveVideoProvider('jimeng').id, 'jimeng')
  assert.equal(resolveVideoProvider('comfyui').id, 'comfyui')
})
