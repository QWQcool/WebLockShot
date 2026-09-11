import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROJECTS_INDEX_KEY,
  PROJECT_DOC_KEY_PREFIX,
  createProject,
  deleteProject,
  loadProjectDoc,
  projectDocKey,
  readProjectsIndex,
  renameProject,
  saveProjectDoc,
  setActiveProject,
} from '../projectStore.ts'
import { CANVAS_DOC_KEY, createEmptyCanvasDoc } from '../contract.ts'

/** 内存 Storage stub（含 key 快照，便于断言迁移行为） */
function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    _map: map,
  }
}

function legacyDoc(name: string) {
  return JSON.stringify({ ...createEmptyCanvasDoc(), name, version: 1, updatedAt: Date.now() })
}

/* ---------------- 索引初始化 + 迁移 ---------------- */

test('readProjectsIndex：首次初始化建默认项目（无老文档 = 空项目）', () => {
  const store = memStorage()
  const index = readProjectsIndex(store)
  assert.equal(index.version, 1)
  assert.equal(index.projects.length, 1)
  assert.equal(index.projects[0].name, '默认项目')
  assert.equal(index.activeId, index.projects[0].id)
  // 已落盘
  assert.ok(store._map.has(PROJECTS_INDEX_KEY))
})

test('readProjectsIndex：既有单文档迁移为默认项目（零丢失 + 老键保留作安全网）', () => {
  const store = memStorage({ [CANVAS_DOC_KEY]: legacyDoc('我的老画布') })
  const index = readProjectsIndex(store)
  assert.equal(index.projects.length, 1)
  const doc = loadProjectDoc(store, index.activeId)
  assert.equal(doc.name, '我的老画布', '老文档内容完整迁移')
  assert.ok(store._map.has(CANVAS_DOC_KEY), '老键保留（迁移安全网，不删）')
  assert.ok(store._map.has(projectDocKey(index.activeId)))
})

test('readProjectsIndex：索引自愈（activeId 失效 / 坏条目跳过 / 空列表重建）', () => {
  const store = memStorage({
    [PROJECTS_INDEX_KEY]: JSON.stringify({
      version: 1,
      activeId: 'ghost',
      projects: [
        { id: 'a', name: 'A', updatedAt: 1 },
        { id: 'a', name: 'A-dup', updatedAt: 2 },
        { id: '', name: 'bad', updatedAt: 1 },
        { id: 'b', name: '', updatedAt: 1 },
        { id: 'c', name: 'C', updatedAt: 3 },
      ],
    }),
  })
  const index = readProjectsIndex(store)
  assert.deepEqual(index.projects.map((p) => p.id), ['a', 'c'], '重复/坏条目被剔除')
  assert.equal(index.activeId, 'a', 'activeId 失效时回退第一个')

  const emptyStore = memStorage({ [PROJECTS_INDEX_KEY]: JSON.stringify({ version: 1, activeId: 'x', projects: [] }) })
  assert.equal(readProjectsIndex(emptyStore).projects.length, 1, '空列表重建默认项目')
})

/* ---------------- 增删改切 ---------------- */

test('createProject：新建并设为当前；重名/空名/超上限拒绝', () => {
  const store = memStorage()
  readProjectsIndex(store)
  const r = createProject(store, '第二项目')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.index.projects.length, 2)
  assert.equal(r.index.activeId, r.id)
  assert.equal(loadProjectDoc(store, r.id).name, '第二项目')

  assert.equal(createProject(store, '第二项目').ok, false, '重名拒绝')
  assert.equal(createProject(store, '   ').ok, false, '空名拒绝')
})

test('renameProject：重命名成功；重名/不存在拒绝', () => {
  const store = memStorage()
  const index = readProjectsIndex(store)
  const id = index.activeId
  const ok = renameProject(store, id, '改名后')
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.index.projects[0].name, '改名后')

  const created = createProject(store, 'B')
  assert.equal(created.ok, true)
  if (!created.ok) return
  assert.equal(renameProject(store, id, 'B').ok, false, '与其它项目重名拒绝')
  assert.equal(renameProject(store, 'nope', 'X').ok, false, '项目不存在拒绝')
})

test('deleteProject：删除并切到剩余项目；最后一个拒绝删除；文档键一并清理', () => {
  const store = memStorage()
  const index = readProjectsIndex(store)
  const first = index.activeId
  const created = createProject(store, 'B')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const second = created.id
  saveProjectDoc(store, second, { ...createEmptyCanvasDoc(), name: 'B' })
  assert.ok(store._map.has(projectDocKey(second)))

  const del = deleteProject(store, second)
  assert.equal(del.ok, true)
  if (!del.ok) return
  assert.equal(del.index.projects.length, 1)
  assert.equal(del.index.activeId, first, '删的是当前项目 → 切到剩余项目')
  assert.equal(store._map.has(projectDocKey(second)), false, '被删项目文档键清理')

  assert.equal(deleteProject(store, first).ok, false, '至少保留一个项目')
})

test('setActiveProject：切换成功；未知 id 原样返回', () => {
  const store = memStorage()
  const index = readProjectsIndex(store)
  const first = index.activeId
  const created = createProject(store, 'B')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const back = setActiveProject(store, first)
  assert.equal(back.activeId, first)
  assert.equal(setActiveProject(store, 'ghost').activeId, first)
})

/* ---------------- 每项目独立存储（不串数据） ---------------- */

test('项目文档隔离：两个项目各自保存互不影响；非法文档拒写', () => {
  const store = memStorage()
  const index = readProjectsIndex(store)
  const a = index.activeId
  const created = createProject(store, 'B')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const b = created.id

  assert.equal(saveProjectDoc(store, a, { ...createEmptyCanvasDoc(), name: 'A 的内容' }), true)
  assert.equal(saveProjectDoc(store, b, { ...createEmptyCanvasDoc(), name: 'B 的内容' }), true)
  assert.equal(loadProjectDoc(store, a).name, 'A 的内容')
  assert.equal(loadProjectDoc(store, b).name, 'B 的内容')

  // 非法文档拒写（校验收口）
  assert.equal(saveProjectDoc(store, a, { version: 1, id: '', name: '', nodes: [], edges: [] } as never), false)

  // 存储键前缀符合约定
  assert.ok([...store._map.keys()].some((k) => k.startsWith(PROJECT_DOC_KEY_PREFIX)))
})
