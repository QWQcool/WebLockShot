import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANVAS_PROVIDER_LABELS,
  CANVAS_PROVIDER_CHANGED_EVENT,
  CANVAS_UNWIRED_ENGINES,
  CANVAS_VIDEO_PROVIDER_KEY,
  __resetCanvasGenerateProviderForTest,
  getCanvasGenerateProviderSnapshot,
  notifyCanvasGenerateProviderChanged,
  readCanvasGenerateProvider,
  refreshCanvasGenerateProvider,
  subscribeCanvasGenerateProvider,
} from '../generateProvider.ts'

function fakeStorage(value: string | null) {
  return { getItem: (k: string) => (k === CANVAS_VIDEO_PROVIDER_KEY ? value : null) }
}

test('画布出片引擎读取：comfyui 生效，其余一律回落 mock（不静默改成别的引擎）', () => {
  assert.equal(readCanvasGenerateProvider(fakeStorage('comfyui')), 'comfyui')
  assert.equal(readCanvasGenerateProvider(fakeStorage('mock')), 'mock')
  assert.equal(readCanvasGenerateProvider(fakeStorage(null)), 'mock')
  // 未接通引擎：画布回落 mock，但必须在 UI 侧如实列出（见 CANVAS_UNWIRED_ENGINES）
  for (const engine of CANVAS_UNWIRED_ENGINES) {
    assert.equal(readCanvasGenerateProvider(fakeStorage(engine)), 'mock', `${engine} 不应在画布生效`)
  }
  // 无存储（SSR / 隐私模式抛错）也不得崩
  assert.equal(readCanvasGenerateProvider(null), 'mock')
  assert.equal(
    readCanvasGenerateProvider({
      getItem: () => {
        throw new Error('sessionStorage disabled')
      },
    }),
    'mock'
  )
})

test('画布出片引擎：标签覆盖全部已接通引擎，未接通清单不含它们', () => {
  assert.deepEqual(Object.keys(CANVAS_PROVIDER_LABELS).sort(), ['comfyui', 'mock'])
  for (const engine of CANVAS_UNWIRED_ENGINES) {
    assert.ok(!(engine in CANVAS_PROVIDER_LABELS), `${engine} 不应出现在已接通标签里`)
  }
})

test('引擎变更广播：值变化才通知（防止「设置里切了引擎画布不动」的静默偏差）', () => {
  const store = new Map<string, string>()
  const domListeners = new Map<string, Set<(e: unknown) => void>>()
  const fakeWindow = {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (!domListeners.has(type)) domListeners.set(type, new Set())
      domListeners.get(type)?.add(fn)
    },
    removeEventListener: () => {},
    dispatchEvent: (ev: { type: string }) => {
      for (const fn of domListeners.get(ev.type) ?? []) fn(ev)
      return true
    },
  }
  const g = globalThis as { window?: unknown }
  const savedWindow = g.window
  g.window = fakeWindow
  try {
    __resetCanvasGenerateProviderForTest()
    assert.equal(getCanvasGenerateProviderSnapshot(), 'mock', '默认应为演示引擎')

    let hits = 0
    const unsub = subscribeCanvasGenerateProvider(() => {
      hits++
    })
    assert.ok(domListeners.get('storage')?.size, '订阅时应挂上 storage 监听（跨标签页兜底）')
    assert.ok(domListeners.get(CANVAS_PROVIDER_CHANGED_EVENT)?.size, '订阅时应挂上自定义广播监听')

    // 值没变 → 不通知（避免无意义重渲染）
    refreshCanvasGenerateProvider()
    assert.equal(hits, 0)

    // 同标签页写 sessionStorage 不触发 storage 事件，只能靠显式广播
    store.set(CANVAS_VIDEO_PROVIDER_KEY, 'comfyui')
    notifyCanvasGenerateProviderChanged()
    assert.equal(hits, 1, '切到 comfyui 必须通知订阅者')
    assert.equal(getCanvasGenerateProviderSnapshot(), 'comfyui')

    // 重复广播值未变 → 不重复通知
    notifyCanvasGenerateProviderChanged()
    assert.equal(hits, 1)

    store.set(CANVAS_VIDEO_PROVIDER_KEY, 'mock')
    notifyCanvasGenerateProviderChanged()
    assert.equal(hits, 2)
    assert.equal(getCanvasGenerateProviderSnapshot(), 'mock')

    // 未接通引擎落回 mock，不产生额外通知（值仍是 mock）
    store.set(CANVAS_VIDEO_PROVIDER_KEY, 'kling')
    notifyCanvasGenerateProviderChanged()
    assert.equal(hits, 2)
    assert.equal(getCanvasGenerateProviderSnapshot(), 'mock')

    unsub()
    store.set(CANVAS_VIDEO_PROVIDER_KEY, 'comfyui')
    notifyCanvasGenerateProviderChanged()
    assert.equal(hits, 2, '退订后不应再收到通知')
  } finally {
    g.window = savedWindow
    __resetCanvasGenerateProviderForTest()
  }
})
