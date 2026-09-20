import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'
import { localEngineProxyUrl } from '../../services/backend/proxyConfig.ts'

/**
 * ComfyUI 视频 Provider（本地算力出片，0 接口费）。
 *
 * 预设取舍（2026-09-20 本机实测，RTX 3080 10GB / ComfyUI 0.36.0）：
 * - `wan2.2-ti2v-5b`【默认，已在本机端到端跑通】原生 ComfyUI 节点
 *   （UNETLoader / CLIPLoader / VAELoader / Wan22ImageToVideoLatent / KSampler /
 *    VAEDecode / CreateVideo / SaveVideo），只需 3 个官方 repackaged 权重文件。
 * - `minimax-h3`【预留接口，未在本机验证】节点形状按 ComfyUI 内置模板
 *   `Image to Video (MiniMax H3)` 对齐（含音画同步 VAEDecodeAudio）；本机未下载
 *   对应权重（文本编码器 qwen3vl_32b 为 32B 规模，10GB 显存不可行），
 *   UI 通过 `probeCapabilities()` 如实报出缺失节点/权重，不假装可用。
 * - `wan2.1-i2v`【历史预设，需第三方插件】Kijai WanVideoWrapper
 *   （WanVideoModelLoader / EmptyWanLatentVideo / VHS_VideoCombine），本机未安装该插件。
 * - `custom`【用户自带】直接提交自定义 API 格式 workflow，支持占位符注入。
 *
 * 该模块不依赖任何 sell 6 镜管线实现（src/ai、src/persist.ts、src/types.ts 零改动）。
 */

export type ComfyUIWorkflowPreset = 'wan2.2-ti2v-5b' | 'minimax-h3' | 'wan2.1-i2v' | 'custom'

export type ComfyConfig = {
  baseUrl: string
  workflowPreset: ComfyUIWorkflowPreset
  customWorkflowJson?: string
  clientPromptIdPrefix?: string
}

export const COMFY_URL_STORAGE_KEY = 'weblockshot.comfyui_url'
export const COMFY_PRESET_STORAGE_KEY = 'weblockshot.comfyui_preset'
/** 质量档：决定分辨率 / 帧数 / 步数（10GB 显存档位实测见 docs/comfyui-local.md） */
export const COMFY_QUALITY_STORAGE_KEY = 'weblockshot.comfyui_quality'
/** custom 预设的 API 格式 workflow 原文 */
export const COMFY_CUSTOM_WORKFLOW_STORAGE_KEY = 'weblockshot.comfyui_custom_workflow'

export type ComfyQualityTier = 'fast' | 'standard' | 'high'

export const COMFY_PRESETS: Array<{
  id: ComfyUIWorkflowPreset
  label: string
  /** 是否已在本机端到端验证；false 的预设 UI 必须如实标注 */
  verified: boolean
  note: string
}> = [
  {
    id: 'wan2.2-ti2v-5b',
    label: 'Wan 2.2 TI2V-5B（本地已验证 · 文/图生视频）',
    verified: true,
    note: '原生 ComfyUI 节点，需 wan2.2_ti2v_5B_fp16 / umt5_xxl_fp8 / wan2.2_vae 三件权重',
  },
  {
    id: 'wan2.1-i2v',
    label: '阿里 Wan 2.1 14B I2V（需 Kijai WanVideoWrapper 插件 · 本机未验证）',
    verified: false,
    note: '依赖第三方插件节点 WanVideoModelLoader / EmptyWanLatentVideo / VHS_VideoCombine',
  },
  {
    id: 'minimax-h3',
    label: 'MiniMax H3（预留接口 · 本机未验证）',
    verified: false,
    note: '含音画同步；需 minimax_h3 系列权重（含 32B 文本编码器，10GB 显存不可行）',
  },
  {
    id: 'custom',
    label: '自定义工作流 API（自带 API 格式 JSON）',
    verified: true,
    note: '支持 {{PROMPT}} / {{NEGATIVE}} / {{WIDTH}} / {{HEIGHT}} / {{FRAMES}} / {{FPS}} / {{SEED}} 占位符',
  },
]

export const COMFY_DEFAULT_PRESET: ComfyUIWorkflowPreset = 'wan2.2-ti2v-5b'

/**
 * 把任意存储值归一到「下拉框可渲染」的合法预设。
 *
 * ⚠️ 仅供设置面板的 `<select>` 使用。**出片路径不要用它**：历史遗留的
 * `cogvideox-5b` / `svd-xt`（从未实现）若在这里被悄悄换成 wan2.2，就等于
 * 「选了 A 跑了 B」。出片侧走 `ComfyUIVideoProvider.getRawPresetValue()` +
 * 白名单校验，未知值直接报错。
 */
export function normalizeComfyPreset(value: unknown): ComfyUIWorkflowPreset {
  return COMFY_PRESETS.some((p) => p.id === value) ? (value as ComfyUIWorkflowPreset) : COMFY_DEFAULT_PRESET
}

/** 白名单校验（出片路径的前置门槛，纯函数便于单测） */
export function isKnownComfyPreset(value: unknown): value is ComfyUIWorkflowPreset {
  return COMFY_PRESETS.some((p) => p.id === value)
}

