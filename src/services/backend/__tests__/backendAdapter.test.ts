import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getBackendAdapter,
  getLocalAdapter,
  isRestBackendConfigured,
  resetBackendAdapterForTest,
} from '../index.ts'
import { createRestAdapter } from '../restAdapter.ts'
import type { BackendAdapter, StorageQuota } from '../types.ts'
import type { PipelineSessionV2 } from '../../../persistV2.ts'

/** 测试用 localStorage 桩（localAdapter 经 window.localStorage 访问） */
function installLocalStorageStub(): Map<string, string> {
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  }
  ;(globalThis as { window?: unknown }).window = { localStorage: stub }
  ;(globalThis as { localStorage?: unknown }).localStorage = stub
  return store
}

function makeSession(id = 's1'): PipelineSessionV2 {
  return {
    version: 2,
    id,
    activeStep: 1,
    updatedAt: 42,
    productInput: { source: 'image', title: '测试商品', sellingPointsManual: [] },
  }
}

test('工厂：默认（无任何配置）返回 local adapter，行为保持现状', () => {
  resetBackendAdapterForTest()
  const adapter = getBackendAdapter()
  assert.equal(adapter.mode, 'local')
  assert.equal(getBackendAdapter(), getLocalAdapter())
  assert.equal(isRestBackendConfigured(), false)
})

test('工厂：显式 backendUrl 返回 rest adapter；测试钩子 __WLS_BACKEND_URL__ 生效', () => {
  resetBackendAdapterForTest()
  assert.equal(getBackendAdapter({ backendUrl: 'https://api.example.com' }).mode, 'rest')
  assert.equal(isRestBackendConfigured({ backendUrl: 'https://api.example.com' }), true)

  resetBackendAdapterForTest()
  ;(globalThis as { __WLS_BACKEND_URL__?: unknown }).__WLS_BACKEND_URL__ = 'http://127.0.0.1:5174'
  assert.equal(getBackendAdapter().mode, 'rest')
  assert.equal(isRestBackendConfigured(), true) // 钩子已设置
  resetBackendAdapterForTest()
  assert.equal(isRestBackendConfigured(), false) // 重置后恢复 false
})

test('localAdapter：save/load/clear 走 localStorage 桩，语义与历史 persistV2 一致', async () => {
  const store = installLocalStorageStub()
  const adapter = getLocalAdapter()

  await adapter.saveSession(makeSession())
  const raw = store.get('weblockshot.pipeline.v2')
  assert.ok(raw)
  const parsed = JSON.parse(raw!) as PipelineSessionV2
  assert.equal(parsed.version, 2)
  assert.equal(parsed.productInput?.title, '测试商品')
  assert.notEqual(parsed.updatedAt, 42) // 保存时盖 updatedAt 时间戳（历史行为）

  const loaded = adapter.loadSessionSync!()
  assert.equal(loaded?.id, 's1')
  assert.equal((await adapter.loadSession())?.id, 's1')

  // 水合：无 idbref 引用的会话原样返回
  const hydrated = await adapter.loadHydratedSession()
  assert.equal(hydrated?.productInput?.title, '测试商品')

  await adapter.clearSession()
  assert.equal(store.get('weblockshot.pipeline.v2'), undefined)
  assert.equal(adapter.loadSessionSync!(), null)
})

test('restAdapter：saveSession PUT /api/sessions/:id，loadSession 404 → null', async () => {
  let capturedUrl = ''
  let capturedMethod = ''
  let capturedBody = ''
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(url)
    capturedMethod = init?.method || 'GET'
    capturedBody = String(init?.body || '')
    if (capturedMethod === 'PUT') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    return new Response(JSON.stringify({ id: 'default', data: makeSession('remote') }), { status: 200 })
  }) as unknown as typeof fetch

  const adapter = createRestAdapter('http://backend.test', { fetchImpl })
  await adapter.saveSession(makeSession())
  assert.equal(capturedUrl, 'http://backend.test/api/sessions/s1')
  assert.equal(capturedMethod, 'PUT')
  assert.ok(capturedBody.includes('"version":2'))

  const loaded = await adapter.loadSession()
  assert.equal(loaded?.id, 'remote')
})

test('restAdapter：网络失败自动降级 local 并仅告警一次（不打日志噪音）', async () => {
  const store = installLocalStorageStub()
  const degradeReasons: string[] = []
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch

  const localFallback: BackendAdapter = {
    mode: 'local',
    saveSession: async (s) => {
      store.set('fallback', JSON.stringify(s))
    },
    loadSession: async () => JSON.parse(store.get('fallback') || 'null'),
    loadHydratedSession: async () => JSON.parse(store.get('fallback') || 'null'),
    clearSession: async () => {
      store.delete('fallback')
    },
    getQuota: async (): Promise<StorageQuota | null> => ({ usageBytes: 1, quotaBytes: 2 }),
  }

  const adapter = createRestAdapter('http://backend.test', {
    fetchImpl,
    fallback: localFallback,
    onDegrade: (reason) => degradeReasons.push(reason),
  })

  await adapter.saveSession(makeSession())
  assert.equal(degradeReasons.length, 1) // 仅首次告警
  assert.ok(store.get('fallback')) // 降级后本地兜底保存成功

  // 降级态：后续操作不再触网，直接走 local
  const loaded = await adapter.loadSession()
  assert.equal(loaded?.id, 's1')
  assert.equal(calls, 1)

  const quota = await adapter.getQuota()
  assert.deepEqual(quota, { usageBytes: 1, quotaBytes: 2 })
})

