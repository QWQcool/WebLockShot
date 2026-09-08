import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CANVAS_DOC_KEY,
  CANVAS_EDGE_COMPAT,
  CANVAS_NODE_KINDS,
  WLS_ARROW_SHAPE_PREFIX,
  arrowShapeIdToEdgeId,
  arrowSnapshotsToEdges,
  canvasNodeToShapePartial,
  createEmptyCanvasDoc,
  createNodeId,
  edgeIdToArrowShapeId,
  edgeToArrowMaterial,
  nodeIdToShapeId,
  shapeIdToNodeId,
  shapeSnapshotToCanvasNode,
  validateCanvasDoc,
  validateEdgeKind,
  type CanvasDoc,
} from '../contract.ts'
import {
  loadCanvasDocFrom,
  saveCanvasDocTo,
  clearCanvasDocFrom,
} from '../canvasStore.ts'

/** 构造最小合法文档 */
function makeDoc(overrides: Partial<CanvasDoc> = {}): CanvasDoc {
  return {
    version: 1,
    id: 'canvas-test',
    name: '测试画布',
    nodes: [
      { id: 'n1', kind: 'brief', x: 0, y: 0, w: 260, h: 160, meta: {} },
      { id: 'n2', kind: 'edit', x: 300, y: 0, w: 260, h: 160, meta: {} },
    ],
    edges: [{ id: 'e1', from: 'n1', to: 'n2' }],
    updatedAt: 1000,
    ...overrides,
  }
}

/** 极简 Storage stub（node 环境无 window.localStorage） */
function makeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k)
    },
    setItem: (k, v) => {
      map.set(k, String(v))
    },
  }
}

test('validateCanvasDoc：合法文档原样通过', () => {
  const doc = makeDoc()
  const out = validateCanvasDoc(JSON.parse(JSON.stringify(doc)))
  assert.ok(out)
  assert.equal(out.nodes.length, 2)
  assert.equal(out.edges.length, 1)
})

test('validateCanvasDoc：非法 kind / 非法版本 / 缺字段整体拒绝', () => {
  assert.equal(validateCanvasDoc({ ...makeDoc(), version: 2 }), null)
  assert.equal(validateCanvasDoc({ ...makeDoc(), nodes: [{ ...makeDoc().nodes[0], kind: 'hacker' }] }), null)
  assert.equal(validateCanvasDoc({ ...makeDoc(), id: 'bad id!' }), null)
  assert.equal(validateCanvasDoc(null), null)
  assert.equal(validateCanvasDoc('nope'), null)
})

test('validateCanvasDoc：指向不存在节点的边被清洗', () => {
  const doc = makeDoc({ edges: [
    { id: 'e1', from: 'n1', to: 'n2' },
    { id: 'e2', from: 'n1', to: 'ghost' },
  ] })
  const out = validateCanvasDoc(doc)
  assert.ok(out)
  assert.equal(out.edges.length, 1)
  assert.equal(out.edges[0].id, 'e1')
})

test('id 映射：nodeId ↔ shapeId 双向无损', () => {
  const id = createNodeId()
  assert.match(id, /^n[a-z0-9]+$/)
  const shapeId = nodeIdToShapeId(id)
  assert.ok(shapeId.startsWith('shape:wls-'))
  assert.equal(shapeIdToNodeId(shapeId), id)
  assert.equal(shapeIdToNodeId('shape:abc'), null)
})

test('节点 → shape partial → 节点 序列化往返无损', () => {
  const node = makeDoc().nodes[1]
  const partial = canvasNodeToShapePartial(node)
  assert.equal(partial.id, nodeIdToShapeId('n2'))
  assert.equal(partial.type, 'wls-node')
  const back = shapeSnapshotToCanvasNode(partial)
  assert.ok(back)
  assert.deepEqual(
    { ...back, meta: {} },
    { ...node, meta: {} }
  )
})

