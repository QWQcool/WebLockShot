import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'
import { withRetry, isRetryableHttpStatus, isAbortError } from '../../ai/retry.ts'
import { probeVideoBlob } from '../assetSize.ts'
import { getEngineProxyBase } from '../../services/backend/proxyConfig.ts'
import { signKlingJwt } from '../auth/klingJwt.ts'

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

/**
 * 错误码 → 用户可读中文（契约表见 test/fixtures/kling/error-codes.json）。
 * 未知错误码保持历史格式「可灵返回错误 [code]: message」（现状兼容）。
 */
export function klingErrorMessage(code: number | string, rawMessage: string): string {
  const table: Record<string, string> = {
    '1000': '可灵服务内部错误，请稍后重试',
    '1001': '请求参数不合法：请检查提示词、时长与画幅设置',
    '1101': '内容审核未通过：请调整提示词后重试',
    '1200': '生成内容触发安全策略，任务已终止（费用已自动退还）',
    '4027': '触发可灵限流：请降低生成频率后重试',
  }
  return table[String(code)] || `可灵返回错误 [${code}]: ${rawMessage}`
}

/**
 * 凭据形态（M2b 契约升级，默认行为不变）：
 * - sessionStorage 存 JSON {"ak":"...","sk":"..."} → 官方 JWT 签名模式（HS512，Authorization: <JWT>）
 * - 存裸字符串（现状）→ Bearer 直传模式，行为与历史完全一致
 */
type KlingCredential = { mode: 'jwt'; ak: string; sk: string } | { mode: 'bearer'; key: string }

function readKlingCredential(): KlingCredential | null {
  let raw = ''
  try {
    raw = sessionStorage.getItem('weblockshot.kling_key') || ''
  } catch {
    return null
  }
  if (!raw.trim()) return null
  try {
    const parsed = JSON.parse(raw) as { ak?: unknown; sk?: unknown }
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.ak === 'string' &&
      typeof parsed.sk === 'string' &&
      parsed.ak.trim() &&
      parsed.sk.trim()
    ) {
      return { mode: 'jwt', ak: parsed.ak, sk: parsed.sk }
    }
  } catch {
    // 非 JSON → 裸 key（现状模式）
  }
  return { mode: 'bearer', key: raw.trim() }
}

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
    // 开发环境走 Vite 代理解决浏览器跨域，生产走官方域名；代理前缀可经 VITE_API_PROXY_BASE 配置（默认 '/api'）
    this.baseUrl =
      baseUrl ||
      (typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? getEngineProxyBase('kling')
        : 'https://api.klingai.com')
  }

  /** 解析鉴权头：Bearer（现状）或官方 JWT（ak/sk JSON 凭据，异步签名） */
  private async resolveAuthHeader(): Promise<Record<string, string>> {
    const cred = readKlingCredential()
    if (!cred) {
      throw new Error(
        '未检测到快手可灵 API Key。请点击右上角「⚙️ API 设置」填入可灵凭证，或在设置中切换回「Mock 真实录制」模式。'
      )
    }
    if (cred.mode === 'bearer') {
      const key = cred.key
      return { Authorization: key.startsWith('Bearer ') ? key : `Bearer ${key}` }
    }
    const token = await signKlingJwt(cred.ak, cred.sk)
    return { Authorization: token }
  }

  async submit(req: VideoGenRequest): Promise<{ taskId: string }> {
    const authHeaders = await this.resolveAuthHeader()
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
            ...authHeaders,
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
      throw new Error(klingErrorMessage(data.code, data.message || '未知错误'))
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
    const authHeaders = await this.resolveAuthHeader()
    // 按任务生成模式区分查询端点：text2video / image2video
    const kind = klingCache.get(taskId)?.kind || 'text2video'
    const endpoint = `${this.baseUrl}/v1/videos/${kind}/${taskId}`

    const res = await withRetry(
      async () => {
        const resp = await fetch(endpoint, {
          headers: authHeaders,
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
