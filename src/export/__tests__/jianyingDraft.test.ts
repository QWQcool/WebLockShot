import test from 'node:test'
import assert from 'node:assert/strict'
import { buildJianyingDraft } from '../jianyingDraft.ts'
import type { Story } from '../../types.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import type { ShotJob } from '../../domain/shotJob.ts'

test('剪映草稿工程导出：生成符合 9:16 规格的 draft_content.json', () => {
  const mockStory: Story = {
    id: 'story-mock',
    title: '高速负离子静音吹风机',
    input: { theme: '带货', character: '主播', conflict: '伤发', hook: '速干' },
    characters: [],
    setting: { place: '浴室', time: '白天', light: '明亮' },
    shots: [
      {
        id: 's1',
        order: 1,
        purpose: '反常识吸引',
        line: '还在用老旧吹风机高温烤焦头发吗？',
        durationSec: 3,
        shotSize: 'cu',
        motionId: 'push_in',
        cast: [],
      },
      {
        id: 's2',
        order: 2,
        purpose: '视觉吸睛',
        line: '全新 11 万转高速马达，3 分钟速干！',
        durationSec: 4,
        shotSize: 'ms',
        motionId: 'follow',
        cast: [],
      },
    ],
  }

  const mockPlans: VisualPlan[] = [
    {
      shotId: 's1',
      order: 1,
      kind: 'text2video',
      positive: '9:16 vertical commercial video',
      durationSec: 3,
      ratio: '9:16',
      caption: '老旧吹风机高温烤焦头发',
    },
    {
      shotId: 's2',
      order: 2,
      kind: 'text2video',
      positive: '9:16 vertical commercial video',
      durationSec: 4,
      ratio: '9:16',
      caption: '全新 11 万转高速马达',
    },
  ]

  const mockJobs: ShotJob[] = [
    {
      shotId: 's1',
      taskKey: 'k1',
      provider: 'mock',
      status: 'succeeded',
      attempt: 0,
      progress: 100,
      asset: { shotId: 's1', url: 'blob:http://localhost/s1.webm', durationSec: 3 },
    },
    {
      shotId: 's2',
      taskKey: 'k2',
      provider: 'mock',
      status: 'succeeded',
      attempt: 0,
      progress: 100,
      asset: { shotId: 's2', url: 'blob:http://localhost/s2.webm', durationSec: 4 },
    },
  ]

  const draft = buildJianyingDraft({
    story: mockStory,
    visualPlans: mockPlans,
    jobs: mockJobs,
    projectTitle: '负离子吹风机_带货工程',
  })

  // 1. 画布配置验证 (1080x1920 9:16)
  assert.equal(draft.canvas_config.width, 1080)
  assert.equal(draft.canvas_config.height, 1920)
  assert.equal(draft.canvas_config.ratio, '9:16')

  // 2. 总时长微秒验证：3s + 4s = 7s -> 7,000,000 us
  assert.equal(draft.duration, 7_000_000)

  // 3. 素材验证：2 个视频素材，2 个文本素材
  assert.equal(draft.materials.videos.length, 2)
  assert.equal(draft.materials.texts.length, 2)
  assert.equal(draft.materials.videos[0].path, 'blob:http://localhost/s1.webm')
  assert.equal(draft.materials.videos[1].path, 'blob:http://localhost/s2.webm')

  // 4. 轨道与片段验证
  assert.equal(draft.tracks.length, 2)
  const videoTrack = draft.tracks.find((t) => t.type === 'video')
  const textTrack = draft.tracks.find((t) => t.type === 'text')

  assert.ok(videoTrack, '必须包含视频主轨道')
  assert.ok(textTrack, '必须包含字幕轨道')

  assert.equal(videoTrack?.segments.length, 2)
  assert.equal(textTrack?.segments.length, 2)

  // 镜 1 时间戳对齐：0 ~ 3s
  assert.equal(videoTrack?.segments[0].target_timerange.start, 0)
  assert.equal(videoTrack?.segments[0].target_timerange.duration, 3_000_000)
  assert.equal(textTrack?.segments[0].target_timerange.start, 0)
  assert.equal(textTrack?.segments[0].target_timerange.duration, 3_000_000)

  // 镜 2 时间戳对齐：3s ~ 7s
  assert.equal(videoTrack?.segments[1].target_timerange.start, 3_000_000)
  assert.equal(videoTrack?.segments[1].target_timerange.duration, 4_000_000)
  assert.equal(textTrack?.segments[1].target_timerange.start, 3_000_000)
  assert.equal(textTrack?.segments[1].target_timerange.duration, 4_000_000)
})