/** 未知预设的显式错误文案（绝不含「已自动改用其它模型」这类静默降级） */
export function unknownPresetMessage(raw: string): string {
  return `未知的 ComfyUI 预设「${raw}」——可能来自旧版本设置。请在「⚙️ API 设置 → 2. 视频生成引擎」重新选择预设后重试（不会静默改用其它模型出片）。`
}

export function normalizeComfyTier(value: unknown): ComfyQualityTier {
  return value === 'fast' || value === 'standard' || value === 'high' ? value : 'standard'
}

/** custom 预设的 workflow 原文（只读取，写入由设置面板负责） */
export function readCustomWorkflowJson(): string {
  try {
    if (typeof window === 'undefined') return ''
    return sessionStorage.getItem(COMFY_CUSTOM_WORKFLOW_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * 单镜耗时估算（秒），用于出片前如实告知等待时长。
 *
 * 标定口径：RTX 3080 10GB + Wan 2.2 TI2V-5B fp16 + ComfyUI 0.36「dynamic VRAM loading」。
 * 取**上界**而非热跑最优值，因为用户第一次出片必然包含模型装载：
 * - fast    ：热跑实测 30s（`npm run e2e:comfyui`，模型已常驻）；冷启首镜约 90s。
 * - standard：按 20s/it 线性外推（97 帧 / 16 步），未单独实跑。
 * - high    ：实测 655s（121 帧 / 20 步，docs/comfyui-local.md 表 C），模型已常驻仍要 11 分钟。
 */
export function estimateShotSeconds(tier: ComfyQualityTier): number {
  if (tier === 'fast') return 90
  if (tier === 'standard') return 250
  return 660
}

/**
 * 出片所需的最小轮询窗口（分钟）：单镜估算向上取整再留 1 分钟余量。
 *
 * 存在的理由：轮询窗口默认 10 分钟，而 high 档单镜实测 655s —— 窗口不够时 executor 会
 * **超时退款并标记失败，而上游其实还在跑并最终写出文件**，属于假失败。
 * 调用方用 `ExecutorEngine.setPollingWindowMinutes()` 只升不降地抬到该值。
 */
export function comfyRequiredWindowMinutes(tier: ComfyQualityTier): number {
  return Math.ceil(estimateShotSeconds(tier) / 60) + 1
}

/** 出片前提示文案（镜数 × 单镜耗时），用于「点下去要等多久」的如实告知 */
export function comfyEstimateText(tier: ComfyQualityTier, shots: number): string {
  const n = Math.max(1, shots)
  const per = estimateShotSeconds(tier)
  const fmt = (s: number) => (s >= 60 ? `${Math.round(s / 60)} 分钟` : `${s} 秒`)
  return `预计约 ${fmt(per * n)}（${n} 镜 × 保守基准 ${fmt(per)}/镜，RTX 3080 10GB）`
}

/* ------------------------------------------------------------------ *
 * 模型文件名（与本机 D:\ComfyUI 实际文件一致；改名前先跑 probeCapabilities）
 * ------------------------------------------------------------------ */

export const WAN22_TI2V_FILES = {
  unet: 'wan2.2_ti2v_5B_fp16.safetensors',
  textEncoder: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  vae: 'wan2.2_vae.safetensors',
} as const

export const MINIMAX_H3_FILES = {
  unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  textEncoder: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
} as const

export const WAN21_I2V_FILES = {
  model: 'wan2.1_i2v_14B_fp8.safetensors',
} as const

/** Wan 2.x 默认负向提示词（与 ComfyUI 官方中文模板同源） */
export const WAN_DEFAULT_NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走，裸露，NSFW'

/* ------------------------------------------------------------------ *
 * 参数换算（纯函数，可 node --test）
 * ------------------------------------------------------------------ */

/**
 * 质量档 → 分辨率（9:16 竖版）。
 * Wan 2.2 TI2V-5B 的 VAE 空间压缩 16× 再 2×2 patchify，宽高必须是 32 的倍数。
 */
export function comfyTierResolution(tier: ComfyQualityTier): { width: number; height: number } {
  if (tier === 'fast') return { width: 480, height: 832 }
  return { width: 704, height: 1280 } // standard / high 均为原生训练分辨率
}

/** 质量档 → 步数上限与帧数上限（10GB 显存实测：high 单条约 5 分钟） */
export function comfyTierBudget(tier: ComfyQualityTier): { maxFrames: number; steps: number } {
  if (tier === 'fast') return { maxFrames: 49, steps: 8 }
  if (tier === 'standard') return { maxFrames: 97, steps: 16 }
  return { maxFrames: 121, steps: 20 }
}

/**
 * 时长 → 帧数：Wan 2.2 TI2V 的 length 必须落在 4n+1 网格上（latent 时间维=length/4+1）。
 * 结果对齐到最近的合法帧数并夹在 [13, maxFrames] 内。
 */
export function wan22FramesForDuration(durationSec: number, fps = 24, maxFrames = 121): number {
  const cap = Math.max(13, Math.floor((maxFrames - 1) / 4) * 4 + 1)
  const raw = Math.max(1, Number.isFinite(durationSec) ? durationSec : 5) * fps
  const snapped = Math.round((raw - 1) / 4) * 4 + 1
  return Math.min(cap, Math.max(13, snapped))
}

export type Wan22Params = {
  prompt: string
  negative?: string
  width: number
  height: number
  frames: number
  steps: number
  cfg?: number
  samplerName?: string
  scheduler?: string
  seed: number
  fps?: number
  filenamePrefix?: string
  /** 参考首帧在 ComfyUI 侧的文件名（经 /upload/image 上传后得到），图生视频用 */
  startImageName?: string
  weightDtype?: 'default' | 'fp8_e4m3fn' | 'fp8_e4m3fn_fast' | 'fp8_e5m2'
}

/**
 * Wan 2.2 TI2V-5B API 格式 workflow（节点名/参数名均经 GET /object_info 核对）。
 * 图生视频只要挂上 start_image 即可，无需另建图。
 */
export function buildWan22Ti2vWorkflow(p: Wan22Params): Record<string, unknown> {
  const wf: Record<string, unknown> = {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: WAN22_TI2V_FILES.unet, weight_dtype: p.weightDtype ?? 'default' },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: WAN22_TI2V_FILES.textEncoder, type: 'wan', device: 'default' },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: WAN22_TI2V_FILES.vae },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: p.prompt, clip: ['2', 0] },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: p.negative || WAN_DEFAULT_NEGATIVE, clip: ['2', 0] },
    },
    '6': {
      class_type: 'Wan22ImageToVideoLatent',
      inputs: {
        vae: ['3', 0],
        width: p.width,
        height: p.height,
        length: p.frames,
        batch_size: 1,
      },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        seed: p.seed,
        steps: p.steps,
        cfg: p.cfg ?? 5,
        sampler_name: p.samplerName ?? 'euler',
        scheduler: p.scheduler ?? 'simple',
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['6', 0],
        denoise: 1.0,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['3', 0] },
    },
    '9': {
      class_type: 'CreateVideo',
      inputs: { images: ['8', 0], fps: p.fps ?? 24 },
    },
    '10': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['9', 0],
        filename_prefix: p.filenamePrefix || 'WebLockShot',
        format: 'mp4',
      },
    },
  }

  if (p.startImageName) {
    wf['11'] = { class_type: 'LoadImage', inputs: { image: p.startImageName } }
    ;(wf['6'] as { inputs: Record<string, unknown> }).inputs.start_image = ['11', 0]
  }
  return wf
}

