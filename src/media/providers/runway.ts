import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'
import { withRetry, isRetryableHttpStatus, isAbortError } from '../../ai/retry.ts'
import { probeVideoBlob } from '../assetSize.ts'

/**
 * Runway（M1 海外引擎 · 契约先行）
 *
 * 官方契约（api.dev.runwayml.com）：
 * - `POST /v1/text_to_video` / `POST /v1/image_to_video` → `{ id }`
 *   请求体：`{ model, promptText, promptImage?, ratio, duration }`
 * - `GET  /v1/tasks/{id}` → `{ id, status, progress?, output?: string[], failure? }`
 *   `status ∈ PENDING | THROTTLED | RUNNING | SUCCEEDED | FAILED | CANCELLED`
 * - `DELETE /v1/tasks/{id}` 取消
 * - 请求头：`Authorization: Bearer <API_KEY>` + `X-Runway-Version: <版本日期>`
 *
 * 诚实标注：**请求/响应形状按官方文档实现并由 fixtures 契约测试锁定，但本项目尚未在真实
 * Runway 账号下跑通出片**（无真实 Key 环境）。因此设置面板与文档均标注「待真实环境验证」。
 *
 * 凭据：sessionStorage `weblockshot.runway_key`（Bearer API Key）。
 * 可选：sessionStorage `weblockshot.runway_base` 覆盖 Base URL（自建网关 / 伴生服务反代）。
 */

/** Runway 官方 API 版本头（官方要求显式声明；契约测试锁定其存在） */
export const RUNWAY_API_VERSION = '2024-11-06'
export const RUNWAY_DEFAULT_BASE = 'https://api.dev.runwayml.com'
export const RUNWAY_KEY_STORAGE = 'weblockshot.runway_key'
export const RUNWAY_BASE_STORAGE = 'weblockshot.runway_base'

/** gen4_turbo 官方只接受 5 / 10 秒 */
export function runwayDuration(sec: number): 5 | 10 {
  return sec > 5 ? 10 : 5
}

/** 9:16 → 官方 ratio 取值（720:1280） */
export const RUNWAY_RATIO = '720:1280'

/**
 * promptImage 归一化：官方接受 https URL 或 data URI。
 * 本地传入的裸 base64 统一补 `data:image/jpeg;base64,` 前缀（契约测试锁定该行为）。
 */
export function normalizeRunwayImage(image?: string): string | undefined {
  if (!image) return undefined
  const trimmed = image.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) return trimmed
  return `data:image/jpeg;base64,${trimmed}`
}

export class RunwayHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'RunwayHttpError'
    this.status = status
  }
}

/** 官方 failure 字段 → 用户可读中文；未知原因透传原文 */
export function runwayErrorMessage(failure: string | undefined, status: string): string {
  const raw = (failure ?? '').trim()
  if (!raw) return `Runway 任务失败（status=${status}）`
  const table: Record<string, string> = {
    'content moderated': '内容审核未通过：请调整提示词或参考图后重试',
    'rate limit exceeded': '触发 Runway 限流：请降低生成频率后重试',
    'insufficient credits': 'Runway 账户额度不足：请在官方后台充值后重试',
  }
  const hit = Object.entries(table).find(([needle]) => raw.toLowerCase().includes(needle))
  return hit ? hit[1] : raw
}

type RunwayTaskCache = { url: string; durationSec: number; shotId: string }
const runwayCache = new Map<string, RunwayTaskCache>()

function readKey(): string {
  try {
    return sessionStorage.getItem(RUNWAY_KEY_STORAGE)?.trim() || ''
  } catch {
    return ''
  }
}

function readBaseOverride(): string {
  try {
    return sessionStorage.getItem(RUNWAY_BASE_STORAGE)?.trim() || ''
  } catch {
    return ''
  }
}

export function hasRunwayCredential(): boolean {
  return readKey().length > 0
}

function classify(err: unknown): { retry: boolean } {
  if (isAbortError(err)) return { retry: false }
  if (err instanceof RunwayHttpError) return { retry: isRetryableHttpStatus(err.status) }
  if (err instanceof TypeError) return { retry: true }
  return { retry: false }
}

