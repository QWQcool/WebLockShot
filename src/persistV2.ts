import type { ProductInput } from './domain/product.ts'
import type { Script } from './domain/script.ts'
import type { VisualPlan } from './domain/sellVisual.ts'
import type { ShotJob } from './domain/shotJob.ts'
import { readGenerateSession } from './persist.ts'
import type { Story } from './types.ts'

export const PIPELINE_SESSION_V2_KEY = 'weblockshot.pipeline.v2' as const

export type PipelineSessionV2 = {
  version: 2
  id: string
  activeStep: number
  productInput?: ProductInput
  selectedTemplateId?: string
  script?: Script
  story?: Story
  visualPlans?: VisualPlan[]
  jobs?: ShotJob[]
  updatedAt: number
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // 禁用或受限环境
  }
  return null
}

export function savePipelineSession(session: PipelineSessionV2): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(
      PIPELINE_SESSION_V2_KEY,
      JSON.stringify({ ...session, updatedAt: Date.now() })
    )
  } catch (err) {
    console.warn('保存 PipelineSessionV2 失败:', err)
  }
}

export function loadPipelineSession(): PipelineSessionV2 | null {
  const storage = getStorage()
  if (!storage) return null

  // 1. 优先读取 v2 会话
  try {
    const raw = storage.getItem(PIPELINE_SESSION_V2_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.version === 2) {
        return parsed as PipelineSessionV2
      }
    }
  } catch (err) {
    console.warn('解析 PipelineSessionV2 失败:', err)
  }

  // 2. 兼容读取 v1 旧剧情会话并桥接为 v2
  try {
    const v1 = readGenerateSession()
    if (v1 && v1.shots.length > 0 && v1.envelope) {
      const bridgedStory: Story = {
        ...v1.envelope,
        shots: v1.shots,
      }
      return {
        version: 2,
        id: `bridged-${v1.id}`,
        activeStep: 3, // 默认落在分镜预演步
        story: bridgedStory,
        updatedAt: v1.startedAt,
      }
    }
  } catch {
    // 忽略 v1 读取错误
  }

  return null
}

export function clearPipelineSession(): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(PIPELINE_SESSION_V2_KEY)
  } catch {}
}
