import test from 'node:test'
import assert from 'node:assert/strict'
import { extractHeavyAssets, hydratePipelineSession } from '../../persistV2.ts'
import { IDB_REF_PREFIX } from '../../persist/assetStore.ts'
import type { PipelineSessionV2 } from '../../persistV2.ts'
import type { ShotJob } from '../../domain/shotJob.ts'

const BIG_IMAGE = 'data:image/png;base64,' + 'A'.repeat(8192)

function makeSession(overrides: Partial<PipelineSessionV2> = {}): PipelineSessionV2 {
  return {
    version: 2,
    id: 'test-session',
    activeStep: 2,
    updatedAt: 0,
    ...overrides,
  }
}

test('持久化瘦身：dataURL 大资产替换为 idbref 索引且 localStorage 副本不再含 base64', () => {
  const session = makeSession({
    productInput: {
      source: 'image',
      title: '测试商品',
      imagePreview: BIG_IMAGE,
      sellingPointsManual: [],
    },
  })

  const { sanitized, assets } = extractHeavyAssets(session)

  // 大资产被抽离为引用
  assert.ok(sanitized.productInput?.imagePreview?.startsWith(IDB_REF_PREFIX))
  assert.equal(assets.length, 1)
  assert.equal(assets[0].dataUrl, BIG_IMAGE)
  // 原始 dataURL 不得残留在瘦身副本中
  assert.ok(!JSON.stringify(sanitized).includes('A'.repeat(100)))
})

test('持久化瘦身：小 dataURL 与 http/blob 引用不被外移；blob: 死链直接置空', () => {
  const session = makeSession({
    productInput: {
      source: 'image',
      imagePreview: 'data:image/png;base64,tiny', // 小图不外移
      sellingPointsManual: [],
    },
    visualPlans: [
      {
        shotId: 's1',
        order: 1,
        kind: 'text2video',
        positive: 'p',
        durationSec: 3,
        ratio: '9:16',
        referenceImage: 'https://cdn.example.com/img.png', // http 不动
      },
      {
        shotId: 's2',
        order: 2,
        kind: 'text2video',
        positive: 'p',
        durationSec: 3,
        ratio: '9:16',
        referenceImage: 'blob:http://localhost/dead-on-reload', // blob: 置空
      },
    ],
    jobs: [
      {
        shotId: 's1',
        taskKey: 'k',
        provider: 'mock',
        status: 'succeeded',
        attempt: 0,
        progress: 100,
        asset: { shotId: 's1', url: 'blob:http://localhost/video', durationSec: 3 },
      },
    ],
  })

  const { sanitized, assets } = extractHeavyAssets(session)

  assert.equal(assets.length, 0, '无大资产需要外移')
  assert.equal(sanitized.productInput?.imagePreview, 'data:image/png;base64,tiny')
  assert.equal(sanitized.visualPlans?.[0].referenceImage, 'https://cdn.example.com/img.png')
  assert.equal(sanitized.visualPlans?.[1].referenceImage, undefined, 'blob: 死链应被置空')
  assert.equal(sanitized.jobs?.[0].asset?.urlExpired, true, 'blob: 视频资产应标记 expired')
})

test('持久化瘦身：同内容 dataURL 去重为同一引用', () => {
  const session = makeSession({
    productInput: { source: 'image', imagePreview: BIG_IMAGE, sellingPointsManual: [] },
    visualPlans: [
      { shotId: 's1', order: 1, kind: 'text2video', positive: 'p', durationSec: 3, ratio: '9:16', referenceImage: BIG_IMAGE },
      { shotId: 's2', order: 2, kind: 'text2video', positive: 'p', durationSec: 3, ratio: '9:16', referenceImage: BIG_IMAGE },
    ],
  })

  const { sanitized, assets } = extractHeavyAssets(session)
  assert.equal(assets.length, 1, '同内容资产应去重只存一份')
  const ref = sanitized.productInput?.imagePreview
  assert.equal(ref, sanitized.visualPlans?.[0].referenceImage)
  assert.equal(ref, sanitized.visualPlans?.[1].referenceImage)
})

test('持久化水合：idbref 恢复为可用资源，无法恢复置空，blob: 标记 expired', async () => {
  const ref = `${IDB_REF_PREFIX}img_abc_8320`
  const session = makeSession({
    productInput: { source: 'image', imagePreview: ref, sellingPointsManual: [] },
    visualPlans: [
      { shotId: 's1', order: 1, kind: 'text2video', positive: 'p', durationSec: 3, ratio: '9:16', referenceImage: `${IDB_REF_PREFIX}missing` },
    ],
    jobs: [
      {
        shotId: 's1',
        taskKey: 'k',
        provider: 'mock',
        status: 'succeeded',
        attempt: 0,
        progress: 100,
        asset: { shotId: 's1', url: 'blob:http://localhost/video', durationSec: 3 },
      },
    ],
  })

  const hydrated = await hydratePipelineSession(session, async (id) =>
    id === 'img_abc_8320' ? 'blob:http://localhost/restored' : null
  )

  assert.equal(hydrated.productInput?.imagePreview, 'blob:http://localhost/restored')
  assert.equal(hydrated.visualPlans?.[0].referenceImage, undefined, '恢复失败的引用应置空')
  assert.equal(hydrated.jobs?.[0].asset?.urlExpired, true)

  const expiredJobs: ShotJob[] = hydrated.jobs || []
  assert.ok(expiredJobs[0].asset && 'urlExpired' in expiredJobs[0].asset)
})