test('shapeSnapshotToCanvasNode：非法 kind / 缺尺寸按规则拒绝或补默认', () => {
  const bad = shapeSnapshotToCanvasNode({
    id: nodeIdToShapeId('n1'),
    type: 'wls-node',
    x: 1,
    y: 2,
    props: { kind: 'nope' },
  })
  assert.equal(bad, null)

  const foreignShape = shapeSnapshotToCanvasNode({
    id: 'shape:xyz',
    type: 'geo',
    x: 1,
    y: 2,
    props: {},
  })
  assert.equal(foreignShape, null)

  const withDefaults = shapeSnapshotToCanvasNode({
    id: nodeIdToShapeId('n1'),
    type: 'wls-node',
    x: 5,
    y: 6,
    props: { kind: 'brief' },
  })
  assert.ok(withDefaults)
  assert.equal(withDefaults.w, 260)
  assert.equal(withDefaults.h, 160)
})

test('箭头绑定 → 边：自环与非法引用被过滤，重复边去重（去重代表取最小 arrowId，id 稳定）', () => {
  const toNode = (shapeId: string) =>
    shapeId === 'shape:wls-n1' ? 'n1' : shapeId === 'shape:wls-n2' ? 'n2' : null
  const edges = arrowSnapshotsToEdges(
    [
      { arrowId: 'arrow:a1', startShapeId: 'shape:wls-n1', endShapeId: 'shape:wls-n2' },
      { arrowId: 'arrow:a2', startShapeId: 'shape:wls-n1', endShapeId: 'shape:wls-n1' }, // 自环
      { arrowId: 'arrow:a3', startShapeId: 'shape:wls-n1', endShapeId: 'shape:ghost' }, // 非法引用
      { arrowId: 'arrow:a4', startShapeId: null, endShapeId: 'shape:wls-n2' }, // 缺端点
      { arrowId: 'arrow:a5', startShapeId: 'shape:wls-n1', endShapeId: 'shape:wls-n2' }, // 重复
    ],
    toNode
  )
  assert.equal(edges.length, 1)
  assert.deepEqual(edges[0], { id: 'ea1', from: 'n1', to: 'n2' })
})

test('边 id 稳定性：同一箭头多次提取 id 相同', () => {
  const toNode = (shapeId: string) =>
    shapeId === 'shape:wls-n1' ? 'n1' : shapeId === 'shape:wls-n2' ? 'n2' : null
  const arrows = [
    { arrowId: 'shape:AbC123xyz', startShapeId: 'shape:wls-n1', endShapeId: 'shape:wls-n2' },
  ]
  const first = arrowSnapshotsToEdges(arrows, toNode)
  const second = arrowSnapshotsToEdges(arrows, toNode)
  assert.equal(first.length, 1)
  assert.deepEqual(first, second)
  // id 由箭头 id 直接映射（清洗非法字符），不随内容/顺序漂移，且满足 nodeIdSchema
  assert.equal(first[0].id, 'eshapeAbC123xyz')
  assert.match(first[0].id, /^[A-Za-z0-9_-]+$/)
})

test('边 id 稳定性：同向多箭头去重结果与遍历顺序无关（取最小 arrowId 为代表）', () => {
  const toNode = (shapeId: string) =>
    shapeId === 'shape:wls-n1' ? 'n1' : shapeId === 'shape:wls-n2' ? 'n2' : null
  const mk = (id: string) => ({
    arrowId: id,
    startShapeId: 'shape:wls-n1',
    endShapeId: 'shape:wls-n2',
  })
  const forward = arrowSnapshotsToEdges([mk('arrow:bb'), mk('arrow:aa'), mk('arrow:cc')], toNode)
  const backward = arrowSnapshotsToEdges([mk('arrow:cc'), mk('arrow:bb'), mk('arrow:aa')], toNode)
  assert.deepEqual(forward, backward)
  assert.equal(forward.length, 1)
  assert.equal(forward[0].id, 'eaa')
})

test('边类型兼容契约：兼容表覆盖全部 9 类节点且每类合法下游不重复', () => {
  assert.equal(CANVAS_EDGE_COMPAT.brief.length, 3)
  for (const kind of CANVAS_NODE_KINDS) {
    assert.ok(Array.isArray(CANVAS_EDGE_COMPAT[kind]), `缺少 ${kind} 的兼容表`)
    assert.equal(new Set(CANVAS_EDGE_COMPAT[kind]).size, CANVAS_EDGE_COMPAT[kind].length)
    // 合法下游不包含自身（自环一律拒绝，另有专门用例）
    assert.ok(!CANVAS_EDGE_COMPAT[kind].includes(kind as never))
  }
  assert.equal(CANVAS_EDGE_COMPAT.deliver.length, 0) // deliver 是终点
})