export type MiniMaxH3Params = {
  prompt: string
  width: number
  height: number
  /** 24fps 下对齐到 17k+5 网格（默认 124 ≈ 5s） */
  frames: number
  steps?: number
  seed: number
  firstFrameName?: string
  lastFrameName?: string
  filenamePrefix?: string
  /** 是否启用 8 步 turbo LoRA（需额外权重，本机未下载） */
  lightningLora?: boolean
}

/** MiniMax H3 帧数网格：5, 22, 39, ... (17k+5)，24fps */
export function minimaxH3FramesForDuration(durationSec: number, fps = 24): number {
  const raw = Math.max(1, durationSec) * fps
  const snapped = Math.round((raw - 5) / 17) * 17 + 5
  return Math.max(5, snapped)
}

/**
 * MiniMax H3 API 格式 workflow【预留接口 · 未在本机验证】。
 * 节点形状对齐 ComfyUI 内置模板 `Image to Video (MiniMax H3)`：需要 video/audio 双 VAE，
 * 经 BasicGuider + SamplerCustomAdvanced 采样，产物含音轨（CreateVideo 的 audio 输入）。
 * 未下载权重时提交会由 /prompt 返回明确错误，不做静默降级。
 */
export function buildMiniMaxH3Workflow(p: MiniMaxH3Params): Record<string, unknown> {
  const steps = p.steps ?? 20
  const wf: Record<string, unknown> = {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: MINIMAX_H3_FILES.unet, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: MINIMAX_H3_FILES.textEncoder, type: 'minimax', device: 'default' },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: MINIMAX_H3_FILES.videoVae },
    },
    '4': {
      class_type: 'VAELoader',
      inputs: { vae_name: MINIMAX_H3_FILES.audioVae },
    },
    '5': {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: { clip: ['2', 0], vae: ['3', 0], prompt: p.prompt, width: p.width, height: p.height, length: p.frames },
    },
    '6': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    '7': {
      class_type: 'BasicScheduler',
      inputs: { model: ['1', 0], scheduler: 'simple', steps, denoise: 1 },
    },
    '8': { class_type: 'BasicGuider', inputs: { model: ['1', 0], conditioning: ['5', 0] } },
    '9': { class_type: 'RandomNoise', inputs: { noise_seed: p.seed } },
    '10': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['9', 0],
        guider: ['8', 0],
        sampler: ['6', 0],
        sigmas: ['7', 0],
        latent_image: ['5', 1],
      },
    },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['10', 0], vae: ['3', 0] } },
    '12': { class_type: 'VAEDecodeAudio', inputs: { samples: ['10', 0], vae: ['4', 0] } },
    '13': { class_type: 'CreateVideo', inputs: { images: ['11', 0], audio: ['12', 0], fps: 24 } },
    '14': {
      class_type: 'SaveVideo',
      inputs: { video: ['13', 0], filename_prefix: p.filenamePrefix || 'WebLockShot_mmx', format: 'mp4' },
    },
  }
  if (p.firstFrameName) {
    wf['15'] = { class_type: 'LoadImage', inputs: { image: p.firstFrameName } }
    ;(wf['5'] as { inputs: Record<string, unknown> }).inputs.first_frame = ['15', 0]
  }
  if (p.lastFrameName) {
    wf['16'] = { class_type: 'LoadImage', inputs: { image: p.lastFrameName } }
    ;(wf['5'] as { inputs: Record<string, unknown> }).inputs.last_frame = ['16', 0]
  }
  return wf
}

