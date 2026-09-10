import test from 'node:test'
import assert from 'node:assert/strict'
import { orchestrationPlanToSkillManifest } from '../planToSkill.ts'
import { validateSkillManifestDetailed, type OrchestrationPlan } from '../../canvas/contract.ts'

const DEMO_PLAN: OrchestrationPlan = {
  title: '负离子吹风机带货',
  nodes: [
    { kind: 'brief', params: { text: '负离子吹风机三分钟速干实测' } },
    { kind: 'script', params: { scriptScene: 'ecommerce' } },
    { kind: 'storyboard', params: {} },
    { kind: 'generate', params: {} },
    { kind: 'deliver', params: {} },
  ],
  edges: [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
  ],
}

test('planToSkill：演示编排计划 → 合法 Skill manifest（契约全过）', () => {
  const r = orchestrationPlanToSkillManifest(DEMO_PLAN, '吹风机带货流')
  assert.equal(r.ok, true)
  if (!r.ok) return
  const m = r.manifest
  assert.equal(m.version, 1)
  assert.equal(m.name, '吹风机带货流')
  assert.equal(m.nodes.length, 5)
  assert.deepEqual(m.nodes.map((n) => n.slot), ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5'])
  assert.deepEqual(m.edges, DEMO_PLAN.edges)
  // 转换产物必须整体通过 S1 深度校验（绝不入库半成品）
  assert.equal(validateSkillManifestDetailed(m).ok, true)
})

test('planToSkill：inputs = 入口节点白名单参数槽，outputs = 终点节点', () => {
  const r = orchestrationPlanToSkillManifest(DEMO_PLAN, 'x')
  assert.equal(r.ok, true)
  if (!r.ok) return
  // 入口只有 brief（slot-1），白名单参数 text
  assert.deepEqual(r.manifest.inputs, [
    { slot: 'slot-1', paramKey: 'text', label: '需求 Brief · 需求文本' },
  ])
  // 终点只有 deliver（slot-5）
  assert.deepEqual(r.manifest.outputs, [{ slot: 'slot-5', label: '成片交付' }])
})

test('planToSkill：params 白名单收窄（非法场景/非白名单键被剥离）', () => {
  const dirty: OrchestrationPlan = {
    title: 't',
    nodes: [
      { kind: 'brief', params: { text: '需求原文', evil: '注入字段' } },
      { kind: 'script', params: { scriptScene: 'hacker' } },
    ],
    edges: [{ from: 0, to: 1 }],
  }
  const r = orchestrationPlanToSkillManifest(dirty, 'x')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(r.manifest.nodes[0].params, { text: '需求原文' })
  // scriptScene 非法被剥离 → 空 params，仍合法
  assert.deepEqual(r.manifest.nodes[1].params, {})
})

test('planToSkill：不足 2 节点 / 空白名称兜底', () => {
  const single: OrchestrationPlan = {
    title: 't',
    nodes: [{ kind: 'brief', params: { text: 'only' } }],
    edges: [],
  }
  const r = orchestrationPlanToSkillManifest(single, 'x')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.match(r.reason, /不足 2 个节点/)

  // 名称空白 → 兜底默认名（不拒转换）
  const r2 = orchestrationPlanToSkillManifest(DEMO_PLAN, '   ')
  assert.equal(r2.ok, true)
  if (r2.ok) assert.equal(r2.manifest.name, '对话创建的 Skill')
})

test('planToSkill：确定性——同输入两次转换 deepEqual', () => {
  const a = orchestrationPlanToSkillManifest(DEMO_PLAN, '确定性')
  const b = orchestrationPlanToSkillManifest(DEMO_PLAN, '确定性')
  assert.deepEqual(a, b)
})