test('validateEdgeKind：合法连线全部通过', () => {
  const legal: [string, string][] = [
    ['brief', 'product'],
    ['brief', 'script'],
    ['brief', 'image'],
    ['product', 'script'],
    ['product', 'image'],
    ['script', 'storyboard'],
    ['storyboard', 'generate'],
    ['image', 'edit'],
    ['image', 'deliver'],
    ['edit', 'deliver'],
    ['generate', 'deliver'],
    ['stage3d', 'storyboard'],
    ['stage3d', 'generate'],
  ]
  for (const [from, to] of legal) {
    const out = validateEdgeKind(from as never, to as never)
    assert.deepEqual(out, { ok: true }, `${from}→${to} 应合法`)
  }
  // 兼容表与 validateEdgeKind 一致：表内每条都能通过
  for (const from of CANVAS_NODE_KINDS) {
    for (const to of CANVAS_EDGE_COMPAT[from]) {
      assert.deepEqual(validateEdgeKind(from, to), { ok: true })
    }
  }
})

test('validateEdgeKind：非法连线 / 自环 / 终点回流被拒且 reason 为非空中文', () => {
  const illegal: [string, string][] = [
    ['storyboard', 'product'], // 典型回连
    ['product', 'generate'],
    ['brief', 'deliver'],
    ['script', 'deliver'],
    ['generate', 'script'],
    ['image', 'script'],
    ['product', 'storyboard'],
  ]
  for (const [from, to] of illegal) {
    const out = validateEdgeKind(from as never, to as never)
    assert.equal(out.ok, false, `${from}→${to} 应拒绝`)
    if (!out.ok) {
      assert.ok(out.reason.length > 0)
      assert.ok(/[\u4e00-\u9fa5]/.test(out.reason), `reason 应为中文：${out.reason}`)
    }
  }

  // 自环：同一类节点互连一律拒绝
  for (const kind of CANVAS_NODE_KINDS) {
    const out = validateEdgeKind(kind, kind)
    assert.equal(out.ok, false, `${kind}→${kind} 自环应拒绝`)
    if (!out.ok) assert.ok(out.reason.includes('自身'))
  }

  // deliver 为终点：流向任何非自身节点都拒绝且 reason 指明终点语义
  const deliverOut = validateEdgeKind('deliver', 'script')
  assert.equal(deliverOut.ok, false)
  if (!deliverOut.ok) assert.ok(deliverOut.reason.includes('终点'))

  // 合法时不含 reason 字段
  const okOut = validateEdgeKind('brief', 'script')
  assert.ok(okOut.ok)
})

test('物化映射：edgeId ↔ 箭头 shape id 确定性互逆（跨刷新稳定）', () => {
  assert.equal(edgeIdToArrowShapeId('ea1'), 'shape:earrow-ea1')
  assert.equal(WLS_ARROW_SHAPE_PREFIX, 'shape:earrow-')
  assert.equal(arrowShapeIdToEdgeId('shape:earrow-ea1'), 'ea1')
  assert.equal(arrowShapeIdToEdgeId('shape:earrow-eshapeKq8fX2'), 'eshapeKq8fX2')
  // 用户手绘箭头 id 不是物化 id
  assert.equal(arrowShapeIdToEdgeId('shape:AbC123xyz'), null)
})

