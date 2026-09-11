/**
 * 节点执行历史契约（RunRecord）—— TODO.md P1 · S3 数据层
 *
 * 目的：把「节点跑过什么 / 耗时多久 / 花了多少灵感币 / 失败原因是什么 / 是否退款」
 * 固化成可回看的记录（S4 的「🕘 运行历史」抽屉只消费本契约，不各自记录）。
 *
 * 设计约束：
 * - **单一收口**：记录只在 `ExecutorEngine`（`src/director/nodes/executorNode.ts`）落一条，
 *   UI 层一律不写记录。该引擎同时服务 sell 6 镜管线（单例）与画布 generate 节点（每节点独立实例）。
 * - **诚实标注**：`demo` 字段标记「演示引擎（Mock）产生的记录」，UI 需如实显示「演示 · 非真实生成」。
 * - 本模块只含 zod 契约与**纯函数**（生成 / 裁剪），IndexedDB I/O 在 `src/persist/runStore.ts`，
 *   便于 node --test 直接覆盖纯逻辑。
 */
import { z } from 'zod'

/** 滚动保留上限（超出淘汰最旧），TODO.md P1 建议值 */
export const RUN_RECORD_LIMIT = 200

export const RunStatusSchema = z.enum(['running', 'succeeded', 'failed'])
export type RunStatus = z.infer<typeof RunStatusSchema>

export const RunRecordSchema = z.object({
  id: z.string().min(1),
  /** 触发本次执行的画布节点 id；sell 6 镜管线 / 未接线时为 undefined（UI 显示「未关联节点」） */
  nodeId: z.string().optional(),
  /** 动作类型：画布 CanvasNodeKind（如 generate），sell 管线为 'shot'；默认 'generate' */
  kind: z.string().min(1),
  status: RunStatusSchema,
  /** 动作开始时间戳（ms） */
  startedAt: z.number().int().nonnegative(),
  /** 动作结束时间戳（ms）；running 态可缺省 */
  endedAt: z.number().int().nonnegative().optional(),
  /** 耗时（ms）= endedAt − startedAt（落库时派生，UI 免算） */
  durationMs: z.number().int().nonnegative().optional(),
  /** 本次**实际发生**的灵感币消耗（冻结额；未成功冻结则为 0，不虚报） */
  cost: z.number().nonnegative().default(0),
  /** 是否发生退款（失败 / 超时自动原路退回为 true；成功核销为 false） */
  refunded: z.boolean().default(false),
  /** 演示引擎（Mock provider）产生的记录 → UI 标注「演示 · 非真实生成」 */
  demo: z.boolean().default(false),
  /** 供应商 id（mock / kling / jimeng / comfyui / runway / luma） */
  provider: z.string().optional(),
  /** 关联分镜 id（引擎逐镜执行的 shotId） */
  shotId: z.string().optional(),
  /** 尝试次数（重试后递增） */
  attempt: z.number().int().min(0).optional(),
  /** 失败原因（成功时缺省） */
  error: z.string().optional(),
  /**
   * 输出引用。可能为 `idbref://…`（持久）、真实 URL，或 `blob:`（**刷新后失效**，
   * UI 需按失效语义处理，不要当持久引用）。
   */
  outputRef: z.string().optional(),
})

export type RunRecord = z.infer<typeof RunRecordSchema>

/** 落库输入：id / durationMs 由 createRunRecord 派生，调用方不必提供 */
export const RunRecordInputSchema = RunRecordSchema.omit({ id: true, durationMs: true })
export type RunRecordInput = z.input<typeof RunRecordInputSchema>

/** 模块级自增序号：保证同毫秒内多次落库的 id 唯一且相对有序 */
let runSeq = 0

/**
 * 纯函数：由输入生成一条已校验的记录（补 id、派生 durationMs）。
 * `now` 可注入以便测试确定性；status 为 'running' 时不派生 durationMs。
 */
export function createRunRecord(input: RunRecordInput, now = Date.now()): RunRecord {
  const parsed = RunRecordInputSchema.parse(input)
  runSeq = (runSeq + 1) % 1_000_000
  const id = `run_${now}_${runSeq.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const durationMs =
    parsed.endedAt !== undefined ? Math.max(0, parsed.endedAt - parsed.startedAt) : undefined
  return RunRecordSchema.parse({
    ...parsed,
    id,
    ...(durationMs !== undefined ? { durationMs } : {}),
  })
}

/**
 * 纯函数：滚动裁剪。输入按 **startedAt 升序（最旧在前）**（= 存储顺序），
 * 超出 `limit` 时淘汰最旧，保留最新 `limit` 条。
 */
export function trimRunRecords(records: RunRecord[], limit = RUN_RECORD_LIMIT): RunRecord[] {
  if (limit <= 0) return []
  if (records.length <= limit) return records
  return records.slice(records.length - limit)
}

/**
 * 纯函数：返回**需要淘汰的记录 id**（最旧优先），供存储层精确 delete（避免整表重写）。
 * 输入与 `trimRunRecords` 同为升序。
 */
export function overflowRunIds(records: RunRecord[], limit = RUN_RECORD_LIMIT): string[] {
  if (limit <= 0) return records.map((r) => r.id)
  if (records.length <= limit) return []
  return records.slice(0, records.length - limit).map((r) => r.id)
}