/** 历史预设：Wan 2.1 14B I2V，依赖 Kijai WanVideoWrapper 插件节点（本机未安装） */
export function buildWan21Workflow(p: {
  prompt: string
  negative: string
  width: number
  height: number
  frames: number
  steps: number
  seed: number
  fps: number
  filenamePrefix: string
}): Record<string, unknown> {
  return {
    '1': { inputs: { model_name: WAN21_I2V_FILES.model }, class_type: 'WanVideoModelLoader' },
    '2': { inputs: { text: p.prompt, clip: ['1', 1] }, class_type: 'CLIPTextEncode' },
    '3': { inputs: { text: p.negative, clip: ['1', 1] }, class_type: 'CLIPTextEncode' },
    '4': {
      inputs: { width: p.width, height: p.height, length: p.frames, batch_size: 1 },
      class_type: 'EmptyWanLatentVideo',
    },
    '5': {
      inputs: {
        seed: p.seed,
        steps: p.steps,
        cfg: 6.0,
        sampler_name: 'uni_pc',
        scheduler: 'simple',
        denoise: 1.0,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
      class_type: 'KSampler',
    },
    '6': { inputs: { samples: ['5', 0], vae: ['1', 2] }, class_type: 'VAEDecode' },
    '7': {
      inputs: {
        frame_rate: p.fps,
        loop_count: 0,
        filename_prefix: p.filenamePrefix,
        format: 'video/h264-mp4',
        images: ['6', 0],
      },
      class_type: 'VHS_VideoCombine',
    },
  }
}

/** custom 预设：整值占位符替换（与 comfyuiImage 的重绘占位符约定一致） */
export function resolveCustomWorkflow(
  customJson: string,
  values: { prompt: string; negative: string; width: number; height: number; frames: number; fps: number; seed: number }
): Record<string, unknown> {
  const parsed = JSON.parse(customJson) as unknown
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value === '{{PROMPT}}') return values.prompt
      if (value === '{{NEGATIVE}}') return values.negative
      if (value === '{{WIDTH}}') return values.width
      if (value === '{{HEIGHT}}') return values.height
      if (value === '{{FRAMES}}') return values.frames
      if (value === '{{FPS}}') return values.fps
      if (value === '{{SEED}}') return values.seed
      return value
    }
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) out[k] = replace(v)
      return out
    }
    return value
  }
  return replace(parsed) as Record<string, unknown>
}

/** /view 直链（纯函数） */
export function buildComfyViewUrl(
  base: string,
  file: { filename: string; subfolder?: string; type?: string }
): string {
  return `${base.replace(/\/$/, '')}/view?filename=${encodeURIComponent(
    file.filename
  )}&subfolder=${encodeURIComponent(file.subfolder || '')}&type=${encodeURIComponent(
    file.type || 'output'
  )}`
}

/**
 * 追加缓存破坏参数。http 直链自带 query（/view?filename=...）时用 `&`，
 * 否则用 `?` —— 直接拼 `?v=` 会污染最后一个查询参数导致 404。
 */
