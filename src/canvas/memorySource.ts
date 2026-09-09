/**
 * 画布记忆双模聚合源（CANVAS_PLAN.md §9 S3 / §5.3）
 *
 * 唯一聚合层 = src/domain/feedback.ts 的 computeWinRates（Laplace 平滑）——
 * server 模式与本地模式只是 records 来源不同，聚合与 lookup 构建完全同源（buildWinRateLookup）。
 *
 * - server 模式：/healthz 探测 memory:'sqlite' → records 走 /api/memory/records
 * - 纯前端模式（探测失败 / 非 sqlite）：records 走 IndexedDB（feedback.ts 既有）
 *   —— UI 必须按返回的 mode 如实标注「纯前端模式 · 记忆仅存本地」
 *
 * 依赖注入（fetchImpl/probeImpl）供 node --test 双路对拍与故障注入。
 */
import { buildWinRateLookup, getAllFeedbackRecords, computeWinRates, type FeedbackRecord, type WinRateAggregate } from '../domain/feedback.ts'
import { probeMemoryCapability, fetchMemoryRecords } from '../services/companion/memoryClient.ts'

export type MemorySourceMode = 'server' | 'local'

export type MemorySource = {
  mode: MemorySourceMode
  records: FeedbackRecord[]
  aggregate: WinRateAggregate
  /** 命中历史数据时非 undefined（供 weightedSampleHook 加权采样） */
  lookup: ((templateId: string, hookIndex: number) => number | undefined) | undefined
}

export type MemorySourceDeps = {
  probe?: () => Promise<{ serverMode: boolean }>
  fetchRecords?: () => Promise<{ ok: true; records: unknown[] } | { ok: false; error: string }>
}

/** 校验服务端记录形状（服务端做最小校验；前端 zod 收口读取侧） */
function isFeedbackRecordShape(r: unknown): r is FeedbackRecord {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false
  const o = r as Record<string, unknown>
  return (
    typeof o.videoTitle === 'string' &&
    typeof o.templateId === 'string' &&
    typeof o.hookIndex === 'number' &&
    Number.isInteger(o.hookIndex) &&
    typeof o.view3sRate === 'number' &&
    typeof o.completionRate === 'number'
  )
}

/**
 * 解析记忆源（双模聚合）。服务端探测/拉取失败一律优雅降级为本地模式（如实标注）。
 */
export async function resolveMemorySource(deps: MemorySourceDeps = {}): Promise<MemorySource> {
  const probe = deps.probe ?? probeMemoryCapability
  let records: FeedbackRecord[] = []
  let mode: MemorySourceMode = 'local'

  try {
    const cap = await probe()
    if (cap.serverMode) {
      const fetchRecords = deps.fetchRecords ?? fetchMemoryRecords
      const result = await fetchRecords()
      if (result.ok) {
        records = result.records.filter(isFeedbackRecordShape)
        mode = 'server'
      }
      // 服务端拉取失败 → 降级本地（诚实：mode 保持 'local'）
    }
  } catch {
    // 探测异常 → 纯前端模式
  }

  if (mode === 'local') {
    records = await getAllFeedbackRecords()
  }

  const aggregate = computeWinRates(records)
  return { mode, records, aggregate, lookup: buildWinRateLookup(records) }
}
