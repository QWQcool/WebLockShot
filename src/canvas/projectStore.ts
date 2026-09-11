/**
 * D9 多画布项目存储（CANVAS_PLAN.md §9 D9-②）
 *
 * 单文档 → 多文档：
 * - 索引键 `weblockshot.canvas.projects`：{ version, activeId, projects: [{ id, name, updatedAt }] }
 * - 每文档独立键 `weblockshot.canvas.doc.<id>`（互不干扰，切换不串数据）
 * - **既有单文档零丢失迁移**：首次读取索引时，若存在老键 `weblockshot.canvas.v1`，
 *   把其内容复制进「默认项目」；老键**保留不删**（迁移安全网，回滚可救）
 *
 * 纯逻辑 + Storage 注入（node --test 可跑），不 import React / tldraw。
 */
import {
  CANVAS_DOC_KEY,
  createEmptyCanvasDoc,
  validateCanvasDoc,
  type CanvasDoc,
} from './contract.ts'

export const PROJECTS_INDEX_KEY = 'weblockshot.canvas.projects'
export const PROJECT_DOC_KEY_PREFIX = 'weblockshot.canvas.doc.'
export const PROJECTS_INDEX_VERSION = 1
export const PROJECT_NAME_MAX = 40
export const PROJECT_MAX_COUNT = 50

export type CanvasProjectMeta = { id: string; name: string; updatedAt: number }
export type ProjectsIndex = { version: number; activeId: string; projects: CanvasProjectMeta[] }

export function projectDocKey(id: string): string {
  return `${PROJECT_DOC_KEY_PREFIX}${id}`
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // 受限环境
  }
  return null
}

function newProjectId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function defaultProject(): CanvasProjectMeta {
  return { id: newProjectId(), name: '默认项目', updatedAt: Date.now() }
}

/** 索引自愈：activeId 必须存在；projects 至少一个；坏条目跳过 */
function healIndex(raw: unknown): ProjectsIndex | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const list = Array.isArray(obj.projects) ? obj.projects : null
  if (!list) return null
  const projects: CanvasProjectMeta[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const p = item as Record<string, unknown>
    const id = typeof p.id === 'string' ? p.id.trim() : ''
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, PROJECT_NAME_MAX) : ''
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    projects.push({
      id,
      name,
      updatedAt: typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt) ? p.updatedAt : Date.now(),
    })
  }
  if (projects.length === 0) return null
  const activeId = typeof obj.activeId === 'string' && seen.has(obj.activeId) ? obj.activeId : projects[0].id
  return { version: PROJECTS_INDEX_VERSION, activeId, projects }
}

/**
 * 读取项目索引（含首次迁移）。
 * - 索引存在 → 自愈后返回；
 * - 索引缺失 → 建默认项目；若老单文档键有内容，**复制**进默认项目（零丢失）。
 */
export function readProjectsIndex(storage?: StorageLike | null): ProjectsIndex {
  const s = resolveStorage(storage)
  if (!s) return { version: PROJECTS_INDEX_VERSION, activeId: 'default', projects: [{ id: 'default', name: '默认项目', updatedAt: Date.now() }] }

  let existing: unknown = null
  try {
    const raw = s.getItem(PROJECTS_INDEX_KEY)
    if (raw) existing = JSON.parse(raw)
  } catch {
    existing = null
  }
  const healed = healIndex(existing)
  if (healed) return healed

  // 首次初始化 + 迁移
  const project = defaultProject()
  const index: ProjectsIndex = { version: PROJECTS_INDEX_VERSION, activeId: project.id, projects: [project] }
  try {
    const legacyRaw = s.getItem(CANVAS_DOC_KEY)
    if (legacyRaw) {
      const legacyDoc = validateCanvasDoc(JSON.parse(legacyRaw))
      if (legacyDoc) {
        s.setItem(projectDocKey(project.id), JSON.stringify({ ...legacyDoc, updatedAt: Date.now() }))
        console.info('[Canvas] 已把既有单文档迁移为默认项目（老键保留作安全网）')
      }
    }
  } catch (err) {
    console.warn('[Canvas] 单文档迁移失败（不阻断，按空默认项目继续）:', err)
  }
  writeProjectsIndex(s, index)
  return index
}

export function writeProjectsIndex(storage: StorageLike | null | undefined, index: ProjectsIndex): void {
  const s = resolveStorage(storage)
  if (!s) return
  try {
    s.setItem(PROJECTS_INDEX_KEY, JSON.stringify(index))
  } catch {
    // 存储不可用：本次会话内仍可用
  }
}