test('跨刷新稳定：手绘箭头提取边 → 物化重建箭头 → 再提取，边 id 完全一致', () => {
  const toNode = (shapeId: string) =>
    shapeId === 'shape:wls-n1' ? 'n1' : shapeId === 'shape:wls-n2' ? 'n2' : null
  // 第一次保存：用户手绘箭头（tldraw 随机 id）提取为边
  const first = arrowSnapshotsToEdges(
    [{ arrowId: 'shape:Kq8fX2', startShapeId: 'shape:wls-n1', endShapeId: 'shape:wls-n2' }],
    toNode
  )
  assert.equal(first.length, 1)
  assert.equal(first[0].id, 'eshapeKq8fX2')
  // 刷新恢复：按边物化箭头（确定性 id），再序列化提取
  const restored = first.map((e) => ({
    arrowId: edgeIdToArrowShapeId(e.id),
    startShapeId: nodeIdToShapeId(e.from),
    endShapeId: nodeIdToShapeId(e.to),
  }))
  const second = arrowSnapshotsToEdges(restored, toNode)
  assert.deepEqual(second, first)
  // 再刷新一次仍稳定
  const restored2 = second.map((e) => ({
    arrowId: edgeIdToArrowShapeId(e.id),
    startShapeId: nodeIdToShapeId(e.from),
    endShapeId: nodeIdToShapeId(e.to),
  }))
  assert.deepEqual(arrowSnapshotsToEdges(restored2, toNode), first)
})

test('edgeToArrowMaterial：几何与绑定参数正确且确定性（含中心重合兜底 / 自环拒绝）', () => {
  const from = { id: 'n1', x: 0, y: 0, w: 260, h: 160 }
  const to = { id: 'n2', x: 300, y: 100, w: 260, h: 160 }
  const edge = { id: 'ea1', from: 'n1', to: 'n2' }
  const m = edgeToArrowMaterial(edge, from, to)
  assert.ok(m)
  assert.equal(m.arrowShapeId, 'shape:earrow-ea1')
  assert.equal(m.x, 130) // from 中心
  assert.equal(m.y, 80)
  assert.deepEqual(m.start, { x: 0, y: 0 })
  assert.deepEqual(m.end, { x: 300, y: 100 }) // to 中心 - from 中心
  assert.deepEqual(m.bindings, [
    { toShapeId: 'shape:wls-n1', terminal: 'start' },
    { toShapeId: 'shape:wls-n2', terminal: 'end' },
  ])
  // 确定性：同输入同输出
  assert.deepEqual(edgeToArrowMaterial(edge, from, to), m)

  // 中心重合兜底：给最小可见向量，不产生零长箭头
  const stacked = edgeToArrowMaterial(edge, from, { ...to, x: 0, y: 0 })
  assert.ok(stacked)
  assert.deepEqual(stacked.end, { x: 0, y: 1 })

  // 自环拒绝
  assert.equal(edgeToArrowMaterial({ id: 'e1', from: 'n1', to: 'n1' }, from, from), null)
})

test('画布存储：保存→读取往返，脏数据被拒', () => {
  const storage = makeStorage()
  const doc = makeDoc()
  assert.equal(saveCanvasDocTo(storage, doc), true)

  const raw = JSON.parse(storage.getItem(CANVAS_DOC_KEY) as string) as CanvasDoc
  assert.ok(raw.updatedAt >= doc.updatedAt)

  const loaded = loadCanvasDocFrom(storage)
  assert.ok(loaded)
  assert.equal(loaded.id, doc.id)
  assert.equal(loaded.nodes.length, 2)

  // 不合法文档拒绝写入且不破坏旧数据
  assert.equal(saveCanvasDocTo(storage, { ...doc, version: 9 } as unknown as CanvasDoc), false)
  assert.equal(loadCanvasDocFrom(storage)?.id, doc.id)

  // 损坏 JSON 按空处理不抛错
  storage.setItem(CANVAS_DOC_KEY, '{broken')
  assert.equal(loadCanvasDocFrom(storage), null)
})

test('画布存储：null Storage 优雅降级（保存 false / 读取 null）', () => {
  assert.equal(saveCanvasDocTo(null, makeDoc()), false)
  assert.equal(loadCanvasDocFrom(null), null)
  assert.doesNotThrow(() => clearCanvasDocFrom(null))
})

test('画布存储：clear 后读取为空', () => {
  const storage = makeStorage()
  saveCanvasDocTo(storage, makeDoc())
  clearCanvasDocFrom(storage)
  assert.equal(loadCanvasDocFrom(storage), null)
})

test('createEmptyCanvasDoc：id/version/时间戳合法且可被校验', () => {
  const doc = createEmptyCanvasDoc()
  assert.equal(doc.version, 1)
  assert.equal(doc.nodes.length, 0)
  assert.ok(validateCanvasDoc(doc))
})
