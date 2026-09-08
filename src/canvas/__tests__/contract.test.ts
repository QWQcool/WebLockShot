import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CANVAS_DOC_KEY,
  CANVAS_EDGE_COMPAT,
  CANVAS_NODE_KINDS,
  SCRIPT_SCENE_LABEL,
  SCRIPT_SCENE_TEMPLATE_ID,
  WLS_ARROW_SHAPE_PREFIX,
  arrowShapeIdToEdgeId,
  arrowSnapshotsToEdges,
  briefTextToWriterInput,
  canvasNodeToShapePartial,
  createEmptyCanvasDoc,
  createNodeId,
  edgeIdToArrowShapeId,
  edgeToArrowMaterial,
  nodeIdToShapeId,
  readScriptMetaPayload,
  readStoryboardMetaPayload,
  scriptDigest,
  scriptSceneOf,
  shapeIdToNodeId,
  shapeSnapshotToCanvasNode,
  validateCanvasDoc,
  validateEdgeKind,
  writeScriptMetaPayload,
  writeStoryboardMetaPayload,
  type CanvasDoc,
} from '../contract.ts'
import { scriptToStory } from '../../director/nodes/storyboardNode.ts'
import { STRUCTURE_TEMPLATES } from '../../prompts/library/structures.ts'
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

/* ---------------- B2：script 节点契约 ---------------- */

/** 构造合法的脚本生成 meta 载荷 */
function makeScriptPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scriptScene: 'ecommerce',
    script: {
      logline: '测试脚本 logline',
      templateId: 't1_pain_opening',
      beats: [
        { order: 1, role: 'hook', goal: 'g', action: 'a', audio: { kind: 'vo', speaker: '主播', text: 't1' } },
        { order: 2, role: 'pain', goal: 'g', action: 'a' },
        { order: 3, role: 'reveal', goal: 'g', action: 'a' },
        { order: 4, role: 'demo', goal: 'g', action: 'a' },
        { order: 5, role: 'proof', goal: 'g', action: 'a' },
        { order: 6, role: 'cta', goal: 'g', action: 'a' },
      ],
      ctaLine: 'cta',
      lengthTargetSec: 18,
    },
    critic: {
      score: 92,
      passed: true,
      summary: 'summary',
      strengths: ['s1'],
      suggestions: ['sug1'],
    },
    demo: true,
    upstreamText: '手表，续航长，防水',
    ...overrides,
  }
}

test('B2 契约：脚本场景路由表覆盖结构库既有模板 id', () => {
  const ids = new Set(STRUCTURE_TEMPLATES.map((t) => t.id))
  for (const scene of Object.keys(SCRIPT_SCENE_TEMPLATE_ID) as (keyof typeof SCRIPT_SCENE_TEMPLATE_ID)[]) {
    assert.ok(ids.has(SCRIPT_SCENE_TEMPLATE_ID[scene]), `${scene} 路由的模板必须存在于结构库`)
  }
  assert.equal(Object.keys(SCRIPT_SCENE_LABEL).length, 3)
  assert.equal(SCRIPT_SCENE_LABEL.ecommerce, '带货短视频')
  assert.equal(SCRIPT_SCENE_LABEL.drama, '剧情短剧')
  assert.equal(SCRIPT_SCENE_LABEL.brand, '品牌叙事')
})

test('B2 readScriptMetaPayload：合法载荷通过（含 demo 标记），非法载荷拒绝', () => {
  const ok = readScriptMetaPayload(makeScriptPayload())
  assert.ok(ok)
  assert.equal(ok.demo, true)
  assert.equal(ok.script.beats.length, 6)
  assert.equal(ok.critic.score, 92)
  assert.equal(ok.scriptScene, 'ecommerce')

  // 非法：缺 critic / demo 非布尔 / scene 非法 / beats 数量不对
  const missingCritic = { ...makeScriptPayload() } as Record<string, unknown>
  delete missingCritic.critic
  assert.equal(readScriptMetaPayload(missingCritic), null)
  assert.equal(readScriptMetaPayload(makeScriptPayload({ demo: 'yes' })), null)
  assert.equal(readScriptMetaPayload(makeScriptPayload({ scriptScene: 'hacker' })), null)
  assert.equal(readScriptMetaPayload(null), null)
  assert.equal(readScriptMetaPayload('x'), null)
  const badBeats = makeScriptPayload()
  ;(badBeats.script as { beats: unknown[] }).beats = []
  assert.equal(readScriptMetaPayload(badBeats), null)
})

test('B2 writeScriptMetaPayload：校验通过合并保留 base 键，校验失败拒写（不半渲染）', () => {
  const base = { text: '上游 brief', custom: 1 }
  const merged = writeScriptMetaPayload(base, makeScriptPayload() as never)
  assert.ok(merged)
  assert.equal(merged.text, '上游 brief')
  assert.equal(merged.custom, 1)
  assert.equal(merged.demo, true)
  // 回读一致（写入即合法）
  assert.ok(readScriptMetaPayload(merged))

  const bad = makeScriptPayload({ upstreamText: 123 })
  assert.equal(writeScriptMetaPayload(base, bad as never), null)
})

