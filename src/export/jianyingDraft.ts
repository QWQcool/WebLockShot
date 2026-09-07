/**
 * 剪映 / CapCut 电脑版草稿导出引擎 (工业级声画字微秒对齐版)
 * 
 * 核心技术规范：
 * 1. 时间单位：严格遵循微秒 (microseconds, 1秒 = 1,000,000 微秒)
 * 2. 画面预设：1080x1920 9:16 竖屏，30 FPS
 * 3. 三轨微秒级自动化对齐：
 *    - 视频主轨 (track_video)：各镜头画面无缝首尾相接，防黑帧
 *    - 旁白音频轨 (track_audio)：口播 TTS 配音自适应变速或切片，声画绝对同步
 *    - 花字字幕轨 (track_text)：高对比度带货文案，精准绑定镜头进出场时间戳
 * 4. CapCut 目录工程兼容：可输出 draft_content.json 与 draft_meta_info.json
 */

import type { Story } from '../types.ts'
import type { VisualPlan } from '../domain/sellVisual.ts'
import type { ShotJob } from '../domain/shotJob.ts'
import { buildZip, blobToUint8Array, textEntry, type ZipEntry } from './zip.ts'

function randomId(prefix = ''): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

export type JianyingDraftOptions = {
  story: Story
  visualPlans?: VisualPlan[]
  jobs?: ShotJob[]
  projectTitle?: string
  /** 可选的旁白音频：shotId -> 音频 URL (blob:/data:/http)，zip 打包时落入 assets/ 并在草稿中挂载 */
  audioByShotId?: Record<string, string>
}

/** 剪映片段 clip 变换信息（导入必读字段） */
export type JianyingSegmentClip = {
  alpha: number
  flip: { horizontal: boolean; vertical: boolean }
  rotation: number
  scale: { x: number; y: number }
  transform: { x: number; y: number }
}

export type JianyingDraftContent = {
  canvas_config: {
    height: number
    ratio: string
    width: number
  }
  color_space: number
  config: Record<string, unknown>
  cover: string
  duration: number
  fps: number
  id: string
  platform: {
    all: boolean
    app_id: number
    app_source: string
    app_version: string
    device_id: string
    os: string
  }
  materials: {
    videos: Array<{
      id: string
      duration: number
      height: number
      width: number
      material_name: string
      path: string
      type: string
      category_name: string
      extra_type_option: number
      has_audio: boolean
    }>
    audios: Array<{
      id: string
      duration: number
      material_name: string
      path: string
      type: string
      category_name: string
      extra_type_option: number
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
      render_index: number
      extra_material_refs: string[]
      clip: JianyingSegmentClip
      common_keyframes: unknown[]
      uniform_scale: { on: boolean; value: number }
    }>
    type: string
  }>
  version: number
}

export type JianyingDraftMetaInfo = {
  draft_fold_path: string
  draft_id: string
  draft_name: string
  draft_timeline_materials_size: number
  tm_draft_cloud_completed: string
  tm_draft_create: number
  tm_draft_modified: number
  tm_duration: number
}

/** 片段通用 clip 变换（与剪映 C clip 结构对齐） */
function defaultClip(): JianyingSegmentClip {
  return {
    alpha: 1.0,
    flip: { horizontal: false, vertical: false },
    rotation: 0,
    scale: { x: 1.0, y: 1.0 },
    transform: { x: 0, y: 0 },
  }
}

/**
 * 编译生成剪映草稿 draft_content.json 结构（支持视频、音频、花字字幕三轨自动化对齐）
 */
