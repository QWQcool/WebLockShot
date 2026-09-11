import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ONBOARDING_SCENE_TABS,
  ONBOARDING_SEEN_KEY,
  markOnboardingSeen,
  onboardingPromptFor,
  readOnboardingSeen,
  resetOnboardingSeen,
} from '../canvasOnboarding.ts'
import { ORCHESTRATION_SYSTEM_PROMPT } from '../orchestrationPrompt.ts'
import { CANVAS_SCENE_TEMPLATES, ORCHESTRATION_SCENES } from '../contract.ts'

/** 内存 Storage stub（node 环境无 localStorage） */
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

/* ---------------- 场景 tab ---------------- */

test('ONBOARDING_SCENE_TABS：五类 tab + id 唯一 + 覆盖全部编排场景', () => {
  assert.equal(ONBOARDING_SCENE_TABS.length, 5)
  const ids = ONBOARDING_SCENE_TABS.map((t) => t.id)
  assert.equal(new Set(ids).size, 5, 'tab id 不重复')
  for (const t of ONBOARDING_SCENE_TABS) {
    assert.ok(t.label.length > 0)
    assert.ok(t.icon.length > 0)
    assert.ok(
      (ORCHESTRATION_SCENES as readonly string[]).includes(t.scene),
      `${t.id} 的 scene 必须在 ORCHESTRATION_SCENES 内`
    )
  }
  // 五个 tab 恰好覆盖五个编排场景（不重不漏）
  assert.deepEqual(
    [...ONBOARDING_SCENE_TABS.map((t) => t.scene)].sort(),
    [...ORCHESTRATION_SCENES].sort()
  )
})

test('onboardingPromptFor：复用既有场景模板文案（单一来源，非空）', () => {
  for (const scene of ORCHESTRATION_SCENES) {
    const prompt = onboardingPromptFor(scene)
    assert.ok(prompt.length > 0, `${scene} 应有预填 prompt`)
    const tpl = CANVAS_SCENE_TEMPLATES.find((t) => t.id === scene)
    assert.equal(prompt, tpl?.prompt, `${scene} 应与 CANVAS_SCENE_TEMPLATES 同源`)
  }
})

/* ---------------- 已读标记 ---------------- */

test('readOnboardingSeen：缺失/脏值 → false；mark 后 true；reset 后 false', () => {
  const store = memStorage()
  assert.equal(readOnboardingSeen(store), false)

  markOnboardingSeen(store)
  assert.equal(readOnboardingSeen(store), true)
  assert.equal(store._map.get(ONBOARDING_SEEN_KEY), '1')

  resetOnboardingSeen(store)
  assert.equal(readOnboardingSeen(store), false)

  // 脏值（非 '1'）视为未看过
  assert.equal(readOnboardingSeen(memStorage({ [ONBOARDING_SEEN_KEY]: 'yes' })), false)
  assert.equal(readOnboardingSeen(memStorage({ [ONBOARDING_SEEN_KEY]: '' })), false)
})

test('readOnboardingSeen：存储不可用 → false（不抛异常，首次正常叠加）', () => {
  const broken = {
    getItem: () => {
      throw new Error('storage blocked')
    },
    setItem: () => {
      throw new Error('storage blocked')
    },
    removeItem: () => {
      throw new Error('storage blocked')
    },
  }
  assert.equal(readOnboardingSeen(broken), false)
  // mark 在坏存储下不抛异常
  markOnboardingSeen(broken)
  resetOnboardingSeen(broken)
})

/* ---------------- 共享 prompt（D5 遗留小修） ---------------- */

test('ORCHESTRATION_SYSTEM_PROMPT：关键约束齐备（kind 枚举 / brief 首节点 / scriptScene 枚举）', () => {
  assert.ok(ORCHESTRATION_SYSTEM_PROMPT.includes('brief, product, script, storyboard, generate, deliver'))
  assert.ok(ORCHESTRATION_SYSTEM_PROMPT.includes('第一个节点必须是 brief'))
  assert.ok(ORCHESTRATION_SYSTEM_PROMPT.includes('ecommerce'))
  assert.ok(ORCHESTRATION_SYSTEM_PROMPT.includes('brand'))
  assert.ok(ORCHESTRATION_SYSTEM_PROMPT.includes('drama'))
  assert.ok(ORCHESTRATION_SYSTEM_PROMPT.includes('不加 Markdown 围栏'))
})
