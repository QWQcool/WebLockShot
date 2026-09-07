import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'
import { probeVideoBlob } from '../assetSize.ts'
import { getEngineProxyBase } from '../../services/backend/proxyConfig.ts'
import { buildJimengSignedHeaders } from '../auth/jimengAuth.ts'

const jimengCache = new Map<string, { url: string; durationSec: number; shotId: string }>()

/**
 * 错误码 → 用户可读中文（契约表见 test/fixtures/jimeng/error-codes.json）。
 * 未知错误码原样透传（现状兼容）。
 */
export function jimengErrorMessage(code: number | string, rawMessage: string): string {
  const table: Record<string, string> = {
    '100000': '即梦服务内部错误，请稍后重试',
    '100008': '请求参数不合法：请检查提示词、时长与画幅设置',
    '100018': '签名校验失败：请检查 AK/SK 配置与系统时钟',
    '100024': '内容审核未通过：请调整提示词后重试',
    '100029': '触发即梦限流：请降低生成频率后重试',
  }
  return table[String(code)] || rawMessage
}

/**
 * 凭据形态（M2b 契约升级，默认行为不变）：
 * - sessionStorage 存 JSON {"ak":"...","sk":"..."} → 火山引擎 V4 HMAC-SHA256 签名模式
 * - 存裸字符串（现状）→ Bearer 直传模式，行为与历史完全一致
 */
type JimengCredential = { mode: 'signed'; ak: string; sk: string } | { mode: 'bearer'; key: string }

function readJimengCredential(): JimengCredential | null {
  let raw = ''
  try {
    raw = sessionStorage.getItem('weblockshot.jimeng_key') || ''
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
      return { mode: 'signed', ak: parsed.ak, sk: parsed.sk }
    }
  } catch {
    // 非 JSON → 裸 key（现状模式）
  }
  return { mode: 'bearer', key: raw.trim() }
}
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

  /**
   * 按请求构造鉴权头：
   * - bearer 模式（现状）：{ Authorization: Bearer ... }
   * - signed 模式（ak/sk JSON 凭据）：火山引擎 V4 签名（X-Date / X-Content-Sha256 / Authorization）
   */
  private async resolveRequestHeaders(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: string
  ): Promise<Record<string, string>> {
    const cred = readJimengCredential()
    if (!cred) {
      throw new Error(
        '未检测到字节即梦 (Jimeng) API Key。请点击右上角「⚙️ API 设置」填入即梦凭证，或在设置中切换为「Mock 实验画布」进行免费体验。'
      )
    }
    if (cred.mode === 'bearer') {
      const key = cred.key
      return { Authorization: key.startsWith('Bearer ') ? key : `Bearer ${key}` }
    }

    const url = new URL(endpoint)
    const signed = await buildJimengSignedHeaders({
      accessKey: cred.ak,
      secretKey: cred.sk,
      method,
      host: url.host,
      path: url.pathname,
      query: url.search ? url.search.slice(1) : '',
      body: method === 'POST' ? (body || '') : '',
    })
    return { ...signed }
  }

  async submit(req: VideoGenRequest): Promise<{ taskId: string }> {
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

    const bodyStr = JSON.stringify(bodyPayload)
    const authHeaders = await this.resolveRequestHeaders('POST', endpoint, bodyStr)

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: bodyStr,
      })

      if (!resp.ok) {
        // 尽力解析业务错误码并映射为用户可读信息（契约表见 test/fixtures/jimeng/error-codes.json）
        let errText = ''
        try {
          const errJson = await resp.json()
          errText = jimengErrorMessage(errJson?.code, errJson?.message || '')
        } catch {
          errText = (await resp.text().catch(() => '')) || resp.statusText
        }
        throw new Error(`即梦视频提交失败 (${resp.status}): ${errText}`)
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
    const endpoint = `${this.baseUrl}/v1/videos/tasks/${taskId}`
    const authHeaders = await this.resolveRequestHeaders('GET', endpoint)

    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { ...authHeaders },
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
        error: jimengErrorMessage(json.code, json.task_status_msg) || '即梦生片任务异常终止',
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