/** 读取指定项目文档（缺失/非法 → 空文档） */
export function loadProjectDoc(storage: StorageLike | null | undefined, id: string): CanvasDoc {
  const s = resolveStorage(storage)
  if (!s) return createEmptyCanvasDoc()
  try {
    const raw = s.getItem(projectDocKey(id))
    if (!raw) return createEmptyCanvasDoc()
    return validateCanvasDoc(JSON.parse(raw)) ?? createEmptyCanvasDoc()
  } catch {
    return createEmptyCanvasDoc()
  }
}

/** 保存项目文档（校验失败拒写） */
export function saveProjectDoc(
  storage: StorageLike | null | undefined,
  id: string,
  doc: CanvasDoc
): boolean {
  const s = resolveStorage(storage)
  if (!s) return false
  const validated = validateCanvasDoc(doc)
  if (!validated) {
    console.warn('[Canvas] 拒绝保存不合法的项目文档')
    return false
  }
  try {
    s.setItem(projectDocKey(id), JSON.stringify({ ...validated, updatedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export type ProjectMutationResult =
  | { ok: true; index: ProjectsIndex; id: string }
  | { ok: false; reason: string }

/** 新建项目（名称非空、不重名、数量上限） */
export function createProject(
  storage: StorageLike | null | undefined,
  name: string
): ProjectMutationResult {
  const s = resolveStorage(storage)
  const index = readProjectsIndex(s)
  const trimmed = name.trim().slice(0, PROJECT_NAME_MAX)
  if (!trimmed) return { ok: false, reason: '项目名称不能为空' }
  if (index.projects.some((p) => p.name === trimmed)) {
    return { ok: false, reason: `已存在同名项目「${trimmed}」` }
  }
  if (index.projects.length >= PROJECT_MAX_COUNT) {
    return { ok: false, reason: `项目数已达 ${PROJECT_MAX_COUNT} 上限` }
  }
  const meta: CanvasProjectMeta = { id: newProjectId(), name: trimmed, updatedAt: Date.now() }
  const next: ProjectsIndex = { ...index, activeId: meta.id, projects: [...index.projects, meta] }
  writeProjectsIndex(s, next)
  // 新项目文档名与项目名一致（画布工具栏的名称输入框与项目名同源）
  saveProjectDoc(s, meta.id, { ...createEmptyCanvasDoc(), name: trimmed })
  return { ok: true, index: next, id: meta.id }
}

/** 重命名项目 */
export function renameProject(
  storage: StorageLike | null | undefined,
  id: string,
  name: string
): ProjectMutationResult {
  const s = resolveStorage(storage)
  const index = readProjectsIndex(s)
  const trimmed = name.trim().slice(0, PROJECT_NAME_MAX)
  if (!trimmed) return { ok: false, reason: '项目名称不能为空' }
  if (index.projects.some((p) => p.id !== id && p.name === trimmed)) {
    return { ok: false, reason: `已存在同名项目「${trimmed}」` }
  }
  if (!index.projects.some((p) => p.id === id)) return { ok: false, reason: '项目不存在' }
  const next: ProjectsIndex = {
    ...index,
    projects: index.projects.map((p) => (p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p)),
  }
  writeProjectsIndex(s, next)
  return { ok: true, index: next, id }
}

/** 删除项目（至少保留 1 个；删的是当前项目时切到第一个剩余项目） */
export function deleteProject(storage: StorageLike | null | undefined, id: string): ProjectMutationResult {
  const s = resolveStorage(storage)
  const index = readProjectsIndex(s)
  if (!index.projects.some((p) => p.id === id)) return { ok: false, reason: '项目不存在' }
  if (index.projects.length <= 1) return { ok: false, reason: '至少保留一个项目' }
  const remaining = index.projects.filter((p) => p.id !== id)
  const next: ProjectsIndex = {
    ...index,
    activeId: index.activeId === id ? remaining[0].id : index.activeId,
    projects: remaining,
  }
  writeProjectsIndex(s, next)
  try {
    s?.removeItem(projectDocKey(id))
  } catch {
    // 忽略清理失败
  }
  return { ok: true, index: next, id: next.activeId }
}

/** 切换当前项目（不存在则拒绝） */
export function setActiveProject(storage: StorageLike | null | undefined, id: string): ProjectsIndex {
  const s = resolveStorage(storage)
  const index = readProjectsIndex(s)
  if (!index.projects.some((p) => p.id === id)) return index
  const next: ProjectsIndex = { ...index, activeId: id }
  writeProjectsIndex(s, next)
  return next
}

/** 更新项目 meta 的 updatedAt（保存文档后调用，用于列表排序/展示） */
export function touchProject(storage: StorageLike | null | undefined, id: string): ProjectsIndex {
  const s = resolveStorage(storage)
  const index = readProjectsIndex(s)
  const next: ProjectsIndex = {
    ...index,
    projects: index.projects.map((p) => (p.id === id ? { ...p, updatedAt: Date.now() } : p)),
  }
  writeProjectsIndex(s, next)
  return next
}
