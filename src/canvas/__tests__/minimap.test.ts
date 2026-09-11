import test from 'node:test'
import assert from 'node:assert/strict'
import {
  boundsOfRects,
  buildMiniMapModel,
  computeTransform,
  miniToWorld,
  padBounds,
  rectToMini,
  unionBounds,
  worldToMini,
} from '../minimap.ts'

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

test('boundsOfRects：多矩形包围盒；空数组 null', () => {
  assert.equal(boundsOfRects([]), null)
  const b = boundsOfRects([
    { x: 0, y: 0, w: 100, h: 50 },
    { x: 200, y: -20, w: 40, h: 200 },
  ])
  assert.deepEqual(b, { minX: 0, minY: -20, maxX: 240, maxY: 180 })
})

test('unionBounds / padBounds：并集与留白', () => {
  const u = unionBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: -5, minY: 2, maxX: 3, maxY: 20 })
  assert.deepEqual(u, { minX: -5, minY: 0, maxX: 10, maxY: 20 })
  assert.deepEqual(padBounds(u, 5), { minX: -10, minY: -5, maxX: 15, maxY: 25 })
})

test('computeTransform：等比缩放适配 + 居中；scale 上限 1（不放大）', () => {
  const wide = computeTransform({ minX: 0, minY: 0, maxX: 1000, maxY: 100 }, 180, 120, 8)
  assert.ok(near(wide.scale, 164 / 1000), '按宽度受限')
  assert.ok(near(wide.offsetX, 8), '水平居中且刚好留 padding')
  assert.ok(wide.offsetY > 8, '垂直方向居中（留白更多）')

  const tiny = computeTransform({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 180, 120, 8)
  assert.equal(tiny.scale, 1, '内容很小时不放大（scale 上限 1）')
})

test('worldToMini / miniToWorld：往返一致', () => {
  const t = computeTransform({ minX: -100, minY: -50, maxX: 300, maxY: 150 }, 200, 140, 10)
  const p = worldToMini(120, 60, t)
  const back = miniToWorld(p.x, p.y, t)
  assert.ok(near(back.x, 120, 1e-9))
  assert.ok(near(back.y, 60, 1e-9))

  // 包围盒左上角 → transform 的 offset 位置
  const origin = worldToMini(-100, -50, t)
  assert.ok(near(origin.x, t.offsetX))
  assert.ok(near(origin.y, t.offsetY))
})

test('rectToMini：世界矩形映射；极小矩形有最小可见尺寸', () => {
  const t = computeTransform({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, 200, 200, 0)
  const r = rectToMini({ x: 0, y: 0, w: 1000, h: 1000 }, t)
  assert.ok(near(r.x, 0) && near(r.y, 0))
  assert.ok(near(r.w, 200) && near(r.h, 200))

  const tiny = rectToMini({ x: 0, y: 0, w: 0.01, h: 0.01 }, t)
  assert.ok(tiny.w >= 2 && tiny.h >= 2, '极小矩形仍有 2px 可见尺寸')
})

test('buildMiniMapModel：内容为空时用视口当内容（小地图仍有意义）', () => {
  const empty = buildMiniMapModel([], { x: 0, y: 0, w: 800, h: 600 }, 180, 120, 8)
  assert.equal(empty.shapes.length, 0)
  assert.ok(empty.viewport.w > 0 && empty.viewport.h > 0)

  const withShapes = buildMiniMapModel(
    [
      { x: 0, y: 0, w: 200, h: 100 },
      { x: 600, y: 300, w: 200, h: 100 },
    ],
    { x: 100, y: 50, w: 400, h: 300 },
    180,
    120,
    8
  )
  assert.equal(withShapes.shapes.length, 2)
  // 内容 + 视口都在小地图内（含 padding 容差）
  for (const r of [...withShapes.shapes, withShapes.viewport]) {
    assert.ok(r.x >= -0.001 && r.y >= -0.001, '不越左/上边界')
    assert.ok(r.x + r.w <= 180.001 && r.y + r.h <= 120.001, '不越右/下边界')
  }
  // 视口框通常大于单个节点矩形（本例视口 400×300 vs 节点 200×100）
  assert.ok(withShapes.viewport.w > withShapes.shapes[0].w)
})
