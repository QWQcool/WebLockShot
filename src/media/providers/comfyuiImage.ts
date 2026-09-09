import { getEngineProxyBase } from '../../services/backend/proxyConfig.ts'
import { COMFY_URL_STORAGE_KEY } from './comfyui.ts'

/**
 * ComfyUI 图像 inpaint Provider（CANVAS_PLAN.md §9 A2）。
 *
 * 与视频 Provider（comfyui.ts，Wan 2.1 i2v 专用）互不影响：本文件只做图像，
 * 复用同一 COMFY_URL_STORAGE_KEY 会话配置与 localhost 代理回退约定。
 *
 * 标准三步链路：
 * 1. POST /upload/image（multipart）上传源图与 mask，返回 { name, subfolder }；
 * 2. POST /prompt 提交工作流（LoadImage 源图 + LoadImageMask + inpaint 采样链）；
 * 3. 轮询 /history/{promptId} → GET /view 取回结果图 Blob。
 *
 * 工作流 preset（对齐视频 Provider 的 preset 模式）：
 * - 'flux-fill'  ：FLUX.1 Fill-dev（UNETLoader + DualCLIP + InpaintModelConditioning）
 * - 'sd-inpaint' ：SD1.5 inpainting checkpoint（CheckpointLoaderSimple 路径）
 * - 'custom'     ：用户自定义工作流 JSON，占位符替换：
 *   "{{SOURCE}}" → 源图文件名、"{{MASK}}" → mask 文件名、
 *   "{{PROMPT}}" → 重绘指令、"{{NEGATIVE}}" → 负向词、"{{SEED}}" → 随机种子。
 *
 * 纯函数（buildInpaintWorkflow / resolveCustomWorkflow / buildViewUrl）可被 node --test 覆盖；
 * 网络运行时（runInpaint）依赖 fetch/Blob，仅在浏览器可用。
 */

export type ComfyUIImageWorkflowPreset = 'flux-fill' | 'sd-inpaint' | 'custom'

export const COMFY_IMAGE_PRESET_STORAGE_KEY = 'weblockshot.comfyui_image_preset'
export const COMFY_IMAGE_CUSTOM_WORKFLOW_KEY = 'weblockshot.comfyui_image_custom_workflow'

export const COMFY_IMAGE_PRESETS: readonly ComfyUIImageWorkflowPreset[] = [
  'flux-fill',
  'sd-inpaint',
  'custom',
]

export type InpaintRequest = {
  /** 源图 Blob（PNG/JPG） */
  sourceImage: Blob
  /** mask PNG（黑底白区，与源图同尺寸） */
  maskImage: Blob
  /** 重绘指令（正向提示词） */
  prompt: string
  negative?: string
  preset: ComfyUIImageWorkflowPreset
  customWorkflowJson?: string
  filenamePrefix?: string
}

export type InpaintRunOptions = {
  /** 轮询间隔 ms（测试可注入缩短） */
  pollIntervalMs?: number
  /** 最长等待 ms，超时抛错（测试可注入缩短） */
  maxWaitMs?: number
  /** 外部取消信号 */
  signal?: AbortSignal
}

/* ------------------------------------------------------------------ *
 * 纯函数：工作流装配（node --test 可跑）
 * ------------------------------------------------------------------ */

export function getComfyImageBaseUrl(overrideUrl?: string): string {
  if (overrideUrl) return overrideUrl.replace(/\/$/, '')
  if (typeof window !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(COMFY_URL_STORAGE_KEY)
      if (stored && stored.trim()) return stored.trim().replace(/\/$/, '')
      if (window.location.hostname === 'localhost') return getEngineProxyBase('comfyui')
    } catch {
      // 受限环境回退默认
    }
  }
  return 'http://127.0.0.1:8188'
}

/** FLUX.1 Fill-dev inpaint 工作流（标准 ComfyUI 节点图） */
export function buildFluxFillWorkflow(
  sourceName: string,
  maskName: string,
  prompt: string,
  negative: string,
  filenamePrefix: string
): Record<string, unknown> {
  return {
    // 模型：FLUX Fill-dev（专用 inpaint UNET）
    '1': { inputs: { unet_name: 'flux1-fill-dev.safetensors', weight_dtype: 'default' }, class_type: 'UNETLoader' },
    '2': {
      inputs: { clip_name1: 't5xxl_fp16.safetensors', clip_name2: 'clip_l.safetensors', type: 'flux' },
      class_type: 'DualCLIPLoader',
    },
    '3': { inputs: { vae_name: 'ae.safetensors' }, class_type: 'VAELoader' },
    '4': { inputs: { text: prompt, clip: ['2', 0] }, class_type: 'CLIPTextEncode' },
    '5': { inputs: { text: negative, clip: ['2', 0] }, class_type: 'CLIPTextEncode' },
    '6': { inputs: { image: sourceName }, class_type: 'LoadImage' },
    '7': { inputs: { image: maskName, channel: 'red' }, class_type: 'LoadImageMask' },
    '8': {
      inputs: {
        positive: ['4', 0],
        negative: ['5', 0],
        vae: ['3', 0],
        pixels: ['6', 0],
        mask: ['7', 0],
        noise_mask: true,
      },
      class_type: 'InpaintModelConditioning',
    },
    '9': {
      inputs: {
        seed: Math.floor(Math.random() * 10000000),
        steps: 20,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
        model: ['1', 0],
        positive: ['8', 0],
        negative: ['8', 1],
        latent_image: ['8', 2],
      },
      class_type: 'KSampler',
    },
    '10': { inputs: { samples: ['9', 0], vae: ['3', 0] }, class_type: 'VAEDecode' },
    '11': { inputs: { images: ['10', 0], filename_prefix: filenamePrefix }, class_type: 'SaveImage' },
  }
}