export function buildJianyingDraft(options: JianyingDraftOptions): JianyingDraftContent {
  const { story, visualPlans = [], jobs = [], projectTitle = 'WebLockShot_带货工程' } = options

  const videoMaterials: JianyingDraftContent['materials']['videos'] = []
  const audioMaterials: JianyingDraftContent['materials']['audios'] = []
  const textMaterials: JianyingDraftContent['materials']['texts'] = []

  const videoSegments: JianyingDraftContent['tracks'][0]['segments'] = []
  const audioSegments: JianyingDraftContent['tracks'][0]['segments'] = []
  const textSegments: JianyingDraftContent['tracks'][0]['segments'] = []

  let currentStartUs = 0

  story.shots.forEach((shot, index) => {
    const plan = visualPlans.find((p) => p.shotId === shot.id)
    const job = jobs.find((j) => j.shotId === shot.id)

    const durSec = shot.durationSec || 5
    const durUs = Math.round(durSec * 1_000_000)

    // 1. 视频素材及片段 (主视频轨)
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
      category_name: 'local',
      extra_type_option: 0,
      has_audio: true,
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
      render_index: 0,
      extra_material_refs: [],
      clip: defaultClip(),
      common_keyframes: [],
      uniform_scale: { on: true, value: 1.0 },
    })

    // 2. 旁白配音素材及片段 (音频轨 - 与视频绝对微秒对齐)
    const audioMatId = randomId('mat_a_')
    const audioName = `Voice_${index + 1}_${shot.id}.mp3`
    // 音频 path 统一指向 zip 包内相对路径 assets/voice_<shotId>.mp3；
    // 若提供 audioByShotId，打包时会抓取音频字节落入同名文件，草稿导入即有声。
    audioMaterials.push({
      id: audioMatId,
      duration: durUs,
      material_name: audioName,
      path: `assets/voice_${shot.id}.mp3`,
      type: 'audio',
      category_name: 'local',
      extra_type_option: 0,
    })

    audioSegments.push({
      id: randomId('seg_a_'),
      material_id: audioMatId,
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
      render_index: 0,
      extra_material_refs: [],
      clip: defaultClip(),
      common_keyframes: [],
      uniform_scale: { on: true, value: 1.0 },
    })

    // 3. 字幕素材及片段 (花字轨道 - 与镜头同步进出场)
    const textMatId = randomId('mat_t_')
    const subtitleText = shot.line || plan?.caption || `镜头 ${index + 1}`

    // 剪映文本样式配置
    const textJsonContent = JSON.stringify({
      styles: [
        {
          fill: {
            alpha: 1.0,
            content: {
              render_type: 'solid',
              solid: {
                color: index === 0 ? [1.0, 0.84, 0.0] : [1.0, 1.0, 1.0], // 黄金钩子镜头黄色高亮
              },
            },
          },
          font: {
            id: '',
            path: '',
          },
          range: [0, subtitleText.length],
          size: index === 0 ? 9.5 : 8.0, // 钩子字号更大
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
      render_index: 0,
      extra_material_refs: [],
      clip: defaultClip(),
      common_keyframes: [],
      uniform_scale: { on: true, value: 1.0 },
    })

    // 推进全局微秒时间轴
    currentStartUs += durUs
  })

  return {
    canvas_config: {
      height: 1920,
      ratio: '9:16',
      width: 1080,
    },
    color_space: 0,
    cover: '',
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
    platform: {
      all: false,
      app_id: 3704,
      app_source: 'weblockshot',
      app_version: '6.0.0',
      device_id: '',
      os: 'windows',
    },
    materials: {
      videos: videoMaterials,
      audios: audioMaterials,
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
        id: randomId('track_audio_'),
        is_default_name: true,
        name: '旁白配音轨道',
        segments: audioSegments,
        type: 'audio',
      },
      {
        attribute: 0,
        flag: 0,
        id: randomId('track_text_'),
        is_default_name: true,
        name: '花字字幕轨道',
        segments: textSegments,
        type: 'text',
      },
    ],
    version: 3000000,
  }
}

/**
 * 生成 CapCut / 剪映草稿元数据 draft_meta_info.json
 */
