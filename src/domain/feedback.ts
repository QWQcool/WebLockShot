/**
 * 数据反馈闭环 (Feedback Loop)
 *
 * 用户手动录入平台数据（3秒完播率/完播率/转化）→ IndexedDB 存储 →
 * 按钩子/结构/品类聚合胜率 → ScriptWriter 采样时胜率加权。
 * 胜率计算采用 Laplace 平滑：(wins + 1) / (trials + 2)，避免小样本过拟合。
 */
import { z } from 'zod'

const DB_NAME = 'weblockshot-feedback'
const DB_VERSION = 1
const STORE_NAME = 'records'

export const FeedbackRecordSchema = z.object({
  id: z.string().optional(),
  /** 视频标题（便于人工对账） */
  videoTitle: z.string().min(1),
  /** 命中的结构模板 id */
  templateId: z.string().min(1),
  /** 命中的钩子在模板内的下标 */
  hookIndex: z.number().int().min(0).max(5),
  /** 钩子类型标签（可选） */
  hookType: z.string().optional(),
  /** 商品种类（可选） */
  category: z.string().optional(),
  /** 3 秒完播率 0~1 */
  view3sRate: z.number().min(0).max(1),
  /** 完播率 0~1 */
  completionRate: z.number().min(0).max(1),
  /** 转化数（可选） */
  conversions: z.number().int().min(0).optional(),
  createdAt: z.number().optional(),
})

export type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>

export const FeedbackInputSchema = FeedbackRecordSchema.omit({ id: true, createdAt: true })
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>

/** 胜利判定：3秒完播率 >= 30% 视为该钩子的一次「胜出」 */
export const WIN_THRESHOLD_3S = 0.3

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB 不可用（非浏览器环境）'))
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('templateId', 'templateId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'))
  })
}

/** 录入一条回流数据（自动校验 + 补 id/时间戳） */
export async function addFeedbackRecord(input: FeedbackInput): Promise<FeedbackRecord> {
  const record = FeedbackRecordSchema.parse({
    ...input,
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  })

  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('写入回流数据失败'))
  })
  return record
}

/** 读取全部回流记录（Node/无 IndexedDB 环境返回空数组） */
export async function getAllFeedbackRecords(): Promise<FeedbackRecord[]> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).getAll()
      req.onsuccess = () => resolve((req.result as FeedbackRecord[]) || [])
      req.onerror = () => reject(req.error || new Error('读取回流数据失败'))
    })
  } catch {
    return []
  }
}

export type WinRateStat = { trials: number; wins: number; winRate: number }

export type WinRateAggregate = {
  /** 按结构聚合 */
  byTemplate: Map<string, WinRateStat>
  /** 按钩子聚合（key: `${templateId}#${hookIndex}`） */
  byHook: Map<string, WinRateStat>
  /** 按品类聚合 */
  byCategory: Map<string, WinRateStat>
}

export function emptyStat(): WinRateStat {
  return { trials: 0, wins: 0, winRate: 0.5 }
}

function bump(map: Map<string, WinRateStat>, key: string, win: boolean) {
  const stat = map.get(key) || emptyStat()
  stat.trials += 1
  if (win) stat.wins += 1
  stat.winRate = (stat.wins + 1) / (stat.trials + 2) // Laplace 平滑
  map.set(key, stat)
}

/** 纯函数聚合：可独立单元测试 */
export function computeWinRates(records: FeedbackRecord[]): WinRateAggregate {
  const byTemplate = new Map<string, WinRateStat>()
  const byHook = new Map<string, WinRateStat>()
  const byCategory = new Map<string, WinRateStat>()

  for (const r of records) {
    const win = r.view3sRate >= WIN_THRESHOLD_3S
    bump(byTemplate, r.templateId, win)
    bump(byHook, `${r.templateId}#${r.hookIndex}`, win)
    if (r.category?.trim()) bump(byCategory, r.category.trim(), win)
  }

  return { byTemplate, byHook, byCategory }
}

/**
 * 胜率查询器：注入 ScriptWriter 的钩子加权采样；
 * 无数据或非浏览器环境返回 undefined，采样自动回退先验。
 */
export async function getWinRateLookup(): Promise<
  ((templateId: string, hookIndex: number) => number | undefined) | undefined
> {
  const records = await getAllFeedbackRecords()
  if (records.length === 0) return undefined
  const { byHook } = computeWinRates(records)
  return (templateId: string, hookIndex: number) => {
    return byHook.get(`${templateId}#${hookIndex}`)?.winRate
  }
}
