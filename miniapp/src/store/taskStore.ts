import Taro from '@tarojs/taro'
import type { SubmitTaskResult } from '../api/client'

/**
 * 轻量任务状态（页面间传递）：内存为主 + Taro storage 兜底（进程被杀后可恢复最近一次任务）。
 * 与主仓 PipelineSessionV2 无关——小程序端不做复杂会话持久化（能力边界）。
 */

const STORAGE_KEY = 'weblockshot.mini_task'

export type MiniTask = SubmitTaskResult & {
  prompt: string
  videoUrl?: string
  createdAt: number
}

let current: MiniTask | null = null

export function setCurrentTask(task: MiniTask): void {
  current = task
  try {
    Taro.setStorageSync(STORAGE_KEY, task)
  } catch {
    // storage 受限不致命
  }
}

export function getCurrentTask(): MiniTask | null {
  if (current) return current
  try {
    const stored = Taro.getStorageSync<MiniTask | null>(STORAGE_KEY)
    if (stored && stored.taskId) current = stored
  } catch {
    // ignore
  }
  return current
}

export function markTaskSucceeded(videoUrl: string): void {
  if (current) {
    current = { ...current, videoUrl }
    try {
      Taro.setStorageSync(STORAGE_KEY, current)
    } catch {}
  }
}
