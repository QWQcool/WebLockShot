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

/** O9：轮询连续失败容忍上限（默认 3 次），网络抖动不再一次失败即判死 */
export const POLL_FAILURE_TOLERANCE = 3

/**
 * O9：轮询连续失败容忍器（纯函数状态机，主仓与 miniapp 共用）。
 * 连续失败未达上限 → 继续轮询（不判死）；中途任何一次成功 → 计数清零恢复。
 */
export function createPollFailureTolerance(maxFailures: number = POLL_FAILURE_TOLERANCE) {
  let consecutive = 0
  return {
    /** 记录一次成功：清零连续失败计数 */
    onSuccess(): void {
      consecutive = 0
    },
    /** 记录一次失败；返回 true 表示连续失败已达上限，应停止轮询并判定异常 */
    onFailure(): boolean {
      consecutive += 1
      return consecutive >= maxFailures
    },
    get consecutiveFailures(): number {
      return consecutive
    },
  }
}

/**
 * 轮询等待（M1d 手机正确性）：轮询间隔睡眠 + 「回到前台立即唤醒」。
 *
 * 所有轮询循环（useVideoPipeline / executorNode / 后续新增）统一使用本函数：
 * 用户把页面切到后台再切回来时，立即触发下一次轮询（状态即时刷新），
 * 而不是傻等剩余间隔。页面一直在前台时行为与普通 setTimeout 完全一致。
 *
 * Node 环境（无 document）自动退化为纯 setTimeout，测试无需 mock 浏览器。
 */
export function pollSleep(intervalMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (intervalMs <= 0) {
      resolve()
      return
    }

    let done = false
    let sawHidden = false
    let cleanup: () => void = () => {}

    const finish = () => {
      if (done) return
      done = true
      cleanup()
      resolve()
    }

    const timer = setTimeout(finish, intervalMs)

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      sawHidden = document.visibilityState === 'hidden'
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') {
          sawHidden = true
          return
        }
        // 只有期间确实切过后台，回来才立刻唤醒；全程前台保持原节奏
        if (sawHidden) finish()
      }
      const onAbort = () => finish()
      document.addEventListener('visibilitychange', onVisibility)
      signal?.addEventListener('abort', onAbort, { once: true })
      cleanup = () => {
        clearTimeout(timer)
        document.removeEventListener('visibilitychange', onVisibility)
        signal?.removeEventListener('abort', onAbort)
      }
    } else {
      cleanup = () => {
        clearTimeout(timer)
      }
      signal?.addEventListener('abort', () => finish(), { once: true })
    }
  })
}
