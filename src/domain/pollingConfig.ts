/**
 * 视频生成任务轮询窗口共享配置 (Polling Window Config)
 *
 * executorNode 与 SingleAgentStudio / MultiAgentStudio 的轮询逻辑共用同一份配置，
 * 默认窗口 10 分钟（200 次 x 3s），用户可在 UI 顶部调整（2 / 5 / 10 / 20 分钟）。
 */

export type PollingWindow = {
  /** 每次轮询间隔（毫秒） */
  intervalMs: number
  /** 最大轮询次数，超过即判定超时并退款 */
  maxAttempts: number
}

export const POLL_WINDOW_PRESETS: Array<{ label: string; minutes: number }> = [
  { label: '2 分钟', minutes: 2 },
  { label: '5 分钟', minutes: 5 },
  { label: '10 分钟', minutes: 10 },
  { label: '20 分钟', minutes: 20 },
]

export const DEFAULT_POLL_WINDOW_MINUTES = 10

let pollingWindow: PollingWindow = minutesToWindow(DEFAULT_POLL_WINDOW_MINUTES)

function minutesToWindow(minutes: number): PollingWindow {
  const intervalMs = 3000
  const maxAttempts = Math.max(1, Math.round((minutes * 60_000) / intervalMs))
  return { intervalMs, maxAttempts }
}

export function getPollingWindow(): PollingWindow {
  return { ...pollingWindow }
}

/** 按分钟数设置轮询窗口（UI 下拉选择） */
export function setPollingWindowMinutes(minutes: number): PollingWindow {
  pollingWindow = minutesToWindow(minutes)
  return getPollingWindow()
}

/** 测试/高级用法：直接覆盖窗口参数 */
export function setPollingWindow(window: PollingWindow): void {
  pollingWindow = { ...window }
}
