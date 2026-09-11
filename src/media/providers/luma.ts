import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'
import { withRetry, isRetryableHttpStatus, isAbortError } from '../../ai/retry.ts'
import { probeVideoBlob } from '../assetSize.ts'

/**
 * Luma（M1 海外引擎 · 契约先行）
 *
 * 官方契约（api.lumalabs.ai/dream-machine/v1）：
 * - `POST /generations` → `{ id, state, ... }`
 *   请求体：`{ model, prompt, aspect_ratio, duration, keyframes?, loop? }`
 * - `GET  /generations/{id}` → `{ id, state, assets?: { video?: string }, failure_reason? }`
 *   `state ∈ queued | dreaming | completed | failed`
 * - `DELETE /generations/{id}` 取消
 * - 请求头：`Authorization: Bearer <API_KEY>`
 *
 * 诚实标注：**请求/响应形状按官方文档实现并由 fixtures 契约测试锁定，但本项目尚未在真实
 * Luma 账号下跑通出片**（无真实 Key 环境）。设置面板与文档均标注「待真实环境验证」。
 *
 * 凭据：sessionStorage `weblockshot.luma_key`；可选 `weblockshot.luma_base` 覆盖 Base URL。
 */

export const LUMA_DEFAULT_BASE = 'https://api.lumalabs.ai/dream-machine/v1'
export const LUMA_KEY_STORAGE = 'weblockshot.luma_key'
export const LUMA_BASE_STORAGE = 'weblockshot.luma_base'

/** 竖屏 9:16（官方 aspect_ratio 取值） */
export const LUMA_ASPECT_RATIO = '9:16'

/** ray-2 官方时长档位：5s / 9s */
export function lumaDuration(sec: number): '5s' | '9s' {
  return sec > 5 ? '9s' : '5s'
}

export class LumaHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'LumaHttpError'
    this.status = status
  }
}

/** 官方 failure_reason → 用户可读中文；未知原因透传原文 */
export function lumaErrorMessage(failure: string | undefined, state: string): string {
  const raw = (failure ?? '').trim()
  if (!raw) return `Luma 任务失败（state=${state}）`
  const table: Record<string, string> = {
    'content moderation': '内容审核未通过：请调整提示词或参考图后重试',
    'rate limit': '触发 Luma 限流：请降低生成频率后重试',
    'insufficient credits': 'Luma 账户额度不足：请在官方后台充值后重试',
  }
  const hit = Object.entries(table).find(([needle]) => raw.toLowerCase().includes(needle))
  return hit ? hit[1] : raw
}

/** 官方 keyframes.frame0 接受 image 对象（type + url）；裸 base64 补 data URI 前缀 */
export function normalizeLumaImage(image?: string): string | undefined {
  if (!image) return undefined
  const trimmed = image.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) return trimmed
  return `data:image/jpeg;base64,${trimmed}`
}

type LumaTaskCache = { url: string; durationSec: number; shotId: string }
const lumaCache = new Map<string, LumaTaskCache>()

function readKey(): string {
  try {
    return sessionStorage.getItem(LUMA_KEY_STORAGE)?.trim() || ''
  } catch {
    return ''
  }
}

function readBaseOverride(): string {
  try {
    return sessionStorage.getItem(LUMA_BASE_STORAGE)?.trim() || ''
  } catch {
    return ''
  }
}

export function hasLumaCredential(): boolean {
  return readKey().length > 0
}

function classify(err: unknown): { retry: boolean } {
  if (isAbortError(err)) return { retry: false }
  if (err instanceof LumaHttpError) return { retry: isRetryableHttpStatus(err.status) }
  if (err instanceof TypeError) return { retry: true }
  return { retry: false }
}

export class LumaVideoProvider implements VideoProvider {
  readonly id = 'luma' as const
  private baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || readBaseOverride() || LUMA_DEFAULT_BASE
  }

  private headers(): Record<string, string> {
    const key = readKey()
    if (!key) {
      throw new Error(
        '未检测到 Luma API Key。请点击右上角「⚙️ API 设置」填入 Luma 密钥，或切换回「Mock 真实录制」模式。'
      )
    }
    return {
      'Content-Type': 'application/json',
      Authorization: key.startsWith('Bearer ') ? key : `Bearer ${key}`,
    }
  }

  async submit(req: VideoGenRequest): Promise<{ taskId: string }> {
    const headers = this.headers()
    const image = normalizeLumaImage(req.imageBase64)

    const bodyPayload: Record<string, unknown> = {
      model: 'ray-2',
      prompt: req.prompt,
      aspect_ratio: LUMA_ASPECT_RATIO,
      duration: lumaDuration(req.durationSec || 5),
      loop: false,
    }
    if (image) bodyPayload.keyframes = { frame0: { type: 'image', url: image } }

    const res = await withRetry(
      async () => {
        const resp = await fetch(`${this.baseUrl}/generations`, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyPayload),
        })
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          throw new LumaHttpError(resp.status, `Luma API 提交失败 (${resp.status}): ${errText}`)
        }
        return resp
      },
      { classify }
    )

    const data = await res.json()
    const taskId = data?.id || data?.generation_id
    if (!taskId) throw new Error('Luma 未返回有效的任务 id')

    lumaCache.set(taskId, { url: '', durationSec: req.durationSec || 5, shotId: req.shotId })
    return { taskId }
  }

  async poll(taskId: string): Promise<PollResult> {
    const headers = this.headers()
    const res = await withRetry(
      async () => {
        const resp = await fetch(`${this.baseUrl}/generations/${taskId}`, { headers })
        if (!resp.ok) throw new LumaHttpError(resp.status, `Luma 轮询失败 HTTP ${resp.status}`)
        return resp
      },
      { classify }
    )

    const data = await res.json()
    const state = String(data?.state ?? '').toLowerCase()

    if (state === 'queued') return { status: 'queued', progress: 10 }
    if (state === 'dreaming') return { status: 'running', progress: 50 }
    if (state === 'completed') {
      const url = String(data?.assets?.video ?? '')
      const cached = lumaCache.get(taskId)
      if (cached) cached.url = url
      return { status: 'succeeded', progress: 100 }
    }
    if (state === 'failed') {
      return { status: 'failed', error: lumaErrorMessage(data?.failure_reason, state) }
    }
    return { status: 'running', progress: 30 }
  }

  async getAsset(taskId: string): Promise<MediaAsset> {
    const cached = lumaCache.get(taskId)
    if (!cached?.url) throw new Error(`Luma 视频尚未就绪 (taskId: ${taskId})`)
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
    await fetch(`${this.baseUrl}/generations/${taskId}`, { method: 'DELETE', headers })
  }

  estimateCost(req: VideoGenRequest): string {
    return `约 ${lumaDuration(req.durationSec || 5)} × Luma 官方积分（海外引擎 · 按官方计费）`
  }
}

export const lumaVideoProvider = new LumaVideoProvider()
