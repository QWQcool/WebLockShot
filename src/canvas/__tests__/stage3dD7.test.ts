import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGE3D_OBJECT_MAX,
  STAGE3D_PALETTE,
  createDefaultCharacterPayload,
  readStage3DMetaPayload,
  type Stage3DObject,
} from '../stage3dMeta.ts'
import {
  STAGE3D_SCENE_PRESETS,
  STAGE3D_SCENE_PRESET_IDS,
  applyScenePreset,
  materializeSceneSpecs,
  scenePresetById,
} from '../stage3dScenes.ts'
import {
  STAGE3D_ANIM_IDS,
  STAGE3D_ANIM_PRESETS,
  animClipFor,
  animLabelFor,
  availableAnimPresets,
  isStage3DAnimId,
} from '../stage3dAnim.ts'

/* ---------------- D7-① 场景预设 ---------------- */

test('STAGE3D_SCENE_PRESETS：六套场景 + id/label/specs 齐备', () => {
  assert.equal(STAGE3D_SCENE_PRESETS.length, 6)
  assert.deepEqual(
    STAGE3D_SCENE_PRESETS.map((p) => p.id),
    [...STAGE3D_SCENE_PRESET_IDS]
  )
  const labels = STAGE3D_SCENE_PRESETS.map((p) => p.label)
  assert.deepEqual(labels, ['商品台', '影棚', '客厅', '卧室', '户外台阶', '展台'])
  assert.equal(new Set(labels).size, 6, '标签不重复')
  for (const p of STAGE3D_SCENE_PRESETS) {
    assert.ok(p.hint.length > 0)
    assert.ok(p.specs.length >= 3 && p.specs.length <= 12, `${p.id} 布景规模合理`)
    for (const s of p.specs) {
      assert.ok(['box', 'cylinder', 'sphere'].includes(s.kind), '只用 primitive（零外部资产）')
      assert.ok((STAGE3D_PALETTE as readonly string[]).includes(s.color), `${s.name} 颜色须在 8 色板内`)
      assert.equal(s.position.length, 3)
    }
  }
})

test('materializeSceneSpecs：规格 → 合法 Stage3DObject（可入 meta 契约）', () => {
  for (const p of STAGE3D_SCENE_PRESETS) {
    const objects = materializeSceneSpecs(p.specs)
    assert.equal(objects.length, p.specs.length)
    assert.equal(new Set(objects.map((o) => o.id)).size, objects.length, 'id 不重复')
    const check = readStage3DMetaPayload({ objects, cameras: [], env: { scenePreset: p.id } })
    assert.equal(check.ok, true, `${p.id} 生成对象应通过契约校验`)
  }
})

test('applyScenePreset：替换几何体、保留角色；写 scenePreset；超限整体拒绝', () => {
  const character = createDefaultCharacterPayload('主角')
  const staleBox: Stage3DObject = {
    id: 's3o_stale',
    type: 'box',
    name: '旧方块',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: STAGE3D_PALETTE[4],
  }
  const r = applyScenePreset([character, staleBox], 'living-room')
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.objects.filter((o) => o.type === 'character').length, 1, '角色保留')
  assert.equal(r.objects.some((o) => o.id === 's3o_stale'), false, '旧几何体被替换')
  assert.equal(r.objects.length, 1 + r.added)

  // 上限：角色 50 个 + 任意场景必然超限 → 整体拒绝（不半渲染）
  const many = Array.from({ length: STAGE3D_OBJECT_MAX }, (_, i) => ({
    ...createDefaultCharacterPayload(`角色${i}`),
    id: `s3o_many_${i}`,
  }))
  const over = applyScenePreset(many, 'studio')
  assert.equal(over.ok, false)
  if (!over.ok) assert.match(over.reason, /上限/)

  // 未知预设拒绝
  const bad = applyScenePreset([], 'not-a-scene' as never)
  assert.equal(bad.ok, false)
})

test('scenePresetById：命中返回定义、未知返回 null', () => {
  assert.equal(scenePresetById('bedroom')?.label, '卧室')
  assert.equal(scenePresetById('nope'), null)
  assert.equal(scenePresetById(undefined), null)
})

/* ---------------- D7-② 动作预设 ---------------- */

test('STAGE3D_ANIM_PRESETS：8 个预设 + 片段名与内置模型实测清单一致', () => {
  assert.equal(STAGE3D_ANIM_PRESETS.length, 8)
  assert.deepEqual(
    STAGE3D_ANIM_PRESETS.map((a) => a.id),
    [...STAGE3D_ANIM_IDS]
  )
  const clips = STAGE3D_ANIM_PRESETS.map((a) => a.clip)
  assert.deepEqual(clips, [
    'Rig|Idle_Loop',
    'Rig|Walk_Loop',
    'Rig|Jog_Fwd_Loop',
    'Rig|Sprint_Loop',
    'Rig|Dance_Loop',
    'Rig|Sitting_Idle_Loop',
    'Rig|Jump_Loop',
    'Rig|Idle_Talking_Loop',
  ])
  assert.equal(new Set(clips).size, 8, '片段不重复')
  for (const a of STAGE3D_ANIM_PRESETS) {
    assert.ok(a.label.length > 0)
    assert.ok(a.hint.length > 0)
  }
})

test('animClipFor / animLabelFor / isStage3DAnimId：白名单口径', () => {
  assert.equal(animClipFor('walk'), 'Rig|Walk_Loop')
  assert.equal(animClipFor('nope'), null)
  assert.equal(animClipFor(undefined), null)
  assert.equal(animClipFor(null), null)
  assert.equal(animLabelFor('walk'), '走路循环')
  assert.equal(animLabelFor('nope'), 'nope')
  assert.equal(isStage3DAnimId('walk'), true)
  assert.equal(isStage3DAnimId('wave'), false)
  assert.equal(isStage3DAnimId(123), false)
})

test('availableAnimPresets：按模型实际片段过滤（自定义模型无片段 → 空，UI 如实禁用）', () => {
  const all = STAGE3D_ANIM_PRESETS.map((a) => a.clip)
  assert.equal(availableAnimPresets(all).length, 8)
  assert.deepEqual(availableAnimPresets(['Rig|Idle_Loop', 'Rig|Walk_Loop']).map((a) => a.id), [
    'idle',
    'walk',
  ])
  assert.deepEqual(availableAnimPresets([]), [])
})

/* ---------------- 契约扩展（D7 新增可选字段，向后兼容） ---------------- */

test('契约：对象 anim 白名单 + env.scenePreset 可选；非法 anim 整体拒绝', () => {
  const base = createDefaultCharacterPayload('主角')
  const okAnim = readStage3DMetaPayload({
    objects: [{ ...base, anim: 'walk' }],
    cameras: [],
    env: { scenePreset: 'studio' },
  })
  assert.equal(okAnim.ok, true)
  if (okAnim.ok) {
    assert.equal(okAnim.payload.objects[0].anim, 'walk')
    assert.equal(okAnim.payload.env.scenePreset, 'studio')
  }

  const badAnim = readStage3DMetaPayload({
    objects: [{ ...base, anim: 'wave' }],
    cameras: [],
    env: {},
  })
  assert.equal(badAnim.ok, false)

  // 老文档（无 anim / 无 scenePreset）仍合法（向后兼容）
  const legacy = readStage3DMetaPayload({ objects: [base], cameras: [], env: {} })
  assert.equal(legacy.ok, true)
  if (legacy.ok) {
    assert.equal(legacy.payload.objects[0].anim, undefined)
    assert.equal(legacy.payload.env.scenePreset, undefined)
  }
})
