import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGE3D_OBJECT_MAX,
  STAGE3D_PALETTE,
  createDefaultCharacterPayload,
  createEmptyStage3DPayload,
  createPrimitivePayload,
  readStage3DMetaPayload,
  writeStage3DMetaPayload,
  type Stage3DMetaPayload,
} from '../stage3dMeta.ts'

const validPayload: Stage3DMetaPayload = {
  objects: [
    {
      id: 's3o_a',
      type: 'character',
      name: '素体角色',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: STAGE3D_PALETTE[0],
    },
    {
      id: 's3o_b',
      type: 'box',
      name: '方块',
      position: [1.5, 0.5, 0],
      rotation: [0, 0.5, 0],
      scale: [1, 1, 1],
      color: STAGE3D_PALETTE[4],
    },
  ],
  cameras: [
    {
      id: 's3c_a',
      name: '机位 1',
      position: [4, 2, 6],
      target: [0, 1, 0],
      fov: 45,
    },
  ],
  env: {},
}

test('stage3d 契约：合法 payload 读校验通过，空场景默认值', () => {
  const check = readStage3DMetaPayload(validPayload)
  assert.equal(check.ok, true)
  const empty = createEmptyStage3DPayload()
  assert.deepEqual(readStage3DMetaPayload(empty), { ok: true, payload: empty })
})

test('stage3d 契约：meta 缺失 / 非对象 / 字段非法 → 整体拒绝（不半渲染）', () => {
  assert.equal(readStage3DMetaPayload(null).ok, false)
  assert.equal(readStage3DMetaPayload('x').ok, false)
  const bad = { ...validPayload, objects: [{ ...validPayload.objects[0], position: [0, 'y'] }] }
  const check = readStage3DMetaPayload(bad)
  assert.equal(check.ok, false)
  if (!check.ok) assert.match(check.reason, /不合法/)
})

test('stage3d 契约：color 白名单（8 色板外拒绝）+ id 重复拒绝', () => {
  const badColor = {
    ...validPayload,
    objects: [{ ...validPayload.objects[0], color: '#ff0000' }],
  }
  const c1 = readStage3DMetaPayload(badColor)
  assert.equal(c1.ok, false)
  if (!c1.ok) assert.match(c1.reason, /8 色板白名单/)

  const dup = { ...validPayload, objects: [validPayload.objects[0], validPayload.objects[0]] }
  const c2 = readStage3DMetaPayload(dup)
  assert.equal(c2.ok, false)
  if (!c2.ok) assert.match(c2.reason, /id 重复/)

  const dupCam = {
    ...validPayload,
    cameras: [validPayload.cameras[0], validPayload.cameras[0]],
  }
  assert.equal(readStage3DMetaPayload(dupCam).ok, false)
})

test('stage3d 契约：modelRef 只允许 idbref（blob: 拒绝）', () => {
  const blob = {
    ...validPayload,
    objects: [{ ...validPayload.objects[0], modelRef: 'blob:http://x/y' }],
  }
  assert.equal(readStage3DMetaPayload(blob).ok, false)
  const idb = {
    ...validPayload,
    objects: [{ ...validPayload.objects[0], modelRef: 'idbref://abc' }],
  }
  assert.equal(readStage3DMetaPayload(idb).ok, true)
})

test('stage3d 契约：对象数上限 50（51 拒绝）', () => {
  const many: Stage3DMetaPayload = {
    objects: Array.from({ length: STAGE3D_OBJECT_MAX + 1 }, (_, i) => ({
      id: `s3o_${i}`,
      type: 'box' as const,
      name: `方块${i}`,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      color: STAGE3D_PALETTE[4],
    })),
    cameras: [],
    env: {},
  }
  assert.equal(readStage3DMetaPayload(many).ok, false)
})

test('stage3d 契约：writeStage3DMetaPayload 保留其余 meta 键 + 非法拒写', () => {
  const written = writeStage3DMetaPayload({ orchestrated: 'demo' }, validPayload)
  assert.ok(written)
  assert.equal(written['orchestrated'], 'demo')
  assert.ok(written['stage3d'])

  const bad = writeStage3DMetaPayload({}, { ...validPayload, cameras: [] , env: { panoramaRef: 'blob:x' } })
  assert.equal(bad, null)
})

test('stage3d 契约：默认对象工厂（素体 + 几何体）', () => {
  const character = createDefaultCharacterPayload()
  assert.equal(character.type, 'character')
  assert.equal(character.color, STAGE3D_PALETTE[0])
  assert.deepEqual(character.scale, [1, 1, 1])

  const box = createPrimitivePayload('box', '', [2, 0, 1])
  assert.equal(box.type, 'box')
  assert.equal(box.name, '方块')
  assert.deepEqual(box.position, [2, 0, 1])
  assert.equal(readStage3DMetaPayload({ ...validPayload, objects: [character, box] }).ok, true)
})
