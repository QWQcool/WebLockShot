/**
 * 剪映 / CapCut 电脑版草稿导出引擎
 * 生成符合剪映规格的 draft_content.json
 * 时间单位：微秒 (microseconds, 1秒 = 1,000,000 微秒)
 * 画面预设：1080x1920 9:16 竖屏，30 FPS
 */

import type { Story } from '../types.ts'
import type { VisualPlan } from '../domain/sellVisual.ts'
import type { ShotJob } from '../domain/shotJob.ts'

function randomId(prefix = ''): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

export type JianyingDraftOptions = {
  story: Story
  visualPlans?: VisualPlan[]
  jobs?: ShotJob[]
  projectTitle?: string
}

export type JianyingDraftContent = {
  canvas_config: {
    height: number
    ratio: string
    width: number
  }
  color_space: number
  config: Record<string, unknown>
  duration: number
  fps: number
  id: string
  materials: {
    videos: Array<{
      id: string
      duration: number
      height: number
      width: number
      material_name: string
      path: string
      type: string
    }>
    texts: Array<{
      id: string
      content: string
      type: string
    }>
    speeds: unknown[]
    canvases: unknown[]
  }
  tracks: Array<{
    attribute: number
    flag: number
    id: string
    is_default_name: boolean
    name: string
    segments: Array<{
      id: string
      material_id: string
      target_timerange: {
        duration: number
        start: number
      }
      source_timerange?: {
        duration: number
        start: number
      }
      speed?: number
      volume?: number
    }>
    type: string
  }>
  version: number
}

/**
 * 编译生成剪映草稿 draft_content.json 结构
 */
export function buildJianyingDraft(options: JianyingDraftOptions): JianyingDraftContent {
  const { story, visualPlans = [], jobs = [], projectTitle = 'WebLockShot_带货工程' } = options

  const videoMaterials: JianyingDraftContent['materials']['videos'] = []
  const textMaterials: JianyingDraftContent['materials']['texts'] = []
  const videoSegments: JianyingDraftContent['tracks'][0]['segments'] = []
  const textSegments: JianyingDraftContent['tracks'][0]['segments'] = []

  let currentStartUs = 0

  story.shots.forEach((shot, index) => {
    const plan = visualPlans.find((p) => p.shotId === shot.id)
    const job = jobs.find((j) => j.shotId === shot.id)

    const durSec = shot.durationSec || 5
    const durUs = Math.round(durSec * 1_000_000)

    // 1. 视频素材及片段
    const videoMatId = randomId('mat_v_')
    const videoAssetUrl = job?.asset?.url || ''
    const videoName = `Shot_${index + 1}_${shot.id}.mp4`

    videoMaterials.push({
      id: videoMatId,
      duration: durUs,
      height: 1920,
      width: 1080,
      material_name: videoName,
      path: videoAssetUrl,
      type: 'video',
    })

    videoSegments.push({
      id: randomId('seg_v_'),
      material_id: videoMatId,
      target_timerange: {
        duration: durUs,
        start: currentStartUs,
      },
      source_timerange: {
        duration: durUs,
        start: 0,
      },
      speed: 1.0,
      volume: 1.0,
    })

    // 2. 字幕素材及片段
    const textMatId = randomId('mat_t_')
    const subtitleText = shot.line || plan?.caption || `镜头 ${index + 1}`
    
    // 剪映文本 content 是 JSON 字符串包装
    const textJsonContent = JSON.stringify({
      styles: [
        {
          fill: {
            alpha: 1.0,
            content: {
              render_type: 'solid',
              solid: {
                color: [1.0, 1.0, 1.0],
              },
            },
          },
          font: {
            id: '',
            path: '',
          },
          range: [0, subtitleText.length],
          size: 8.0,
        },
      ],
      text: subtitleText,
    })

    textMaterials.push({
      id: textMatId,
      content: textJsonContent,
      type: 'text',
    })

    textSegments.push({
      id: randomId('seg_t_'),
      material_id: textMatId,
      target_timerange: {
        duration: durUs,
        start: currentStartUs,
      },
    })

    currentStartUs += durUs
  })

  return {
    canvas_config: {
      height: 1920,
      ratio: '9:16',
      width: 1080,
    },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_light_source: false,
      lyrics_recognition_id: '',
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      original_sound_last_has_read: false,
      record_audio_last_has_read: false,
      roughcut_time_range: { duration: 0, start: 0 },
      sub_scene: 'default',
      timeline_speed_scale: 1.0,
      video_speed_curve: false,
      video_time_base: 30,
      zoom_info_params: null,
      project_name: projectTitle,
    },
    duration: currentStartUs,
    fps: 30.0,
    id: randomId('draft_'),
    materials: {
      videos: videoMaterials,
      texts: textMaterials,
      speeds: [],
      canvases: [],
    },
    tracks: [
      {
        attribute: 0,
        flag: 0,
        id: randomId('track_video_'),
        is_default_name: true,
        name: '视频主轨道',
        segments: videoSegments,
        type: 'video',
      },
      {
        attribute: 0,
        flag: 0,
        id: randomId('track_text_'),
        is_default_name: true,
        name: '字幕轨道',
        segments: textSegments,
        type: 'text',
      },
    ],
    version: 3000000,
  }
}

/**
 * 触发浏览器直接下载 draft_content.json
 */
export function downloadJianyingDraft(options: JianyingDraftOptions): void {
  if (typeof window === 'undefined') return
  const draft = buildJianyingDraft(options)
  const jsonStr = JSON.stringify(draft, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = 'draft_content.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
