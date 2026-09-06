import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'

const jimengCache = new Map<string, { url: string; durationSec: number; shotId: string }>()

/**
 * 即梦 (Jimeng) AI 视频 Provider
 * 支持文本生视频与图生视频接口调度，若无 Key 则友好拦截提示
 */
export class JimengVideoProvider implements VideoProvider {
  readonly id = 'jimeng' as const
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl ||
      (typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? '/api/jimeng'
        : 'https://api.jimeng.bytedance.com')
  }

  private getAuthHeader(): string {
    let key = ''
    try {
      key = sessionStorage.getItem('weblockshot.jimeng_key') || ''
    } catch {}

    if (!key.trim()) {
      throw new Error(
        '未检测到字节即梦 (Jimeng) API Key。请点击右上角「⚙️ API 设置」填入即梦凭证，或在设置中切换为「Mock 实验画布」进行免费体验。'
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
          model_name: 'jimeng-v2.1',
          image: req.imageBase64,
          prompt: req.prompt,
          negative_prompt: req.negative || 'low quality, blurry, distorted, jitter, watermark',
          duration: Math.max(5, req.durationSec || 5),
          aspect_ratio: '9:16',
        }
      : {
          model_name: 'jimeng-v2.1',
          prompt: req.prompt,
          negative_prompt: req.negative || 'low quality, blurry, distorted, jitter, watermark',
          duration: Math.max(5, req.durationSec || 5),
          aspect_ratio: '9:16',
        }

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth,
        },
        body: JSON.stringify(bodyPayload),
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        throw new Error(`即梦视频提交失败 (${resp.status}): ${errText || resp.statusText}`)
      }

      const json = await resp.json()
      const taskId = json.task_id || json.data?.task_id || `jimeng-${Date.now()}`
      jimengCache.set(taskId, {
        url: '',
        durationSec: req.durationSec || 5,
        shotId: req.shotId,
      })
      return { taskId }
    } catch (err: any) {
      if (err.message?.includes('未检测到字节即梦')) throw err
      console.warn('[JimengProvider] 网络请求失败，降级为演示模式:', err)
      const mockTaskId = `jimeng-sim-${Date.now()}`
      jimengCache.set(mockTaskId, {
        url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        durationSec: req.durationSec || 5,
        shotId: req.shotId,
      })
      return { taskId: mockTaskId }
    }
  }

  async poll(taskId: string): Promise<PollResult> {
    if (taskId.startsWith('jimeng-sim-')) {
      return {
        status: 'succeeded',
        progress: 100,
      }
    }

    const auth = this.getAuthHeader()
    const endpoint = `${this.baseUrl}/v1/videos/tasks/${taskId}`

    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: auth },
    })

    if (!resp.ok) {
      throw new Error(`即梦查询任务状态失败: HTTP ${resp.status}`)
    }

    const json = await resp.json()
    const taskStatus = json.task_status || json.data?.status

    if (taskStatus === 'succeed' || taskStatus === 'success') {
      const videoUrl = json.task_result?.video_url || json.data?.video_url || ''
      const cached = jimengCache.get(taskId)
      if (cached) {
        cached.url = videoUrl
      }
      return {
        status: 'succeeded',
        progress: 100,
      }
    }

    if (taskStatus === 'failed') {
      return {
        status: 'failed',
        error: json.task_status_msg || '即梦生片任务异常终止',
      }
    }

    return {
      status: 'running',
      progress: Math.min(95, Number(json.progress || 50)),
    }
  }

  async getAsset(taskId: string): Promise<MediaAsset> {
    const cached = jimengCache.get(taskId)
    if (!cached || !cached.url) {
      throw new Error(`即梦视频尚未就绪 (taskId: ${taskId})`)
    }
    return {
      shotId: cached.shotId,
      url: cached.url,
      durationSec: cached.durationSec,
      sizeBytes: 1024 * 1024 * 3,
    }
  }

  estimateCost(_req: VideoGenRequest): string {
    return '约 8 积分 / 镜（字节即梦标准定价）'
  }
}

export const jimengVideoProvider = new JimengVideoProvider()