test('B2 scriptSceneOf：缺省与非法值回退 ecommerce', () => {
  assert.equal(scriptSceneOf({}), 'ecommerce')
  assert.equal(scriptSceneOf({ scriptScene: 'drama' }), 'drama')
  assert.equal(scriptSceneOf({ scriptScene: 'nope' }), 'ecommerce')
  assert.equal(scriptSceneOf(null), 'ecommerce')
  assert.equal(scriptSceneOf('x'), 'ecommerce')
})

test('B2 briefTextToWriterInput：首段标题 + 后续卖点拆分；空文本返回空输入', () => {
  const out = briefTextToWriterInput('钛合金机械手表\n超长续航；防水一百米，蓝宝石镜面')
  assert.equal(out.productTitle, '钛合金机械手表')
  assert.deepEqual(out.sellingPoints, ['超长续航', '防水一百米', '蓝宝石镜面'])

  // 无独立段落：从标题内拆逗号短语
  const single = briefTextToWriterInput('便携榨汁杯，一秒出汁，食品级材质')
  assert.equal(single.productTitle, '便携榨汁杯，一秒出汁，食品级材质')
  assert.deepEqual(single.sellingPoints, ['便携榨汁杯', '一秒出汁', '食品级材质'])

  // 空文本
  assert.deepEqual(briefTextToWriterInput('   '), { productTitle: '', sellingPoints: [] })
})

/* ---------------- B3：storyboard 节点契约 ---------------- */

test('B3 契约：scriptToStory 现成转换产物可通过 storyboard meta 校验（复用兼容性）', () => {
  // 用 B2 的合法 script 载荷走现成转换函数（不新写转换逻辑）
  const scriptPayload = readScriptMetaPayload(makeScriptPayload())
  assert.ok(scriptPayload)
  const story = scriptToStory(scriptPayload.script, '钛合金机械手表')
  assert.equal(story.shots.length, 6)
  assert.equal(story.shots[0].order, 1)
  assert.equal(story.shots[5].order, 6)
  assert.equal(story.shots[0].motionId, 'push_in')

  const payload = {
    story,
    scriptDigest: scriptDigest(scriptPayload.script),
    scriptLogline: scriptPayload.script.logline,
  }
  const merged = writeStoryboardMetaPayload({ text: 'x' }, payload)
  assert.ok(merged)
  assert.equal(merged.text, 'x')
  const back = readStoryboardMetaPayload(merged)
  assert.ok(back)
  assert.equal(back.story.id, story.id)
  assert.equal(back.story.shots.length, 6)
  assert.equal(back.scriptDigest, payload.scriptDigest)
})

test('B3 readStoryboardMetaPayload：shots≠6 / 非法运镜 / 非法景别 / 缺字段拒绝', () => {
  const scriptPayload = readScriptMetaPayload(makeScriptPayload())
  assert.ok(scriptPayload)
  const base = {
    story: scriptToStory(scriptPayload.script, 'x'),
    scriptDigest: 'abc',
    scriptLogline: 'logline',
  }

  // shots 数量不符
  const badCount = {
    ...base,
    story: { ...base.story, shots: base.story.shots.slice(0, 5) },
  }
  assert.equal(readStoryboardMetaPayload(badCount), null)

  // 非法 motionId
  const badMotion = structuredClone(base) as {
    story: { shots: { motionId: string }[] }
  }
  badMotion.story.shots[0].motionId = 'fly_to_moon'
  assert.equal(readStoryboardMetaPayload(badMotion), null)

  // 非法 shotSize
  const badSize = structuredClone(base) as {
    story: { shots: { shotSize: string }[] }
  }
  badSize.story.shots[1].shotSize = 'xxl'
  assert.equal(readStoryboardMetaPayload(badSize), null)

  // durationSec 超范围
  const badDur = structuredClone(base)
  badDur.story.shots[2].durationSec = 9
  assert.equal(readStoryboardMetaPayload(badDur), null)

  // 非法输入
  assert.equal(readStoryboardMetaPayload(null), null)
  assert.equal(readStoryboardMetaPayload(42), null)
})

test('B3 writeStoryboardMetaPayload：校验失败拒写（不半渲染）', () => {
  const bad = { story: { id: 'x' }, scriptDigest: 'a', scriptLogline: 'l' }
  assert.equal(writeStoryboardMetaPayload({}, bad as never), null)
})

test('B3 scriptDigest：确定性 + 上游脚本变化即指纹变化', () => {
  const a = readScriptMetaPayload(makeScriptPayload())
  assert.ok(a)
  const b = { ...a.script, ctaLine: '不同的话术收尾' }
  const da = scriptDigest(a.script)
  assert.equal(da, scriptDigest(a.script)) // 确定性
  assert.notEqual(da, scriptDigest(b)) // 脚本内容不同 → 指纹不同
  assert.notEqual(da, scriptDigest({ ...a.script, logline: '改一句' }))
  // 场景字段不属于 script 内容，指纹不变
  const sameScript = readScriptMetaPayload(makeScriptPayload({ scriptScene: 'drama' }))
  assert.ok(sameScript)
  assert.equal(da, scriptDigest(sameScript.script))
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