/** SD1.5 inpainting checkpoint 工作流（通用 base 路径） */
export function buildSdInpaintWorkflow(
  sourceName: string,
  maskName: string,
  prompt: string,
  negative: string,
  filenamePrefix: string
): Record<string, unknown> {
  return {
    '1': { inputs: { ckpt_name: 'sd-v1-5-inpainting.ckpt' }, class_type: 'CheckpointLoaderSimple' },
    '2': { inputs: { text: prompt, clip: ['1', 1] }, class_type: 'CLIPTextEncode' },
    '3': { inputs: { text: negative, clip: ['1', 1] }, class_type: 'CLIPTextEncode' },
    '4': { inputs: { image: sourceName }, class_type: 'LoadImage' },
    '5': { inputs: { image: maskName, channel: 'red' }, class_type: 'LoadImageMask' },
    '6': {
      inputs: {
        positive: ['2', 0],
        negative: ['3', 0],
        vae: ['1', 2],
        pixels: ['4', 0],
        mask: ['5', 0],
        noise_mask: true,
      },
      class_type: 'InpaintModelConditioning',
    },
    '7': {
      inputs: {
        seed: Math.floor(Math.random() * 10000000),
        steps: 25,
        cfg: 7.0,
        sampler_name: 'euler_ancestral',
        scheduler: 'normal',
        denoise: 1.0,
        model: ['1', 0],
        positive: ['6', 0],
        negative: ['6', 1],
        latent_image: ['6', 2],
      },
      class_type: 'KSampler',
    },
    '8': { inputs: { samples: ['7', 0], vae: ['1', 2] }, class_type: 'VAEDecode' },
    '9': { inputs: { images: ['8', 0], filename_prefix: filenamePrefix }, class_type: 'SaveImage' },
  }
}

/** custom 工作流占位符替换（深遍历；仅整值精确匹配替换，不误伤普通字符串） */
export function resolveCustomWorkflow(
  customJson: string,
  sourceName: string,
  maskName: string,
  prompt: string,
  negative: string
): Record<string, unknown> {
  const parsed = JSON.parse(customJson) as unknown
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value === '{{SOURCE}}') return sourceName
      if (value === '{{MASK}}') return maskName
      if (value === '{{PROMPT}}') return prompt
      if (value === '{{NEGATIVE}}') return negative
      if (value === '{{SEED}}') return Math.floor(Math.random() * 10000000)
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

/** 按 preset 装配完整工作流 */
export function buildInpaintWorkflow(
  req: Pick<InpaintRequest, 'preset' | 'prompt' | 'negative' | 'customWorkflowJson' | 'filenamePrefix'>,
  sourceName: string,
  maskName: string
): Record<string, unknown> {
  const negative =
    req.negative || 'blurry, low quality, deformed, distorted product, watermark, text artifacts'
  const prefix = req.filenamePrefix || 'WebLockShot_inpaint'
  if (req.preset === 'flux-fill') {
    return buildFluxFillWorkflow(sourceName, maskName, req.prompt, negative, prefix)
  }
  if (req.preset === 'sd-inpaint') {
    return buildSdInpaintWorkflow(sourceName, maskName, req.prompt, negative, prefix)
  }
  if (!req.customWorkflowJson || !req.customWorkflowJson.trim()) {
    throw new Error('custom 预设需要提供自定义工作流 JSON（含 {{SOURCE}}/{{MASK}}/{{PROMPT}} 占位符）')
  }
  return resolveCustomWorkflow(req.customWorkflowJson, sourceName, maskName, req.prompt, negative)
}

/** /view 结果图直链（纯函数） */
export function buildViewUrl(
  base: string,
  file: { filename: string; subfolder?: string; type?: string }
): string {
  return `${base.replace(/\/$/, '')}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(
    file.subfolder || ''
  )}&type=${encodeURIComponent(file.type || 'output')}`
}

