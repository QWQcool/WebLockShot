import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'
import { probeVideoBlob } from '../assetSize.ts'
import { getEngineProxyBase } from '../../services/backend/proxyConfig.ts'

const jimengCache = new Map<string, { url: string; durationSec: number; shotId: string }>()

/**
 * 即梦 (Jimeng) AI 视频 Provider
 * 支持文本生视频与图生视频接口调度，若无 Key 则友好拦截提示
 */
export class JimengVideoProvider implements VideoProvider {
  readonly id = 'jimeng' as const
  private baseUrl: string

  constructor(baseUrl?: string) {
    // localhost 走反代解决跨域；前缀可经 VITE_API_PROXY_BASE 配置（默认 '/api'，现状不变）
    this.baseUrl =
      baseUrl ||
      (typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? getEngineProxyBase('jimeng')
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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (errMsg.includes('未检测到字节即梦')) throw err
      // 绝不静默降级：网络/服务异常必须显式抛错，由上层走 failed -> refund 退款流程
      console.warn('[JimengProvider] 网络请求失败，任务显式失败:', err)
      throw new Error(
        `即梦视频提交失败: ${errMsg || '网络异常'}。请检查网络与 API Key 配置，或切换为 Mock / ComfyUI 模式。`
      )
    }
  }

  async poll(taskId: string): Promise<PollResult> {
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

    // 真实 blob.size 替换硬编码估算值
    const probed = await probeVideoBlob(cached.url)
    cached.url = probed.url

    return {
      shotId: cached.shotId,
      url: probed.url,
      durationSec: cached.durationSec,
      sizeBytes: probed.sizeBytes,
    }
  }

  estimateCost(_req: VideoGenRequest): string {
    return '约 8 积分 / 镜（字节即梦标准定价）'
  }
}

export const jimengVideoProvider = new JimengVideoProvider()