export class RunwayVideoProvider implements VideoProvider {
  readonly id = 'runway' as const
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || readBaseOverride() || RUNWAY_DEFAULT_BASE
  }

  private headers(): Record<string, string> {
    const key = readKey()
    if (!key) {
      throw new Error(
        '未检测到 Runway API Key。请点击右上角「⚙️ API 设置」填入 Runway 密钥，或切换回「Mock 真实录制」模式。'
      )
    }
    return {
      'Content-Type': 'application/json',
      Authorization: key.startsWith('Bearer ') ? key : `Bearer ${key}`,
      'X-Runway-Version': RUNWAY_API_VERSION,
    }
  }

  async submit(req: VideoGenRequest): Promise<{ taskId: string }> {
    const headers = this.headers()
    const image = normalizeRunwayImage(req.imageBase64)
    const endpoint = `${this.baseUrl}/v1/${image ? 'image_to_video' : 'text_to_video'}`

    const bodyPayload: Record<string, unknown> = {
      model: 'gen4_turbo',
      promptText: req.prompt,
      ratio: RUNWAY_RATIO,
      duration: runwayDuration(req.durationSec || 5),
    }
    if (image) bodyPayload.promptImage = image

    const res = await withRetry(
      async () => {
        const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(bodyPayload) })
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          throw new RunwayHttpError(resp.status, `Runway API 提交失败 (${resp.status}): ${errText}`)
        }
        return resp
      },
      { classify }
    )

    const data = await res.json()
    const taskId = data?.id || data?.taskId
    if (!taskId) throw new Error('Runway 未返回有效的任务 id')

    runwayCache.set(taskId, { url: '', durationSec: req.durationSec || 5, shotId: req.shotId })
    return { taskId }
  }

  async poll(taskId: string): Promise<PollResult> {
    const headers = this.headers()
    const res = await withRetry(
      async () => {
        const resp = await fetch(`${this.baseUrl}/v1/tasks/${taskId}`, { headers })
        if (!resp.ok) throw new RunwayHttpError(resp.status, `Runway 轮询失败 HTTP ${resp.status}`)
        return resp
      },
      { classify }
    )

    const data = await res.json()
    const status = String(data?.status ?? '').toUpperCase()
    // 官方 progress 为 0~1 小数，统一换算为 0~100 整数
    const progress =
      typeof data?.progress === 'number' ? Math.round(Math.min(1, Math.max(0, data.progress)) * 100) : undefined

    if (status === 'PENDING') return { status: 'queued', progress: progress ?? 10 }
    if (status === 'THROTTLED') return { status: 'running', progress: progress ?? 20 }
    if (status === 'RUNNING') return { status: 'running', progress: progress ?? 50 }
    if (status === 'SUCCEEDED') {
      const url = Array.isArray(data?.output) ? String(data.output[0] ?? '') : ''
      const cached = runwayCache.get(taskId)
      if (cached) cached.url = url
      return { status: 'succeeded', progress: 100 }
    }
    if (status === 'FAILED' || status === 'CANCELLED') {
      return { status: 'failed', error: runwayErrorMessage(data?.failure, status) }
    }
    return { status: 'running', progress: progress ?? 30 }
  }

  async getAsset(taskId: string): Promise<MediaAsset> {
    const cached = runwayCache.get(taskId)
    if (!cached?.url) throw new Error(`Runway 视频尚未就绪 (taskId: ${taskId})`)
    const probed = await probeVideoBlob(cached.url)
    cached.url = probed.url
    return {
      shotId: cached.shotId,
      url: probed.url,
      durationSec: cached.durationSec,
      sizeBytes: probed.sizeBytes,
    }
  }

  async cancel(taskId: string): Promise<void> {
    const headers = this.headers()
    await fetch(`${this.baseUrl}/v1/tasks/${taskId}`, { method: 'DELETE', headers })
  }

  estimateCost(req: VideoGenRequest): string {
    return `约 ${runwayDuration(req.durationSec || 5)}s × Runway 官方积分（海外引擎 · 按官方计费）`
  }
}

export const runwayVideoProvider = new RunwayVideoProvider()