test('restAdapter：5xx 视为网络失败触发降级，4xx 不降级', async () => {
  // —— 5xx：触发降级（onDegrade 恰好一次 + 本地兜底被调用）——
  const degradeReasons5xx: string[] = []
  let fallbackCalls5xx = 0
  const adapter = createRestAdapter('http://backend.test', {
    fetchImpl: (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch,
    fallback: {
      mode: 'local',
      saveSession: async () => void fallbackCalls5xx++,
      loadSession: async () => null,
      loadHydratedSession: async () => null,
      clearSession: async () => {},
      getQuota: async () => null,
    },
    onDegrade: (r) => degradeReasons5xx.push(r),
  })
  await adapter.saveSession(makeSession())
  assert.equal(degradeReasons5xx.length, 1)
  assert.equal(fallbackCalls5xx, 1)

  // —— 4xx：业务错误，不降级（不告警、不兜底）——
  const degradeReasons403: string[] = []
  let fallbackCalls403 = 0
  const adapter2 = createRestAdapter('http://backend.test', {
    fetchImpl: (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch,
    fallback: {
      mode: 'local',
      saveSession: async () => void fallbackCalls403++,
      loadSession: async () => null,
      loadHydratedSession: async () => null,
      clearSession: async () => {},
      getQuota: async () => null,
    },
    onDegrade: (r) => degradeReasons403.push(r),
  })
  await adapter2.saveSession(makeSession())
  assert.equal(degradeReasons403.length, 0)
  assert.equal(fallbackCalls403, 0)
})

test('restAdapter：save→load→clear roundtrip 走同一会话键（修复读写断裂）', async () => {
  // mock 后端：按 id 存取的内存 Map，模拟真实 server 行为
  const remote = new Map<string, PipelineSessionV2>()
  const capturedUrls: string[] = []
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    capturedUrls.push(`${init?.method || 'GET'} ${u}`)
    const id = decodeURIComponent(u.split('/api/sessions/')[1] || '')
    const method = init?.method || 'GET'
    if (method === 'PUT') {
      remote.set(id, (JSON.parse(String(init?.body)) as { data: PipelineSessionV2 }).data)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (method === 'GET') {
      return remote.has(id)
        ? new Response(JSON.stringify({ id, data: remote.get(id) }), { status: 200 })
        : new Response(JSON.stringify({ error: '会话不存在' }), { status: 404 })
    }
    if (method === 'DELETE') {
      remote.delete(id)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    return new Response('nf', { status: 404 })
  }) as unknown as typeof fetch

  const adapter = createRestAdapter('http://backend.test', { fetchImpl })

  // 未 save 前首次 load 回退 'default'（向后兼容），404 → null
  assert.equal(await adapter.loadSession(), null)
  assert.ok(capturedUrls[0].endsWith('/api/sessions/default'))

  // save 以 session.id 为键
  const session = makeSession('s-abc')
  await adapter.saveSession(session)
  assert.ok(capturedUrls[1].endsWith('/api/sessions/s-abc'))
  assert.ok(remote.has('s-abc'))

  // load 使用与 save 相同的 id（而非写死 'default'）→ 返回一致数据
  const loaded = await adapter.loadSession()
  assert.ok(loaded, 'load 应命中 save 写入的会话（同键）')
  assert.equal(loaded?.id, 's-abc')
  assert.equal(loaded?.productInput?.title, '测试商品')

  // loadHydratedSession 同样命中
  assert.equal((await adapter.loadHydratedSession())?.id, 's-abc')

  // clear 使用同一 id 删除
  await adapter.clearSession()
  assert.ok(capturedUrls[capturedUrls.length - 1].endsWith('/api/sessions/s-abc'))
  assert.equal(remote.has('s-abc'), false)

  // clear 后 load 为空
  assert.equal(await adapter.loadSession(), null)
})

test('restAdapter：连续 save 不同 id 时 load/clear 跟随最近一次 save 的 id', async () => {
  const remote = new Map<string, PipelineSessionV2>()
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    const id = decodeURIComponent(u.split('/api/sessions/')[1] || '')
    const method = init?.method || 'GET'
    if (method === 'PUT') {
      remote.set(id, (JSON.parse(String(init?.body)) as { data: PipelineSessionV2 }).data)
      return new Response('{"ok":true}', { status: 200 })
    }
    if (method === 'DELETE') {
      remote.delete(id)
      return new Response('{"ok":true}', { status: 200 })
    }
    return remote.has(id)
      ? new Response(JSON.stringify({ id, data: remote.get(id) }), { status: 200 })
      : new Response('nf', { status: 404 })
  }) as unknown as typeof fetch

  const adapter = createRestAdapter('http://backend.test', { fetchImpl })
  await adapter.saveSession(makeSession('s-old'))
  await adapter.saveSession(makeSession('s-new'))
  assert.equal((await adapter.loadSession())?.id, 's-new')
  await adapter.clearSession()
  assert.equal(remote.has('s-new'), false)
  assert.equal(remote.has('s-old'), true, 'clear 只删最近 save 的键，不影响其他会话')
})