export function withCacheBuster(url: string, stamp: number | string = Date.now()): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=${stamp}`
}

/** 从 /history 响应提取首个视频产物（纯函数；无产物返回 null 表示继续轮询） */
export function extractVideoOutput(
  historyData: Record<string, unknown>,
  promptId: string
): { filename: string; subfolder?: string; type?: string } | null {
  const target = historyData[promptId] as { outputs?: Record<string, unknown> } | undefined
  if (!target?.outputs) return null
  for (const nodeOut of Object.values(target.outputs)) {
    const node = nodeOut as { videos?: unknown; gifs?: unknown; images?: unknown }
    for (const bucket of [node.videos, node.gifs, node.images]) {
      if (Array.isArray(bucket) && bucket.length > 0) {
        const first = bucket[0] as { filename?: string; subfolder?: string; type?: string }
        if (first?.filename) {
          return { filename: first.filename, subfolder: first.subfolder, type: first.type }
        }
      }
    }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 能力自检（提交前如实告知「缺什么」，而不是提交后报错）
 * ------------------------------------------------------------------ */

export type ComfyCapabilityReport = {
  preset: ComfyUIWorkflowPreset
  /** 该预设是否已在本机端到端验证过 */
  verified: boolean
  /** 预设本身不在白名单（旧版本遗留值）时为 true：此时不会给出任何「可用」结论 */
  unknownPreset?: boolean
  ok: boolean
  missingNodes: string[]
  /** 缺失的权重文件名（按节点输入项归类） */
  missingModels: Array<{ node: string; input: string; value: string; available: string[] }>
  error?: string
}

/** 预设 → 必需节点类名 */
export function presetRequiredNodes(preset: ComfyUIWorkflowPreset): string[] {
  if (preset === 'wan2.2-ti2v-5b') {
    return [
      'UNETLoader',
      'CLIPLoader',
      'VAELoader',
      'CLIPTextEncode',
      'Wan22ImageToVideoLatent',
      'KSampler',
      'VAEDecode',
      'CreateVideo',
      'SaveVideo',
    ]
  }
  if (preset === 'minimax-h3') {
    return [
      'UNETLoader',
      'CLIPLoader',
      'VAELoader',
      'MiniMaxH3ImageToVideo',
      'KSamplerSelect',
      'BasicScheduler',
      'BasicGuider',
      'RandomNoise',
      'SamplerCustomAdvanced',
      'VAEDecode',
      'VAEDecodeAudio',
      'CreateVideo',
      'SaveVideo',
    ]
  }
  if (preset === 'wan2.1-i2v') {
    return ['WanVideoModelLoader', 'CLIPTextEncode', 'EmptyWanLatentVideo', 'KSampler', 'VAEDecode', 'VHS_VideoCombine']
  }
  return []
}

/** 预设 → 必需权重（node/input/value），用于与 /object_info 的枚举比对 */
export function presetRequiredModels(
  preset: ComfyUIWorkflowPreset
): Array<{ node: string; input: string; value: string }> {
  if (preset === 'wan2.2-ti2v-5b') {
    return [
      { node: 'UNETLoader', input: 'unet_name', value: WAN22_TI2V_FILES.unet },
      { node: 'CLIPLoader', input: 'clip_name', value: WAN22_TI2V_FILES.textEncoder },
      { node: 'VAELoader', input: 'vae_name', value: WAN22_TI2V_FILES.vae },
    ]
  }
  if (preset === 'minimax-h3') {
    return [
      { node: 'UNETLoader', input: 'unet_name', value: MINIMAX_H3_FILES.unet },
      { node: 'CLIPLoader', input: 'clip_name', value: MINIMAX_H3_FILES.textEncoder },
      { node: 'VAELoader', input: 'vae_name', value: MINIMAX_H3_FILES.videoVae },
    ]
  }
  return []
}

/** 从 /object_info/{node} 响应里取某个 combo 输入的可选值列表（纯函数，便于单测） */
export function comboOptionsOf(objectInfo: unknown, node: string, input: string): string[] | null {
  const def = (objectInfo as Record<string, { input?: Record<string, Record<string, [unknown, unknown]>> }>)[node]
  const slot = def?.input?.required?.[input] ?? def?.input?.optional?.[input]
  const type = slot?.[0]
  return Array.isArray(type) ? (type as string[]) : null
}

/* ------------------------------------------------------------------ *
 * 运行时
 * ------------------------------------------------------------------ */

type ComfyTask = {
  shotId: string
  durationSec: number
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  submittedAt: number
  assetUrl?: string
  error?: string
  /** WebSocket 上报的真实步进（value/max）；拿不到就保持 undefined，不编造 */
  step?: { value: number; max: number }
}

const comfyTasks = new Map<string, ComfyTask>()

/** 全局共享一个 WebSocket：ComfyUI 的步进进度只走 WS，HTTP 侧没有等价端点 */
let progressSocket: WebSocket | null = null
let progressSocketUrl = ''

function wsUrlOf(base: string, clientId: string): string {
  const u = base.replace(/^http/, 'ws').replace(/\/$/, '')
  return `${u}/ws?clientId=${encodeURIComponent(clientId)}`
}

function ensureProgressSocket(base: string, clientId: string): void {
  // 只在浏览器里开：node --test 下 WebSocket 全局存在，真连一下会让事件循环挂住
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return
  const url = wsUrlOf(base, clientId)
  if (progressSocket && progressSocketUrl === url && progressSocket.readyState <= 1) return
  try {
    progressSocket?.close()
  } catch {}
  try {
    const ws = new WebSocket(url)
    progressSocketUrl = url
    progressSocket = ws
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type?: string
          data?: { value?: number; max?: number; prompt_id?: string }
        }
        if (msg.type !== 'progress' || !msg.data?.prompt_id) return
        const task = comfyTasks.get(msg.data.prompt_id)
        if (!task) return
        if (typeof msg.data.value === 'number' && typeof msg.data.max === 'number') {
          task.step = { value: msg.data.value, max: msg.data.max }
          task.status = 'running'
        }
      } catch {}
    }
    ws.onerror = () => {
      // 拿不到进度不影响出片本身：poll() 回落为「无进度」而非编造数值
    }
  } catch {}
}

function seedOf(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

/** 构造期覆盖项（测试与高级用法用；不传则一律读 sessionStorage） */
export type ComfyOverrides = {
  /** 原始预设字符串（可以是未知值，用于验证「未知预设必须显式报错」） */
  preset?: string
  tier?: ComfyQualityTier
  customWorkflowJson?: string
}

export class ComfyUIVideoProvider implements VideoProvider {
  readonly id = 'comfyui' as const
  /** 可选构造期 baseUrl 覆盖（测试与高级用法），未提供时按会话/环境自动解析 */
  private baseUrlOverride?: string
  private overrides: ComfyOverrides

  constructor(baseUrl?: string, overrides?: ComfyOverrides) {
    this.baseUrlOverride = baseUrl
    this.overrides = overrides ?? {}
  }

  /**
   * 解析实际请求用的 ComfyUI base URL。
   *
   * 优先级：显式覆盖（构造期）→ 用户填写的地址 → 本机同源反代 → 直连 127.0.0.1:8188。
   *
   * 「本机同源反代」不是可选优化而是**必需**：ComfyUI 新版会对回环 Host 与 Origin 做一致性
   * 校验，页面从 `127.0.0.1:<本项目端口>` 发 POST 必然 403（实测报错见 docs/comfyui-local.md）；
   * 反代剥掉 host/origin 后该请求不再命中校验。返回的是**绝对** URL —— 产物直链要过
   * `persistentUrlSchema`（只接受 idbref:// 或 http(s)://）。
   */
  getBaseUrl(): string {
    if (this.baseUrlOverride) return this.baseUrlOverride
    if (typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(COMFY_URL_STORAGE_KEY)
        if (stored && stored.trim()) return stored.trim().replace(/\/$/, '')
      } catch {}
      const viaProxy = localEngineProxyUrl('comfyui', window.location)
      if (viaProxy) return viaProxy
    }
    return 'http://127.0.0.1:8188'
  }

  /**
   * 存储里的**原始**预设值（空串 = 未设置）。
   * 不做归一，也不做静默替换 —— 未知值必须由 buildWorkflow / probeCapabilities 显式报错。
   */
  getRawPresetValue(): string {
    if (this.overrides.preset !== undefined) return this.overrides.preset
    if (typeof window !== 'undefined') {
      try {
        return sessionStorage.getItem(COMFY_PRESET_STORAGE_KEY) || ''
      } catch {}
    }
    return ''
  }

  /** 解析后的预设；未知值原样返回（类型上是白名单联合，运行时由调用方校验） */
  getWorkflowPreset(): ComfyUIWorkflowPreset {
    const raw = this.getRawPresetValue()
    return (raw === '' ? COMFY_DEFAULT_PRESET : raw) as ComfyUIWorkflowPreset
  }

  getQualityTier(): ComfyQualityTier {
    if (this.overrides.tier) return this.overrides.tier
    if (typeof window !== 'undefined') {
      try {
        return normalizeComfyTier(sessionStorage.getItem(COMFY_QUALITY_STORAGE_KEY))
      } catch {}
    }
    return 'standard'
  }

  /**
   * 一键检测本地或远程 ComfyUI 实例健康度、显卡型号与可用显存
   */
  async testConnection(customUrl?: string): Promise<{
    ok: boolean
    gpuName?: string
    vramTotalGb?: number
    vramFreeGb?: number
    pythonVersion?: string
    error?: string
  }> {
    const base = (customUrl || this.getBaseUrl()).replace(/\/$/, '')
    try {
      const resp = await fetch(`${base}/system_stats`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      if (!resp.ok) {
        throw new Error(`ComfyUI 服务响应状态码异常: ${resp.status} ${resp.statusText}`)
      }

      const data = await resp.json()
      const device = data.devices?.[0]
      const vramTotal = device?.vram_total ? (device.vram_total / 1024 / 1024 / 1024).toFixed(1) : undefined
      const vramFree = device?.vram_free ? (device.vram_free / 1024 / 1024 / 1024).toFixed(1) : undefined

      return {
        ok: true,
        gpuName: device?.name || '未知显卡设备 (支持通用推理)',
        vramTotalGb: vramTotal ? Number(vramTotal) : undefined,
        vramFreeGb: vramFree ? Number(vramFree) : undefined,
        pythonVersion: data.system?.python_version,
      }
    } catch (err) {
      return {
        ok: false,
        error:
          (err instanceof Error ? err.message : '') ||
          '无法连接到 ComfyUI 实例。请确保在本地启动了 ComfyUI (默认 http://127.0.0.1:8188) 并携带了 --listen 参数。',
      }
    }
  }

  /**
   * 能力自检：查节点是否存在 + 权重文件名是否在枚举里。
   * 只拉取用到的单节点定义（/object_info/{node}），不下载 958 个节点的全量表。
   */
  async probeCapabilities(preset?: ComfyUIWorkflowPreset | string, customUrl?: string): Promise<ComfyCapabilityReport> {
    const base = (customUrl || this.getBaseUrl()).replace(/\/$/, '')
    const raw = preset ?? this.getRawPresetValue()
    const target = (raw === '' ? COMFY_DEFAULT_PRESET : raw) as ComfyUIWorkflowPreset
    const meta = COMFY_PRESETS.find((p) => p.id === target)
    const report: ComfyCapabilityReport = {
      preset: target,
      verified: Boolean(meta?.verified),
      ok: false,
      missingNodes: [],
      missingModels: [],
    }
    if (!meta) {
      // 旧版本遗留的预设值：不猜、不替换，直接如实报错
      report.unknownPreset = true
      report.error = unknownPresetMessage(raw)
      return report
    }
    if (target === 'custom') {
      // 自定义工作流无从静态推断，交由 /prompt 校验
      report.ok = true
      return report
    }
    try {
      for (const node of presetRequiredNodes(target)) {
        const resp = await fetch(`${base}/object_info/${encodeURIComponent(node)}`)
        if (!resp.ok) {
          report.missingNodes.push(node)
          continue
        }
        const info = (await resp.json()) as Record<string, unknown>
        if (!info || Object.keys(info).length === 0) report.missingNodes.push(node)
      }
      for (const req of presetRequiredModels(target)) {
        const resp = await fetch(`${base}/object_info/${encodeURIComponent(req.node)}`)
        if (!resp.ok) continue // 节点本身已缺失，上面已记录
        const options = comboOptionsOf(await resp.json(), req.node, req.input)
        if (options && !options.includes(req.value)) {
          report.missingModels.push({ ...req, available: options })
        }
      }
      report.ok = report.missingNodes.length === 0 && report.missingModels.length === 0
      return report
    } catch (err) {
      report.error = err instanceof Error ? err.message : '能力自检失败'
      return report
    }
  }

  /** 依据 preset + 质量档 + 请求时长装配合适的 workflow（纯构造，发网络前可单测） */
  buildWorkflow(req: VideoGenRequest, opts?: { startImageName?: string }): Record<string, unknown> {
    const preset = this.getWorkflowPreset()
    // 门槛：预设必须落在白名单内。历史遗留的 cogvideox-5b / svd-xt 从未实现，
    // 若在此静默回落成 Wan 就等价于「选了 A 跑了 B」，故显式报错让用户重选。
    if (!isKnownComfyPreset(preset)) throw new Error(unknownPresetMessage(String(preset)))
    const tier = this.getQualityTier()
    const { width, height } = comfyTierResolution(tier)
    const { maxFrames, steps } = comfyTierBudget(tier)
    const fps = 24
    const frames = wan22FramesForDuration(req.durationSec, fps, maxFrames)
    const filenamePrefix = `WebLockShot_${req.shotId}`
    const negative =
      req.negative ||
      'blurry, low quality, jitter, deformed geometry, distorted product, watermark, flickering, static'

    if (preset === 'custom') {
      const custom = this.getCustomWorkflowJson()
      if (!custom) throw new Error('custom 预设需要先在设置中粘贴 API 格式工作流 JSON')
      return resolveCustomWorkflow(custom, { prompt: req.prompt, negative, width, height, frames, fps, seed: seedOf() })
    }
    if (preset === 'minimax-h3') {
      return buildMiniMaxH3Workflow({
        prompt: req.prompt,
        width: 768,
        height: 1344,
        frames: minimaxH3FramesForDuration(req.durationSec, fps),
        seed: seedOf(),
        firstFrameName: opts?.startImageName,
        filenamePrefix,
      })
    }
    if (preset === 'wan2.1-i2v') {
      return buildWan21Workflow({
        prompt: req.prompt,
        negative,
        width,
        height,
        frames,
        steps,
        seed: seedOf(),
        fps: 16,
        filenamePrefix,
      })
    }
    return buildWan22Ti2vWorkflow({
      prompt: req.prompt,
      negative,
      width,
      height,
      frames,
      steps,
      seed: seedOf(),
      fps,
      filenamePrefix,
      startImageName: opts?.startImageName,
    })
  }

  private customWorkflowJson = ''

  getCustomWorkflowJson(): string {
    if (this.customWorkflowJson) return this.customWorkflowJson
    if (this.overrides.customWorkflowJson !== undefined) return this.overrides.customWorkflowJson
    return readCustomWorkflowJson()
  }

  /** 显式注入（测试用）；传空串恢复为「从 sessionStorage 读取」 */
  setCustomWorkflowJson(json: string): void {
    this.customWorkflowJson = json
  }

  async submit(req: VideoGenRequest): Promise<{ taskId: string }> {
    const base = this.getBaseUrl().replace(/\/$/, '')
    const clientId = `weblockshot_${Date.now()}`

    // 1. 如果有首帧图输入且支持 Comfy 上传，优先将图片推至 /upload/image
    let uploadedImageName = ''
    if (req.imageBase64 && req.imageBase64.startsWith('data:image')) {
      try {
        const blobResp = await fetch(req.imageBase64)
        const blob = await blobResp.blob()
        const formData = new FormData()
        formData.append('image', blob, `ref_${req.shotId}_${Date.now()}.png`)
        formData.append('overwrite', 'true')

        const uploadResp = await fetch(`${base}/upload/image`, {
          method: 'POST',
          body: formData,
        })
        if (uploadResp.ok) {
          const uploadData = await uploadResp.json()
          uploadedImageName = uploadData.name || ''
        }
      } catch (err) {
        console.warn('[WebLockShot ComfyUI] 上传参考图到 ComfyUI 出现微弱阻碍，回退通用流程:', err)
      }
    }

    // 2. 按预设装配工作流（未知 preset 已在 getWorkflowPreset 归一，不会静默跑错模型）
    const workflow = this.buildWorkflow(req, { startImageName: uploadedImageName })

    // 3. 订阅真实步进进度（WS 不可用时只是没有进度数字，不影响出片）
    ensureProgressSocket(base, clientId)

    try {
      const resp = await fetch(`${base}/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          prompt: workflow,
        }),
      })

      if (!resp.ok) {
        let errDetail = ''
        try {
          const errJson = await resp.json()
          errDetail =
            errJson.error?.message ||
            errJson.error?.details ||
            errJson.message ||
            JSON.stringify(errJson)
        } catch {}
        throw new Error(`ComfyUI 派发失败 (${resp.status}): ${errDetail || '请检查节点依赖与显存'}`)
      }

      const resData = await resp.json()
      const promptId = resData.prompt_id || `comfy_${Date.now()}`

      comfyTasks.set(promptId, {
        shotId: req.shotId,
        durationSec: req.durationSec,
        status: 'queued',
        submittedAt: Date.now(),
      })

      return { taskId: promptId }
    } catch (err) {
      throw new Error(
        `提交到 ComfyUI 失败: ${err instanceof Error ? err.message : '网络连接超时'}。提示：请在右上角配置中确认 ComfyUI 地址。`
      )
    }
  }

  async poll(taskId: string): Promise<PollResult> {
    const task = comfyTasks.get(taskId)
    const base = this.getBaseUrl().replace(/\/$/, '')

    // 进度只认 WebSocket 上报的真实步进，拿不到就如实不给数字（不编造递增假进度）
    const realProgress = task?.step
      ? Math.min(99, Math.round(5 + (task.step.value / Math.max(1, task.step.max)) * 94))
      : undefined

    try {
      // 1. 查询 History 看任务是否已完成
      const histResp = await fetch(`${base}/history/${taskId}`)
      if (histResp.ok) {
        const histData = await histResp.json()
        const targetHist = histData[taskId] as
          | { outputs?: Record<string, unknown>; status?: { status_str?: string; messages?: unknown[] } }
          | undefined

        if (targetHist?.status?.status_str === 'error') {
          const detail = JSON.stringify(targetHist.status.messages ?? []).slice(0, 600)
          if (task) {
            task.status = 'failed'
            task.error = `ComfyUI 执行失败: ${detail}`
          }
          return { status: 'failed', error: `ComfyUI 执行失败: ${detail}` }
        }

        const out = extractVideoOutput(histData, taskId)
        if (out) {
          const finalUrl = buildComfyViewUrl(base, out)
          if (task) {
            task.status = 'succeeded'
            task.step = undefined
            task.assetUrl = finalUrl
          }
          return { status: 'succeeded', progress: 100 }
        }
      }

      // 2. 查询当前队列状态
      const queueResp = await fetch(`${base}/queue`)
      if (queueResp.ok) {
        const queueData = await queueResp.json()
        const isRunning = queueData.queue_running?.some(
          (q: [string, string, ...unknown[]]) => q[1] === taskId
        )
        const isPending = queueData.queue_pending?.some(
          (q: [string, string, ...unknown[]]) => q[1] === taskId
        )

        if (isRunning) {
          if (task) task.status = 'running'
          return { status: 'running', ...(realProgress !== undefined ? { progress: realProgress } : {}) }
        }

        if (isPending) {
          if (task) task.status = 'queued'
          return { status: 'queued', progress: 2 }
        }
      }

      // 3. 不在队列也不在 history：可能刚被清空，如实报运行中让上层继续轮询窗口
      if (task?.status === 'succeeded') {
        return { status: 'succeeded', progress: 100 }
      }
      return { status: 'running', ...(realProgress !== undefined ? { progress: realProgress } : {}) }
    } catch {
      // 网络抖动不等于失败：维持运行中，由上层轮询窗口兜底
      return { status: 'running', ...(realProgress !== undefined ? { progress: realProgress } : {}) }
    }
  }

  async getAsset(taskId: string): Promise<MediaAsset> {
    const task = comfyTasks.get(taskId)
    if (!task || !task.assetUrl) {
      // 绝不伪造资产：任务未就绪必须抛错，由上层走 failed -> refund 流程
      throw new Error(`ComfyUI 视频尚未就绪 (taskId: ${taskId})，不能伪造输出资产。`)
    }

    // 体积优先信 Content-Length；拿不到就如实省略，不写死一个假数字
    let sizeBytes: number | undefined
    try {
      const head = await fetch(task.assetUrl, { method: 'HEAD' })
      const len = Number(head.headers.get('content-length'))
      if (Number.isFinite(len) && len > 0) sizeBytes = len
    } catch {}

    return {
      shotId: task.shotId,
      url: task.assetUrl,
      durationSec: task.durationSec,
      ...(sizeBytes ? { sizeBytes } : {}),
    }
  }

  estimateCost(_req: VideoGenRequest): string {
    return '0 元 (自有显卡 0 接口费)'
  }
}

export const comfyUIVideoProvider = new ComfyUIVideoProvider()
