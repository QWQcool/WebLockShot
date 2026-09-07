/**
 * 结构化日志（M1c 可观测预留）：pino 封装。
 *
 * pino 为运行时依赖；级别经 WLS_LOG_LEVEL 控制（默认 info）。
 * 输出 JSON 行，便于生产环境采集；本地开发可设 WLS_LOG_LEVEL=debug。
 */
import pino from 'pino'

export function createLogger(opts = {}) {
  const level = opts.level || process.env.WLS_LOG_LEVEL || 'info'
  return pino({
    level,
    base: { app: 'weblockshot' },
    timestamp: pino.stdTimeFunctions.isoTime,
  })
}
