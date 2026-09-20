import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSET_PERSIST_MAX_BYTES,
  persistUpstreamArtifact,
  shouldPersistUpstreamUrl,
  withinPersistSizeLimit,
} from '../assetPersist.ts'

/** 造一个只满足我们用到字段的 fetch 桩（并可记录是否被调用） */
function stubFetch(impl: (url: string) => Promise<{ ok: boolean; status: number; blob: () => Promise<Blob> }>) {
  const calls: string[] = []
  const fn = (async (input: unknown) => {
    calls.push(String(input))
    return impl(String(input))
  }) as unknown as typeof fetch
  return { fn, calls }
}

const okResponse = (blob: Blob, status = 200) => ({
  ok: true,
  status,
  blob: async () => blob,
})

test('shouldPersistUpstreamUrl：只有外部 http(s) 直链需要转存', () => {
  assert.equal(shouldPersistUpstreamUrl('http://127.0.0.1:8188/view?filename=a.mp4'), true)
  assert.equal(shouldPersistUpstreamUrl('https://cdn.example/v.mp4'), true)
  // 负向：本地引用（已是持久副本）、blob（跨刷新失效走别的分支）、相对路径都不该进这条通路
  assert.equal(shouldPersistUpstreamUrl('idbref://canvas-asset-x'), false)
  assert.equal(shouldPersistUpstreamUrl('blob:http://localhost/abc'), false)
  assert.equal(shouldPersistUpstreamUrl('/api/comfyui/view?filename=a.mp4'), false)
  assert.equal(shouldPersistUpstreamUrl(''), false)
})

test('withinPersistSizeLimit：边界与非法值（不得拿 NaN 当通过）', () => {
  assert.equal(withinPersistSizeLimit(1), true)
  assert.equal(withinPersistSizeLimit(ASSET_PERSIST_MAX_BYTES), true, '恰好等于上限应允许')
  assert.equal(withinPersistSizeLimit(ASSET_PERSIST_MAX_BYTES + 1), false)
  // 负向：0 字节、负数、NaN、Infinity 一律拒绝（否则会把空文件/无意义值写进 IndexedDB）
  assert.equal(withinPersistSizeLimit(0), false)
  assert.equal(withinPersistSizeLimit(-1), false)
  assert.equal(withinPersistSizeLimit(Number.NaN), false)
  assert.equal(withinPersistSizeLimit(Number.POSITIVE_INFINITY), false)
})

test('persistUpstreamArtifact：已是 idbref 直接判已持久化，且不发网络请求', async () => {
  const { fn, calls } = stubFetch(async () => okResponse(new Blob(['x'])))
  const out = await persistUpstreamArtifact('idbref://canvas-asset-s1', 'canvas-asset-s1', {
    deps: { fetchImpl: fn },
  })
  assert.deepEqual(out, { ref: 'idbref://canvas-asset-s1', persistedLocally: true })
  assert.equal(calls.length, 0, '已是本地引用不应再拉一次网络')
})

test('persistUpstreamArtifact：非 http 引用不回退网络，如实给原因', async () => {
  const { fn, calls } = stubFetch(async () => okResponse(new Blob(['x'])))
  const out = await persistUpstreamArtifact('blob:http://localhost/abc', 'k', { deps: { fetchImpl: fn } })
  assert.equal(out.ref, 'blob:http://localhost/abc')
  assert.equal(out.persistedLocally, false)
  assert.match(out.reason ?? '', /不是 http\(s\) 直链/)
  assert.equal(calls.length, 0)
})

test('persistUpstreamArtifact：上游已声明超大体积时不下白下载（负向：fetch 不得被调用）', async () => {
  const { fn, calls } = stubFetch(async () => okResponse(new Blob(['x'])))
  const out = await persistUpstreamArtifact('http://127.0.0.1:8188/view?filename=big.mp4', 'k', {
    declaredSizeBytes: ASSET_PERSIST_MAX_BYTES + 1,
    deps: { fetchImpl: fn },
  })
  assert.equal(out.persistedLocally, false)
  assert.equal(out.ref, 'http://127.0.0.1:8188/view?filename=big.mp4', '未转存必须保留原直链，不能丢')
  assert.match(out.reason ?? '', /超过本地转存上限/)
  assert.equal(calls.length, 0, '体积超限时不应真的下载整个文件')
})

test('persistUpstreamArtifact：上游 4xx/5xx → 保留直链 + 如实原因（不抛错）', async () => {
  const { fn } = stubFetch(async () => ({ ok: false, status: 404, blob: async () => new Blob([]) }))
  const out = await persistUpstreamArtifact('http://127.0.0.1:8188/view?filename=gone.mp4', 'k', {
    deps: { fetchImpl: fn },
  })
  assert.equal(out.persistedLocally, false)
  assert.equal(out.ref, 'http://127.0.0.1:8188/view?filename=gone.mp4')
  assert.match(out.reason ?? '', /404/)
})

test('persistUpstreamArtifact：网络异常（跨域被拒 / 服务停）不抛错，回退直链', async () => {
  const fn = (async () => {
    throw new Error('Failed to fetch')
  }) as unknown as typeof fetch
  const out = await persistUpstreamArtifact('http://127.0.0.1:8188/view?filename=a.mp4', 'k', {
    deps: { fetchImpl: fn },
  })
  assert.equal(out.persistedLocally, false)
  assert.equal(out.ref, 'http://127.0.0.1:8188/view?filename=a.mp4')
  assert.match(out.reason ?? '', /Failed to fetch/)
})

test('persistUpstreamArtifact：实际体积超限 → 保留直链（宁可标清楚也不塞爆 IndexedDB）', async () => {
  const { fn } = stubFetch(async () => okResponse(new Blob([new Uint8Array(64)])))
  const out = await persistUpstreamArtifact('http://x/v.mp4', 'k', {
    deps: { fetchImpl: fn, maxBytes: 32 },
  })
  assert.equal(out.persistedLocally, false)
  assert.equal(out.ref, 'http://x/v.mp4')
  assert.match(out.reason ?? '', /超过本地转存上限/)
})

test('persistUpstreamArtifact：IndexedDB 写入失败（隐私模式/配额）→ 保留直链 + 原因', async () => {
  const { fn } = stubFetch(async () => okResponse(new Blob([new Uint8Array(8)])))
  const out = await persistUpstreamArtifact('http://x/v.mp4', 'k', {
    deps: { fetchImpl: fn, putBlobAsset: async () => null },
  })
  assert.equal(out.persistedLocally, false)
  assert.equal(out.ref, 'http://x/v.mp4')
  assert.match(out.reason ?? '', /本地存储写入失败/)
})

test('persistUpstreamArtifact：成功转存为 idbref://，命中原 key', async () => {
  const { fn } = stubFetch(async () => okResponse(new Blob([new Uint8Array(16)]), 200))
  const seen: Array<{ id: string; size: number }> = []
  const out = await persistUpstreamArtifact('http://127.0.0.1:8188/view?filename=wls.mp4', 'canvas-asset-direct-s1', {
    deps: {
      fetchImpl: fn,
      putBlobAsset: async (id, blob) => {
        seen.push({ id, size: blob.size })
        return `idbref://${id}`
      },
    },
  })
  assert.deepEqual(out, { ref: 'idbref://canvas-asset-direct-s1', persistedLocally: true })
  assert.deepEqual(seen, [{ id: 'canvas-asset-direct-s1', size: 16 }])
})
