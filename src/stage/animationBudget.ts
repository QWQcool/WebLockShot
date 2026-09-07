/**
 * 动画预算 (Animation Budget)：移动端 / 低端设备 GSAP 降级判断（M1d）。
 *
 * prefers-reduced-motion 判断已有；本模块扩展「移动判断」：
 * 小屏（<768px）/ 触屏粗指针 / 低端硬件（核数或内存不足）时降低动画并发与装饰性动画数量。
 * 所有动画入口统一从本模块取预算，避免各处散落 matchMedia。
 */

function safeMatchMedia(query: string): MediaQueryList | null {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
    return window.matchMedia(query)
  } catch {
    return null
  }
}

/** 用户偏好减少动画（系统级） */
export function prefersReducedMotion(): boolean {
  return safeMatchMedia('(prefers-reduced-motion: reduce)')?.matches ?? false
}

/** 手机/平板类设备：粗指针（触屏）或小屏 */
export function isMobileLike(): boolean {
  const coarse = safeMatchMedia('(pointer: coarse)')?.matches ?? false
  const small = safeMatchMedia('(max-width: 767px)')?.matches ?? false
  return coarse || small
}

/** 低端设备：CPU 核心少或内存受限（deviceMemory 仅 Chromium 提供，缺失视为不限制） */
export function isLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores = nav.hardwareConcurrency ?? 8
  const memoryGb = nav.deviceMemory ?? 8
  return cores <= 4 || memoryGb <= 4
}

/**
 * 分镜动画是否需要降级（reduced-motion / 移动 / 低端任一命中）。
 * 返回值可直接接到 useShotTimeline 的 reducedMotion 参数。
 */
export function shouldReduceTimelineMotion(): boolean {
  return prefersReducedMotion() || isMobileLike() || isLowEndDevice()
}

/**
 * 装饰性动画（如弹幕、粒子、飘字）数量预算：
 * - 系统减动效：0（完全关闭）
 * - 移动/低端：40%（减并发）
 * - 桌面：全量
 */
export function getDecorativeAnimationBudget(maxCount: number): number {
  if (prefersReducedMotion()) return 0
  if (isMobileLike() || isLowEndDevice()) return Math.ceil(maxCount * 0.4)
  return maxCount
}