/** 从 /history 响应提取首个图片输出（纯函数；无输出返回 null 继续轮询） */
export function extractImageOutput(
  historyData: Record<string, unknown>,
  promptId: string
): { filename: string; subfolder?: string; type?: string } | null {
  const target = historyData[promptId] as { outputs?: Record<string, unknown> } | undefined
  if (!target?.outputs) return null
  for (const nodeOut of Object.values(target.outputs)) {
    const images = (nodeOut as { images?: unknown }).images
    if (Array.isArray(images) && images.length > 0) {
      const first = images[0] as { filename?: string; subfolder?: string; type?: string }
      if (first?.filename) {
        return { filename: first.filename, subfolder: first.subfolder, type: first.type }
      }
    }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * 运行时（浏览器 fetch）
 * ------------------------------------------------------------------ */

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('重绘已取消'))
      return
    }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new Error('重绘已取消'))
      },
      { once: true }
    )
  })
}

/** ComfyUI 在线探测（/system_stats，与视频 Provider testConnection 同端点）；失败 = 演示模式兜底 */
export async function probeComfyImage(overrideUrl?: string): Promise<boolean> {
  try {
    const resp = await fetch(`${getComfyImageBaseUrl(overrideUrl)}/system_stats`, {
      headers: { Accept: 'application/json' },
    })
    return resp.ok
  } catch {
    return false
  }
}

/** 上传单张图到 /upload/image，返回 ComfyUI 侧文件名 */
export async function uploadImageToComfy(base: string, blob: Blob, filename: string): Promise<string> {
  const formData = new FormData()
  formData.append('image', blob, filename)
  formData.append('overwrite', 'true')
  const resp = await fetch(`${base.replace(/\/$/, '')}/upload/image`, { method: 'POST', body: formData })
  if (!resp.ok) throw new Error(`ComfyUI 源图上传失败 (${resp.status})`)
  const data = (await resp.json()) as { name?: string }
  if (!data.name) throw new Error('ComfyUI 上传响应缺少文件名')
  return data.name
}

/**
 * 执行一次图像 inpaint：上传 → 提交 → 轮询 → 取回结果 Blob。
 * 绝不伪造：超时/取消/失败一律抛错，由调用方如实呈现。
 */
export async function runInpaint(
  req: InpaintRequest,
  options: InpaintRunOptions = {}
): Promise<Blob> {
  const base = getComfyImageBaseUrl().replace(/\/$/, '')
  const pollIntervalMs = options.pollIntervalMs ?? 1500
  const maxWaitMs = options.maxWaitMs ?? 180_000
  const startedAt = Date.now()
  const stamp = Date.now().toString(36)
  const signal = options.signal

  // 1. 上传源图与 mask
  let sourceName: string
  let maskName: string
  try {
    sourceName = await uploadImageToComfy(base, req.sourceImage, `wls_source_${stamp}.png`)
    maskName = await uploadImageToComfy(base, req.maskImage, `wls_mask_${stamp}.png`)
  } catch (err) {
    throw new Error(
      `ComfyUI 上传失败：${err instanceof Error ? err.message : '网络错误'}（请确认 ComfyUI 在线且地址正确）`
    )
  }

  // 2. 装配并提交工作流
  const workflow = buildInpaintWorkflow(req, sourceName, maskName)
  const resp = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: `weblockshot_img_${stamp}`, prompt: workflow }),
    signal,
  })
  if (!resp.ok) {
    let detail = ''
    try {
      const errJson = (await resp.json()) as { error?: { message?: string }; message?: string }
      detail = errJson.error?.message || errJson.message || JSON.stringify(errJson)
    } catch {}
    throw new Error(`ComfyUI inpaint 派发失败 (${resp.status}): ${detail || '请检查节点依赖与显存'}`)
  }
  const resData = (await resp.json()) as { prompt_id?: string }
  const promptId = resData.prompt_id
  if (!promptId) throw new Error('ComfyUI 响应缺少 prompt_id')

  // 3. 轮询 /history → /view 取回
  while (Date.now() - startedAt < maxWaitMs) {
    await sleep(pollIntervalMs, signal)
    const histResp = await fetch(`${base}/history/${promptId}`, { signal })
    if (histResp.ok) {
      const historyData = (await histResp.json()) as Record<string, unknown>
      const output = extractImageOutput(historyData, promptId)
      if (output) {
        const viewUrl = buildViewUrl(base, output)
        const imgResp = await fetch(viewUrl, { signal })
        if (!imgResp.ok) throw new Error(`取回重绘结果失败 (${imgResp.status})`)
        return await imgResp.blob()
      }
    }
  }
  throw new Error(`ComfyUI inpaint 超时（>${Math.round(maxWaitMs / 1000)}s），任务可能在排队或显存不足`)
}
