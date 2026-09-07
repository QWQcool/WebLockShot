import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'
import { withRetry, isRetryableHttpStatus, isAbortError } from '../../ai/retry.ts'
import { probeVideoBlob } from '../assetSize.ts'

export type KlingConfig = {
  apiKey: string
  baseUrl?: string
}

/** 带状态码的 HTTP 错误，供 withRetry 分类可重试性 */
export class KlingHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'KlingHttpError'
    this.status = status
  }
}

/** 任务生成模式：与 poll 端点一一对应 */
export type KlingTaskKind = 'text2video' | 'image2video'

type KlingCacheEntry = {
  url: string
  durationSec: number
  shotId: string
  kind: KlingTaskKind
}

const klingCache = new Map<string, KlingCacheEntry>()

/** 网络类错误（fetch 抛出的 TypeError 等）可重试 */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.name === 'FetchError')
}

function classifyKlingError(err: unknown): { retry: boolean; retryAfter?: string | null } {
  if (isAbortError(err)) return { retry: false }
  if (err instanceof KlingHttpError) {
    return { retry: isRetryableHttpStatus(err.status) }
  }
  if (isNetworkError(err)) return { retry: true }
  return { retry: false }
}

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
    const kind: KlingTaskKind = req.imageBase64 ? 'image2video' : 'text2video'
    const endpoint = `${this.baseUrl}/v1/videos/${kind}`

    const bodyPayload =
      kind === 'image2video'
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

    const res = await withRetry(
      async () => {
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
          throw new KlingHttpError(resp.status, `可灵 API 提交失败 (${resp.status}): ${errText}`)
        }
        return resp
      },
      { classify: classifyKlingError }
    )

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
      kind,
    })

    return { taskId }
  }

  async poll(taskId: string): Promise<PollResult> {
    const auth = this.getAuthHeader()
    // 按任务生成模式区分查询端点：text2video / image2video
    const kind = klingCache.get(taskId)?.kind || 'text2video'
    const endpoint = `${this.baseUrl}/v1/videos/${kind}/${taskId}`

    const res = await withRetry(
      async () => {
        const resp = await fetch(endpoint, {
          headers: {
            Authorization: auth,
          },
        })
        if (!resp.ok) {
          throw new KlingHttpError(resp.status, `可灵轮询失败 HTTP ${resp.status}`)
        }
        return resp
      },
      { classify: classifyKlingError }
    )

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

    // 真实 blob.size 替换硬编码估算值
    const probed = await probeVideoBlob(cached.url)
    if (cached) {
      cached.url = probed.url
    }

    return {
      shotId: cached.shotId,
      url: probed.url,
      durationSec: cached.durationSec,
      sizeBytes: probed.sizeBytes,
    }
  }

  estimateCost(_req: VideoGenRequest): string {
    return '约 10 灵感点 / 镜（快手可灵标准定价）'
  }
}

export const klingVideoProvider = new KlingVideoProvider()
