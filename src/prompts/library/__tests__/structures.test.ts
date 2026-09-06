import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STRUCTURE_TEMPLATES,
  StructureTemplateSchema,
} from '../structures.ts'

test('爆款结构库：至少包含 5 个预置套路模板', () => {
  assert.ok(STRUCTURE_TEMPLATES.length >= 5, '模板数量必须不少于 5 套')
})

test('爆款结构库：每个模板均通过 zod 校验且长度为 6 镜', () => {
  for (const tpl of STRUCTURE_TEMPLATES) {
    const parsed = StructureTemplateSchema.parse(tpl)
    assert.equal(parsed.beatSkeleton.length, 6, `${tpl.name} 的 beat 骨架必须恰好 6 拍`)
  }
})

test('带货结构硬约束：第 1 镜必须是 hook，第 6 镜必须是 cta', () => {
  for (const tpl of STRUCTURE_TEMPLATES) {
    const firstBeat = tpl.beatSkeleton[0]
    const lastBeat = tpl.beatSkeleton[5]

    assert.equal(
      firstBeat.role,
      'hook',
      `模板 [${tpl.name}] 的第一镜角色必须为 hook（实际: ${firstBeat.role}）`
    )
    assert.equal(
      lastBeat.role,
      'cta',
      `模板 [${tpl.name}] 的第六镜角色必须为 cta（实际: ${lastBeat.role}）`
    )
  }
})

test('钩子样例库：每个模板至少包含 3 条钩子种子', () => {
  for (const tpl of STRUCTURE_TEMPLATES) {
    assert.ok(
      tpl.hookSamples.length >= 3,
      `模板 [${tpl.name}] 钩子样例少于 3 条`
    )
  }
})
