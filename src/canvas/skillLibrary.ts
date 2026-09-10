/**
 * 已安装 Skill 库（CANVAS_PLAN.md §9 E2「Skill 市场」）
 *
 * - 存储：localStorage 单 key（manifest JSON 轻量，与 CanvasDoc 同策略）；
 * - 来源标记：official（官方内置）/ import（文件上传）/ conversation（对话创建）；
 * - 读取自愈：坏条目（JSON 损坏 / 校验不过）逐条跳过，不让整库报废；
 * - 同名拒绝：installSkill 对已安装同名 Skill 返回失败原因（UI 如实提示）；
 * - 纯函数 + Storage 注入（node --test 可跑，对齐 canvasStore / memoryPrefs 模式）。
 */
import { z } from 'zod'
import { validateSkillManifest, type SkillManifest } from './contract.ts'

export const SKILL_LIBRARY_STORAGE_KEY = 'weblockshot.skill_library'

export type SkillSource = 'official' | 'import' | 'conversation'

export type InstalledSkill = {
  id: string
  source: SkillSource
  /** 启停：停用的官方 Skill 不出现在画布工具条快捷入口（不影响已布置节点） */
  enabled: boolean
  installedAt: number
  manifest: SkillManifest
}

const skillSourceSchema = z.enum(['official', 'import', 'conversation'])

const entryShapeSchema = z.object({
  id: z.string().min(1),
  source: skillSourceSchema,
  enabled: z.boolean(),
  installedAt: z.number().finite().positive(),
  manifest: z.unknown(),
})

export type MinimalStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 读取已安装库（逐条自愈）：存储缺失/JSON 损坏 → 空库；
 * 单条不合法（形状坏 / manifest 校验不过）→ 跳过该条；同 id 重复 → 保留 installedAt 最新。
 */
export function readSkillLibrary(store?: MinimalStorage | null): InstalledSkill[] {
  const s = store ?? defaultStorage()
  if (!s) return []
  let raw: string | null = null
  try {
    raw = s.getItem(SKILL_LIBRARY_STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const byId = new Map<string, InstalledSkill>()
  for (const item of parsed) {
    const shape = entryShapeSchema.safeParse(item)
    if (!shape.success) continue
    const manifest = validateSkillManifest(shape.data.manifest)
    if (!manifest) continue
    const entry: InstalledSkill = {
      id: shape.data.id,
      source: shape.data.source,
      enabled: shape.data.enabled,
      installedAt: shape.data.installedAt,
      manifest,
    }
    const prev = byId.get(entry.id)
    if (!prev || entry.installedAt > prev.installedAt) byId.set(entry.id, entry)
  }
  return [...byId.values()].sort((a, b) => a.installedAt - b.installedAt)
}

/** 写库（序列化失败静默——与 memoryPrefs 同策略，下次读取如实反映） */
export function writeSkillLibrary(entries: InstalledSkill[], store?: MinimalStorage | null): void {
  const s = store ?? defaultStorage()
  if (!s) return
  try {
    s.setItem(SKILL_LIBRARY_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // localStorage 受限（隐私模式等）：静默
  }
}

export type InstallResult =
  | { ok: true; entries: InstalledSkill[]; entry: InstalledSkill }
  | { ok: false; reason: string }

/** 安装：同名已安装拒绝（避免库内重名歧义）；manifest 必须先过整体校验 */
export function installSkill(
  entries: InstalledSkill[],
  manifest: SkillManifest,
  source: SkillSource,
  store?: MinimalStorage | null
): InstallResult {
  if (!validateSkillManifest(manifest)) {
    return { ok: false, reason: 'Skill 包未通过契约校验，拒绝安装' }
  }
  const name = manifest.name.trim()
  if (entries.some((e) => e.manifest.name.trim() === name)) {
    return { ok: false, reason: `同名 Skill「${name}」已安装（如需更新请先卸载旧版本）` }
  }
  const entry: InstalledSkill = {
    id: `sk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    source,
    enabled: true,
    installedAt: Date.now(),
    manifest,
  }
  const next = [...entries, entry]
  writeSkillLibrary(next, store)
  return { ok: true, entries: next, entry }
}

/** 卸载（按 id；未命中返回 null 表示无变化） */
export function uninstallSkill(
  entries: InstalledSkill[],
  id: string,
  store?: MinimalStorage | null
): InstalledSkill[] | null {
  const next = entries.filter((e) => e.id !== id)
  if (next.length === entries.length) return null
  writeSkillLibrary(next, store)
  return next
}

/** 启停（按 id；未命中返回 null 表示无变化） */
export function setSkillEnabled(
  entries: InstalledSkill[],
  id: string,
  enabled: boolean,
  store?: MinimalStorage | null
): InstalledSkill[] | null {
  let changed = false
  const next = entries.map((e) => {
    if (e.id !== id) return e
    changed = true
    return { ...e, enabled }
  })
  if (!changed) return null
  writeSkillLibrary(next, store)
  return next
}

/** 按 manifest.name 查已安装条目（官方快捷按钮启停过滤用） */
export function findInstalledByName(
  entries: InstalledSkill[],
  name: string
): InstalledSkill | undefined {
  return entries.find((e) => e.manifest.name.trim() === name.trim())
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
