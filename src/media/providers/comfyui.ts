import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'

export type ComfyUIWorkflowPreset = 'wan2.1-i2v' | 'cogvideox-5b' | 'svd-xt' | 'custom'

export type ComfyConfig = {
  baseUrl: string
  workflowPreset: ComfyUIWorkflowPreset
  customWorkflowJson?: string
  clientPromptIdPrefix?: string
}

export const COMFY_URL_STORAGE_KEY = 'weblockshot.comfyui_url'
export const COMFY_PRESET_STORAGE_KEY = 'weblockshot.comfyui_preset'

const comfyTasks = new Map<
  string,
  {
    url: string
    durationSec: number
    shotId: string
    status: 'queued' | 'running' | 'succeeded' | 'failed'
    progress: number
    error?: string
    assetUrl?: string
  }
>()

/**
 * 阿里 Wan 2.1 (万象开源图生视频) 标准 ComfyUI Prompt Payload 生成器
 */
function buildWan21Workflow(req: VideoGenRequest): Record<string, any> {
  const steps = 20
  const width = 480
  const height = 832 // 9:16 vertical ratio for open source diffusion video
  const frames = Math.max(16, Math.min(81, Math.round((req.durationSec || 5) * 8)))

  return {
    '1': {
      inputs: {
        model_name: 'wan2.1_i2v_14B_fp8.safetensors',
      },
      class_type: 'WanVideoModelLoader',
    },
    '2': {
      inputs: {
        text: req.prompt,
        clip: ['1', 1],
      },
      class_type: 'CLIPTextEncode',
    },
    '3': {
      inputs: {
        text:
          req.negative ||
          'blurry, low quality, jitter, deformed geometry, distorted product, watermark, flickering',
        clip: ['1', 1],
      },
      class_type: 'CLIPTextEncode',
    },
    '4': {
      inputs: {
        width,
        height,
        length: frames,
        batch_size: 1,
      },
      class_type: 'EmptyWanLatentVideo',
    },
    '5': {
      inputs: {
        seed: Math.floor(Math.random() * 10000000),
        steps,
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
    '6': {
      inputs: {
        samples: ['5', 0],
        vae: ['1', 2],
      },
      class_type: 'VAEDecode',
    },
    '7': {
      inputs: {
        frame_rate: 16,
        loop_count: 0,
        filename_prefix: `WebLockShot_${req.shotId}`,
        format: 'video/h264-mp4',
        images: ['6', 0],
      },
      class_type: 'VHS_VideoCombine',
    },
  }
}

export class ComfyUIVideoProvider implements VideoProvider {
  readonly id = 'comfyui' as const
  /** 可选构造期 baseUrl 覆盖（测试与高级用法），未提供时按会话/环境自动解析 */
  private baseUrlOverride?: string

  constructor(baseUrl?: string) {
    this.baseUrlOverride = baseUrl
  }

  getBaseUrl(): string {
    if (this.baseUrlOverride) return this.baseUrlOverride
    if (typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(COMFY_URL_STORAGE_KEY)
        if (stored && stored.trim()) return stored.trim()
        if (window.location.hostname === 'localhost') return '/api/comfyui'
      } catch {}
    }
    return 'http://127.0.0.1:8188'
  }

  getWorkflowPreset(): ComfyUIWorkflowPreset {
    if (typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(COMFY_PRESET_STORAGE_KEY)
        if (stored) return stored as ComfyUIWorkflowPreset
      } catch {}
    }
    return 'wan2.1-i2v'
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

    // 2. 装配 ComfyUI 工作流 Prompt 节点图
    const workflow = buildWan21Workflow(req)
    if (uploadedImageName) {
      // 动态注入 LoadImage 节点
      workflow['0'] = {
        inputs: { image: uploadedImageName },
        class_type: 'LoadImage',
      }
    }

    // 3. 发起提交任务
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
          errDetail = errJson.error?.message || errJson.message || JSON.stringify(errJson)
        } catch {}
        throw new Error(`ComfyUI 派发失败 (${resp.status}): ${errDetail || '请检查节点依赖与显存'}`)
      }

      const resData = await resp.json()
      const promptId = resData.prompt_id || `comfy_${Date.now()}`

      comfyTasks.set(promptId, {
        url: '',
        durationSec: req.durationSec,
        shotId: req.shotId,
        status: 'queued',
        progress: 5,
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

    try {
      // 1. 查询 History 看任务是否已完成
      const histResp = await fetch(`${base}/history/${taskId}`)
      if (histResp.ok) {
        const histData = await histResp.json()
        const targetHist = histData[taskId]

        if (targetHist && targetHist.outputs) {
          // 寻找视频或图片输出节点
          for (const nodeId of Object.keys(targetHist.outputs)) {
            const nodeOut = targetHist.outputs[nodeId]
            const items = nodeOut.gifs || nodeOut.videos || nodeOut.images
            if (items && items.length > 0) {
              const fileObj = items[0]
              const finalUrl = `${base}/view?filename=${encodeURIComponent(
                fileObj.filename
              )}&subfolder=${encodeURIComponent(fileObj.subfolder || '')}&type=${encodeURIComponent(
                fileObj.type || 'output'
              )}`

              if (task) {
                task.status = 'succeeded'
                task.progress = 100
                task.assetUrl = finalUrl
              }

              return { status: 'succeeded', progress: 100 }
            }
          }
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
          if (task) {
            task.status = 'running'
            task.progress = Math.min(95, task.progress + 6)
          }
          return { status: 'running', progress: task?.progress || 40 }
        }

        if (isPending) {
          if (task) {
            task.status = 'queued'
            task.progress = 15
          }
          return { status: 'queued', progress: 15 }
        }
      }

      // 若已经有完成记录
      if (task && task.status === 'succeeded') {
        return { status: 'succeeded', progress: 100 }
      }

      return { status: 'running', progress: task?.progress || 50 }
    } catch {
      return { status: 'running', progress: task?.progress || 30 }
    }
  }

  async getAsset(taskId: string): Promise<MediaAsset> {
    const task = comfyTasks.get(taskId)
    if (!task || !task.assetUrl) {
      // 绝不伪造资产：任务未就绪必须抛错，由上层走 failed -> refund 流程
      throw new Error(`ComfyUI 视频尚未就绪 (taskId: ${taskId})，不能伪造输出资产。`)
    }

    return {
      shotId: task.shotId,
      url: task.assetUrl,
      durationSec: task.durationSec,
      sizeBytes: 1024 * 1024 * 4,
    }
  }

  estimateCost(_req: VideoGenRequest): string {
    return '0 元 (自有显卡 0 接口费)'
  }
}

export const comfyUIVideoProvider = new ComfyUIVideoProvider()