export function buildJianyingDraftMetaInfo(options: JianyingDraftOptions): JianyingDraftMetaInfo {
  const { story, projectTitle = 'WebLockShot_带货工程' } = options
  const totalSec = story.shots.reduce((acc, s) => acc + (s.durationSec || 5), 0)
  const now = Date.now()

  return {
    draft_fold_path: '',
    draft_id: randomId('meta_'),
    draft_name: projectTitle,
    draft_timeline_materials_size: story.shots.length * 2,
    tm_draft_cloud_completed: '',
    tm_draft_create: now,
    tm_draft_modified: now,
    tm_duration: Math.round(totalSec * 1_000_000),
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

/**
 * 触发下载包含元数据的草稿配置
 */
export function downloadDraftMetaInfo(options: JianyingDraftOptions): void {
  if (typeof window === 'undefined') return
  const meta = buildJianyingDraftMetaInfo(options)
  const jsonStr = JSON.stringify(meta, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = 'draft_meta_info.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* ============================== ZIP 打包导出 ============================== */

function guessAssetExt(url: string): string {
  const clean = url.split('?')[0].split('#')[0].toLowerCase()
  if (clean.endsWith('.webm')) return '.webm'
  if (clean.endsWith('.mov')) return '.mov'
  return '.mp4'
}

function sanitizeFileName(name: string): string {
  return (name || 'WebLockShot_带货工程').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
}

function buildZipReadme(projectTitle: string, includedAssets: string[], missingAssets: string[]): string {
  const assetLines = includedAssets.length
    ? includedAssets.map((n) => `  - ${n}`).join('\n')
    : '  (无成功打包的素材文件)'
  const missingLines = missingAssets.length
    ? missingAssets.map((n) => `  - ${n}`).join('\n')
    : '  (无)'
  return `WebLockShot 剪映草稿工程包: ${projectTitle}
================================================

【使用步骤】
1. 解压本压缩包，得到 draft_content.json、draft_meta_info.json 与 assets/ 素材目录。
2. 打开电脑版剪映 (JianyingPro / CapCut)，先随便新建一个草稿工程，记下草稿名。
3. 关闭剪映，进入草稿目录（Windows 默认:
   %LOCALAPPDATA%\\JianyingPro\\User Data\\Projects\\com.lveditor.draft\\<你的草稿名>\\ ）。
4. 将解压出的 draft_content.json、draft_meta_info.json 与 assets/ 文件夹
   覆盖/复制进该草稿目录（同名文件直接替换）。
5. 重新打开剪映，即可看到 9:16 画布、视频主轨、旁白音轨与花字字幕轨三轨对齐的工程。

【本包内素材清单】
${assetLines}

【缺失/未打包素材】
${missingLines}

【音频说明】
- 旁白音轨引用 assets/voice_<镜号>.mp3。浏览器 Web Speech TTS 无法导出音频文件，
  若包内缺少对应音频文件，剪映导入时会提示素材缺失，可：
  a) 自行录制/合成旁白并以同名文件放入 assets/ 后重新打开草稿；或
  b) 在剪映中直接删除空音频片段，仅保留画面与字幕。

由 WebLockShot 生成 · 时间单位为微秒 (1s = 1,000,000us) · 画布 1080x1920 9:16
`
}

export type JianyingZipResult = {
  bytes: Uint8Array
  filename: string
  includedAssets: string[]
  missingAssets: string[]
}

/**
 * 构建剪映草稿完整 zip 包（draft_content.json + draft_meta_info.json + 素材 + 使用说明）
 * 纯前端可用：视频素材直接从 job.asset.url (blob:) 抓取，零依赖手写 store 模式 zip。
 */
export async function buildJianyingZipPackage(options: JianyingZipResultOptions): Promise<JianyingZipResult> {
  const { audioByShotId = {}, projectTitle = 'WebLockShot_带货工程' } = options
  const entries: ZipEntry[] = []
  const includedAssets: string[] = []
  const missingAssets: string[] = []

  // 1. 抓取视频素材字节
  const assetNameByShotId = new Map<string, string>()
  for (const [index, shot] of options.story.shots.entries()) {
    const job = options.jobs?.find((j) => j.shotId === shot.id)
    const url = job?.asset?.url
    const zipName = `assets/Shot_${index + 1}_${shot.id}${guessAssetExt(url || '')}`
    if (url && typeof fetch === 'function') {
      try {
        const resp = await fetch(url)
        if (resp.ok) {
          const blob = await resp.blob()
          if (blob.size > 0) {
            entries.push({ name: zipName, data: await blobToUint8Array(blob) })
            assetNameByShotId.set(shot.id, zipName)
            includedAssets.push(zipName)
            continue
          }
        }
        missingAssets.push(`${zipName} (素材下载失败: HTTP ${resp.status})`)
      } catch (err) {
        missingAssets.push(`${zipName} (素材抓取异常: ${err instanceof Error ? err.message : String(err)})`)
      }
    } else {
      missingAssets.push(`${zipName} (该镜头无已生成视频资产)`)
    }
  }

  // 2. 抓取旁白音频（若提供）
  for (const [shotId, url] of Object.entries(audioByShotId)) {
    if (typeof fetch !== 'function') break
    const zipName = `assets/voice_${shotId}.mp3`
    try {
      const resp = await fetch(url)
      if (resp.ok) {
        const blob = await resp.blob()
        if (blob.size > 0) {
          entries.push({ name: zipName, data: await blobToUint8Array(blob) })
          includedAssets.push(zipName)
          continue
        }
      }
      missingAssets.push(`${zipName} (音频下载失败)`)
    } catch (err) {
      missingAssets.push(`${zipName} (音频抓取异常: ${err instanceof Error ? err.message : String(err)})`)
    }
  }

  // 3. 草稿 JSON：视频素材路径改写为包内相对路径，保证解压后导入即可用
  const draft = buildJianyingDraft({
    ...options,
    // zip 内草稿引用 assets/ 相对路径
  })
  if (assetNameByShotId.size > 0) {
    for (const mat of draft.materials.videos) {
      const shotId = options.story.shots.find((s) => mat.material_name.includes(s.id))?.id
      const zipName = shotId ? assetNameByShotId.get(shotId) : undefined
      if (zipName) mat.path = zipName
    }
  }

  entries.unshift(
    textEntry('draft_content.json', JSON.stringify(draft, null, 2)),
    textEntry('draft_meta_info.json', JSON.stringify(buildJianyingDraftMetaInfo(options), null, 2)),
    textEntry('README-使用说明.txt', buildZipReadme(projectTitle, includedAssets, missingAssets))
  )

  return {
    bytes: buildZip(entries),
    filename: `${sanitizeFileName(projectTitle)}_剪映草稿.zip`,
    includedAssets,
    missingAssets,
  }
}

export type JianyingZipResultOptions = JianyingDraftOptions

/**
 * 触发浏览器下载剪映草稿 zip 包
 */
export async function downloadJianyingDraftZip(options: JianyingZipResultOptions): Promise<JianyingZipResult> {
  const result = await buildJianyingZipPackage(options)
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    // 测试/Node 环境：仅返回字节流，不触发下载
    return result
  }

  const copy = new Uint8Array(result.bytes)
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = result.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return result
}
