/**
 * 记忆采集开关持久化（CANVAS_PLAN.md §9 E1）
 *
 * 语义（E1 验收标准 4）：
 * - 「记忆已开启」关闭后，新回流记录不再写入（本地不落新条目 / server POST 不发）；
 * - 已有记录不静默删除；重开恢复采集；
 * - 开关状态持久化（刷新保持），存 localStorage 单 key。
 *
 * 纯函数 + Storage 注入（node --test 可跑，对齐 canvasStore 的注入模式）。
 * 写入侧（FeedbackDashboard 本地路径 / 未来 server POST 路径）统一读本模块判定。
 */
import { z } from 'zod'

export const MEMORY_ENABLED_STORAGE_KEY = 'weblockshot.memory_enabled'

/** 存储值契约：JSON 布尔。非布尔的脏值一律按默认（开启）处理，不抛错打断主流程 */
const MemoryEnabledSchema = z.boolean()

export type MinimalStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

/**
 * 读取采集开关。缺省/解析失败/类型不合法 → true（默认开启，fail-open）。
 * store 缺省时用 window.localStorage（非浏览器环境返回默认 true）。
 */
export function readMemoryEnabled(store?: MinimalStorage | null): boolean {
  const s = store ?? defaultStorage()
  if (!s) return true
  try {
    const raw = s.getItem(MEMORY_ENABLED_STORAGE_KEY)
    if (raw === null) return true
    const parsed: unknown = JSON.parse(raw)
    return MemoryEnabledSchema.parse(parsed)
  } catch {
    return true
  }
}

/** 写入采集开关（store 缺省时用 window.localStorage；写入失败静默——UI 态与持久化态下次读取如实对齐） */
export function writeMemoryEnabled(enabled: boolean, store?: MinimalStorage | null): void {
  const s = store ?? defaultStorage()
  if (!s) return
  try {
    s.setItem(MEMORY_ENABLED_STORAGE_KEY, JSON.stringify(MemoryEnabledSchema.parse(enabled)))
  } catch {
    // localStorage 受限（隐私模式等）：静默，开关仅在当前会话生效
  }
}

function defaultStorage(): MinimalStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // 禁用或受限环境
  }
  return null
}
