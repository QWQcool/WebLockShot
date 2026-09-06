import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'

export type KlingConfig = {
  apiKey: string
  baseUrl?: string
}

const klingCache = new Map<string, { url: string; durationSec: number; shotId: string }>()

export class KlingVideoProvider implements VideoProvider {
  readonly id = 'kling' as const
  private baseUrl: string

  constructor(baseUrl?: string) {
    // 开发环境走 Vite 代理解决浏览器跨域，生产走官方域名
    this.baseUrl =
      baseUrl ||
      (typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? '/api/kling'
        : 'https://api.klingai.com')
  }

  private getAuthHeader(): string {
    let key = ''
    try {
      key = sessionStorage.getItem('weblockshot.kling_key') || ''
    } catch {}

    if (!key.trim()) {
      throw new Error(
        '未检测到快手可灵 API Key。请点击右上角「⚙️ API 设置」填入可灵凭证，或在设置中切换回「Mock 真实录制」模式。'
      )
    }

    return key.startsWith('Bearer ') ? key : `Bearer ${key.trim()}`
  }

  async submit(req: VideoGenRequest): Promise<{ taskId: string }> {
    const auth = this.getAuthHeader()
    const isImage2Video = Boolean(req.imageBase64)
    const endpoint = isImage2Video
      ? `${this.baseUrl}/v1/videos/image2video`
      : `${this.baseUrl}/v1/videos/text2video`

    const bodyPayload = isImage2Video
      ? {
          model_name: 'kling-v1',
          image: req.imageBase64,
          prompt: req.prompt,
          negative_prompt: req.negative,
          duration: String(Math.max(5, req.durationSec || 5)),
          aspect_ratio: '9:16',
        }
      : {
          model_name: 'kling-v1',
          prompt: req.prompt,
          negative_prompt: req.negative,
          duration: String(Math.max(5, req.durationSec || 5)),
          aspect_ratio: '9:16',
        }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: JSON.stringify(bodyPayload),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`可灵 API 提交失败 (${res.status}): ${errText}`)
    }

    const data = await res.json()
    if (data.code !== 0 && data.code !== 200) {
      throw new Error(`可灵返回错误 [${data.code}]: ${data.message || '未知错误'}`)
    }

    const taskId = data.data?.task_id || data.task_id
    if (!taskId) {
      throw new Error('可灵未返回有效的 task_id')
    }

    klingCache.set(taskId, {
      url: '',
      durationSec: req.durationSec || 5,
      shotId: req.shotId,
    })

    return { taskId }
  }

  async poll(taskId: string): Promise<PollResult> {
    const auth = this.getAuthHeader()
    const endpoint = `${this.baseUrl}/v1/videos/text2video/${taskId}`

    const res = await fetch(endpoint, {
      headers: {
        Authorization: auth,
      },
    })

    if (!res.ok) {
      return { status: 'failed', error: `轮询请求失败 HTTP ${res.status}` }
    }

    const data = await res.json()
    const taskStatus = data.data?.task_status || data.task_status

    if (taskStatus === 'submitted') {
      return { status: 'queued', progress: 15 }
    }

    if (taskStatus === 'processing') {
      return { status: 'running', progress: 50 }
    }

    if (taskStatus === 'succeed') {
      const works = data.data?.task_result?.videos || []
      const videoUrl = works[0]?.url || ''
      const cached = klingCache.get(taskId)
      if (cached) {
        cached.url = videoUrl
      }
      return { status: 'succeeded', progress: 100 }
    }

    if (taskStatus === 'failed') {
      return {
        status: 'failed',
        error: data.data?.task_status_msg || data.message || '可灵渲染任务失败',
      }
    }

    return { status: 'running', progress: 30 }
  }

  async getAsset(taskId: string): Promise<MediaAsset> {
    const cached = klingCache.get(taskId)
    if (!cached || !cached.url) {
      throw new Error(`可灵视频尚未就绪 (taskId: ${taskId})`)
    }

    return {
      shotId: cached.shotId,
      url: cached.url,
      durationSec: cached.durationSec,
      sizeBytes: 1024 * 1024 * 3,
    }
  }

  estimateCost(_req: VideoGenRequest): string {
    return '约 10 灵感点 / 镜（快手可灵标准定价）'
  }
}

export const klingVideoProvider = new KlingVideoProvider()
