import { z } from 'zod'
import type { VisualPlan } from './sellVisual.ts'

export const MediaAssetSchema = z.object({
  shotId: z.string(),
  url: z.string(),
  coverUrl: z.string().optional(),
  durationSec: z.number(),
  sizeBytes: z.number().optional(),
  /** blob: 资产在进程重启后必失效；标记后 UI 显示失效占位而非死链播放器 */
  urlExpired: z.boolean().optional(),
})

export type MediaAsset = z.infer<typeof MediaAssetSchema>

export const JobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed'])
export type JobStatus = z.infer<typeof JobStatusSchema>

export const VideoProviderIdSchema = z.enum(['mock', 'kling', 'jimeng', 'comfyui'])
export type VideoProviderId = z.infer<typeof VideoProviderIdSchema>

export const ShotJobSchema = z.object({
  shotId: z.string(),
  taskKey: z.string(),
  provider: VideoProviderIdSchema,
  status: JobStatusSchema,
  providerTaskId: z.string().optional(),
  attempt: z.number().int().default(0),
  error: z.string().optional(),
  asset: MediaAssetSchema.optional(),
  progress: z.number().min(0).max(100).default(0),
})

export type ShotJob = z.infer<typeof ShotJobSchema>

/**
 * 任务幂等键生成函数：
 * taskKey = sha1(shotId + visualPlan.positive + visualPlan.durationSec + provider)
 * 同意图不重复提交；想重生成时视觉方案变更或生成不同 shotId
 */
export async function computeTaskKey(
  shotId: string,
  visualPlan: Pick<VisualPlan, 'positive' | 'durationSec'>,
  provider: VideoProviderId
): Promise<string> {
  const raw = `${shotId}:${visualPlan.positive}:${visualPlan.durationSec}:${provider}`
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(raw))
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  // 兜底简单哈希（测试或非安全环境）
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i)
    hash |= 0
  }
  return `fallback-${Math.abs(hash).toString(16)}`
}
