import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILL_LIBRARY_STORAGE_KEY,
  installSkill,
  readSkillLibrary,
  setSkillEnabled,
  uninstallSkill,
  writeSkillLibrary,
  type InstalledSkill,
} from '../skillLibrary.ts'
import { OFFICIAL_SKILLS } from '../contract.ts'

function stubStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

const SIX_STEP = OFFICIAL_SKILLS[0].manifest
const SINGLE_OUT = OFFICIAL_SKILLS[1].manifest

test('skillLibrary：缺省（无存储/无键/坏 JSON/非数组）→ 空库不抛错', () => {
  assert.deepEqual(readSkillLibrary(null), [])
  assert.deepEqual(readSkillLibrary(stubStore()), [])
  assert.deepEqual(readSkillLibrary(stubStore({ [SKILL_LIBRARY_STORAGE_KEY]: 'not-json' })), [])
  assert.deepEqual(readSkillLibrary(stubStore({ [SKILL_LIBRARY_STORAGE_KEY]: '{"a":1}' })), [])
})

test('skillLibrary：安装 → 来源标记 + 持久化往返', () => {
  const store = stubStore()
  const r1 = installSkill([], SIX_STEP, 'official', store)
  assert.equal(r1.ok, true)
  if (!r1.ok) return
  assert.equal(r1.entry.source, 'official')
  assert.equal(r1.entry.enabled, true)

  const r2 = installSkill(r1.entries, SINGLE_OUT, 'conversation', store)
  assert.equal(r2.ok, true)

  const loaded = readSkillLibrary(store)
  assert.equal(loaded.length, 2)
  assert.deepEqual(
    loaded.map((e) => e.source).sort(),
    ['conversation', 'official']
  )
  // manifest 内容原样保真
  assert.equal(loaded[0].manifest.name, SIX_STEP.name)
})

test('skillLibrary：同名拒绝（中文名 trim 后比对）', () => {
  const r1 = installSkill([], SIX_STEP, 'official', stubStore())
  assert.equal(r1.ok, true)
  if (!r1.ok) return
  const r2 = installSkill(r1.entries, { ...SIX_STEP, nodes: [...SIX_STEP.nodes] }, 'import')
  assert.equal(r2.ok, false)
  if (r2.ok) return
  assert.match(r2.reason, /同名 Skill「六步爆款带货流」已安装/)
})

test('skillLibrary：启停与卸载（未命中返回 null 表示无变化）', () => {
  const r = installSkill([], SINGLE_OUT, 'import', stubStore())
  assert.equal(r.ok, true)
  if (!r.ok) return
  const id = r.entry.id

  const off = setSkillEnabled(r.entries, id, false, store_of(r.entries))
  assert.ok(off)
  if (!off) return
  assert.equal(off[0].enabled, false)

  const removed = uninstallSkill(off, id, store_of(off))
  assert.ok(removed)
  assert.equal(removed.length, 0)

  // 未命中 id：无变化
  assert.equal(setSkillEnabled(r.entries, 'no-such-id', false), null)
  assert.equal(uninstallSkill(r.entries, 'no-such-id'), null)
})

test('skillLibrary：读取自愈——坏条目跳过、合法条目保留、同 id 去重保留最新', () => {
  const good = installSkill([], SINGLE_OUT, 'import', null)
  assert.equal(good.ok, true)
  if (!good.ok) return
  const goodEntry: InstalledSkill = good.entry

  const corrupted = [
    { id: 'bad-1', source: 'alien', enabled: true, installedAt: 1, manifest: {} }, // 非法 source
    { id: 'bad-2', source: 'import', enabled: true, installedAt: 2, manifest: { version: 999 } }, // manifest 校验不过
    'not-even-an-object',
    goodEntry,
    { ...goodEntry, installedAt: (goodEntry.installedAt ?? 0) + 5000, enabled: false }, // 同 id 新版本
  ]
  const store = stubStore({ [SKILL_LIBRARY_STORAGE_KEY]: JSON.stringify(corrupted) })
  const loaded = readSkillLibrary(store)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, goodEntry.id)
  assert.equal(loaded[0].enabled, false, '同 id 保留 installedAt 最新')
})

/** 辅助：把内存 entries 写进一个 stub store（模拟持久化往返） */
function store_of(entries: InstalledSkill[]) {
  const s = stubStore()
  writeSkillLibrary(entries, s)
  return s
}
