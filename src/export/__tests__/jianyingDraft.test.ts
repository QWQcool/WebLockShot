import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildJianyingDraft,
  buildJianyingDraftMetaInfo,
  buildJianyingZipPackage,
} from '../jianyingDraft.ts'
import type { Story } from '../../types.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import type { ShotJob } from '../../domain/shotJob.ts'

test('剪映草稿工程导出：生成符合 9:16 规格且音视字三轨微秒级对齐的 draft_content.json', () => {
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

  // 3. 物料素材验证：2 个视频素材，2 个音频素材，2 个文本素材
  assert.equal(draft.materials.videos.length, 2)
  assert.equal(draft.materials.audios.length, 2)
  assert.equal(draft.materials.texts.length, 2)
  assert.equal(draft.materials.videos[0].path, 'blob:http://localhost/s1.webm')
  assert.equal(draft.materials.videos[1].path, 'blob:http://localhost/s2.webm')

  // 4. 轨道与片段三轨微秒严密对齐验证 (视频主轨、音频配音轨、花字字幕轨)
  assert.equal(draft.tracks.length, 3)
  const videoTrack = draft.tracks.find((t) => t.type === 'video')
  const audioTrack = draft.tracks.find((t) => t.type === 'audio')
  const textTrack = draft.tracks.find((t) => t.type === 'text')

  assert.ok(videoTrack, '必须包含视频主轨道')
  assert.ok(audioTrack, '必须包含旁白配音音频轨道')
  assert.ok(textTrack, '必须包含花字字幕轨道')

  assert.equal(videoTrack?.segments.length, 2)
  assert.equal(audioTrack?.segments.length, 2)
  assert.equal(textTrack?.segments.length, 2)

  // 镜头 1 三轨时间戳微秒对齐：0 ~ 3,000,000 us
  assert.equal(videoTrack?.segments[0].target_timerange.start, 0)
  assert.equal(videoTrack?.segments[0].target_timerange.duration, 3_000_000)
  assert.equal(audioTrack?.segments[0].target_timerange.start, 0)
  assert.equal(audioTrack?.segments[0].target_timerange.duration, 3_000_000)
  assert.equal(textTrack?.segments[0].target_timerange.start, 0)
  assert.equal(textTrack?.segments[0].target_timerange.duration, 3_000_000)

  // 镜头 2 三轨时间戳微秒对齐：3,000,000 ~ 7,000,000 us
  assert.equal(videoTrack?.segments[1].target_timerange.start, 3_000_000)
  assert.equal(videoTrack?.segments[1].target_timerange.duration, 4_000_000)
  assert.equal(audioTrack?.segments[1].target_timerange.start, 3_000_000)
  assert.equal(audioTrack?.segments[1].target_timerange.duration, 4_000_000)
  assert.equal(textTrack?.segments[1].target_timerange.start, 3_000_000)
  assert.equal(textTrack?.segments[1].target_timerange.duration, 4_000_000)

  // 5. 元数据 draft_meta_info.json 导出测试
  const meta = buildJianyingDraftMetaInfo({
    story: mockStory,
    projectTitle: '负离子吹风机_带货工程',
  })
  assert.equal(meta.draft_name, '负离子吹风机_带货工程')
  assert.equal(meta.tm_duration, 7_000_000)
})

test('剪映草稿工程导出：片段携带真实导入所需字段 (clip/render_index/extra_material_refs/common_keyframes)', () => {
  const story: Story = {
    id: 'story-clip',
    title: '真实结构校验',
    input: { theme: '带货', character: '主播', conflict: 'x', hook: 'y' },
    characters: [],
    setting: { place: 'p', time: 't', light: 'l' },
    shots: [
      {
        id: 's1',
        order: 1,
        purpose: 'p',
        line: '字幕文本',
        durationSec: 2,
        shotSize: 'cu',
        motionId: 'push_in',
        cast: [],
      },
    ],
  }

  const draft = buildJianyingDraft({ story, projectTitle: 'clip校验' })
  const seg = draft.tracks[0].segments[0]

  assert.ok(seg.clip, '片段必须携带 clip 变换信息')
  assert.equal(seg.clip?.alpha, 1.0)
  assert.deepEqual(seg.clip?.flip, { horizontal: false, vertical: false })
  assert.equal(seg.clip?.rotation, 0)
  assert.deepEqual(seg.clip?.scale, { x: 1, y: 1 })
  assert.equal(seg.render_index, 0, '必须携带 render_index')
  assert.deepEqual(seg.extra_material_refs, [], '必须携带 extra_material_refs 数组')
  assert.deepEqual(seg.common_keyframes, [], '必须携带 common_keyframes 数组')
  assert.deepEqual(seg.uniform_scale, { on: true, value: 1 })

  // 音频素材 path 指向包内相对路径
  assert.equal(draft.materials.audios[0].path, 'assets/voice_s1.mp3')
  // 平台信息与封面字段存在
  assert.equal(draft.platform.app_source, 'weblockshot')
  assert.equal(draft.cover, '')
})

test('剪映草稿 zip 打包：视频素材落包 + 路径改写 + 使用说明', async () => {
  const story: Story = {
    id: 'story-zip',
    title: 'zip打包校验',
    input: { theme: '带货', character: '主播', conflict: 'x', hook: 'y' },
    characters: [],
    setting: { place: 'p', time: 't', light: 'l' },
    shots: [
      {
        id: 's1',
        order: 1,
        purpose: 'p',
        line: '台词一',
        durationSec: 2,
        shotSize: 'cu',
        motionId: 'push_in',
        cast: [],
      },
    ],
  }
  const jobs: ShotJob[] = [
    {
      shotId: 's1',
      taskKey: 'k1',
      provider: 'mock',
      status: 'succeeded',
      attempt: 0,
      progress: 100,
      asset: { shotId: 's1', url: 'blob:http://localhost/s1.webm', durationSec: 2 },
    },
  ]

  // Node 环境无法解析 blob: URL —— 期望素材进入 missingAssets 而不是抛错
  const result = await buildJianyingZipPackage({ story, jobs, projectTitle: 'zip校验' })

  assert.ok(result.bytes.length > 0, 'zip 字节流必须非空')
  assert.match(result.filename, /zip校验_剪映草稿\.zip/)
  const decoder = new TextDecoder()
  const zipText = decoder.decode(result.bytes)
  assert.ok(zipText.includes('draft_content.json'), 'zip 必须包含 draft_content.json')
  assert.ok(zipText.includes('draft_meta_info.json'), 'zip 必须包含 draft_meta_info.json')
  assert.ok(zipText.includes('README-使用说明.txt'), 'zip 必须包含使用说明')
  assert.equal(result.missingAssets.length, 1, 'blob: URL 在 Node 下无法抓取，应记录缺失而非崩溃')
})
