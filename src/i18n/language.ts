/**
 * 语言状态（CANVAS_PLAN.md §9 I1）。
 *
 * - 持久化：localStorage 单键 `weblockshot.language`（与 canvasStore / memoryPrefs 同策略）
 * - 脏值自愈：非法值一律回落 `DEFAULT_LANGUAGE`（中文）→ 零回归
 * - 订阅：模块级极简 store + `useSyncExternalStore`，避免 Context 层层透传
 * - 纯逻辑（Storage 注入）可被 `node --test` 直接覆盖
 */
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from './strings.ts'

export const LANGUAGE_STORAGE_KEY = 'weblockshot.language' as const

export type MinimalStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function resolveStorage(storage?: MinimalStorage | null): MinimalStorage | null {
  if (storage) return storage
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // 隐私模式等受限环境
  }
  return null
}

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v)
}

/** 读取语言（缺失/脏值/存储不可用 → 默认中文） */
export function readLanguage(storage?: MinimalStorage | null): Language {
  const s = resolveStorage(storage)
  if (!s) return DEFAULT_LANGUAGE
  try {
    const raw = s.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(raw) ? raw : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

/** 写入语言（存储不可用静默，本次会话内仍生效） */
export function writeLanguage(lang: Language, storage?: MinimalStorage | null): void {
  const s = resolveStorage(storage)
  if (!s) return
  try {
    s.setItem(LANGUAGE_STORAGE_KEY, lang)
  } catch {
    // 静默：下次读取回落默认值
  }
}

/**
 * 首次进入的初始语言：优先显式存储值；无存储时按浏览器语言推断
 * （`en*` → 英文，其余 → 中文默认）。**不写入存储**——避免把「推断」固化成「用户选择」。
 */
export function resolveInitialLanguage(navLang?: string, storage?: MinimalStorage | null): Language {
  const stored = resolveStorage(storage)?.getItem(LANGUAGE_STORAGE_KEY)
  if (isLanguage(stored)) return stored
  const nav = navLang ?? (typeof navigator !== 'undefined' ? navigator.language : undefined)
  return typeof nav === 'string' && /^en\b/i.test(nav) ? 'en' : DEFAULT_LANGUAGE
}

/* ---------------- 模块级订阅 store ---------------- */

let current: Language | null = null
const listeners = new Set<() => void>()

/** 当前语言快照（首次调用惰性读取存储/浏览器语言） */
export function getLanguageSnapshot(): Language {
  if (current === null) current = resolveInitialLanguage()
  return current
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 切换语言：写存储 + 通知订阅者（同值不触发通知） */
export function setLanguage(lang: Language): void {
  if (!isLanguage(lang)) return
  const prev = getLanguageSnapshot()
  current = lang
  writeLanguage(lang)
  if (prev !== lang) for (const fn of listeners) fn()
}

/** 测试用：重置模块级快照 */
export function __resetLanguageSnapshotForTest(): void {
  current = null
  listeners.clear()
}
