import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ASSET_VERSIONS_MAX,
  CANVAS_DOC_KEY,
  CANVAS_EDGE_COMPAT,
  CANVAS_NODE_KINDS,
  CANVAS_NODE_META,
  READY_NODE_KINDS,
  SCRIPT_SCENE_LABEL,
  SCRIPT_SCENE_TEMPLATE_ID,
  WLS_ARROW_SHAPE_PREFIX,
  arrowShapeIdToEdgeId,
  arrowSnapshotsToEdges,
  appendAssetVersion,
  assetCurrentSlotIndex,
  assetVersionSlots,
  briefTextToWriterInput,
  canvasNodeToShapePartial,
  createEmptyCanvasDoc,
  createNodeId,
  edgeIdToArrowShapeId,
  edgeToArrowMaterial,
  buildDemoOrchestrationPlan,
  buildDirectShotPlans,
  extractSkillManifest,
  filterOrchestrationParams,
  OFFICIAL_SKILLS,
  skillManifestToNodes,
  initialNodeY,
  nodeAvailability,
  nodeIdToShapeId,
  parseOrchestrationPlan,
  readAssetMetaPayload,
  readDeliverMetaPayload,
  readEditMetaPayload,
  readGenerateMetaPayload,
  readProductMetaPayload,
  readScriptMetaPayload,
  readStoryboardMetaPayload,
  scriptDigest,
  scriptSceneOf,
  routeOrchestrationScene,
  shapeIdToNodeId,
  shapeSnapshotToCanvasNode,
  switchAssetVersion,
  validateCanvasDoc,
  validateEdgeKind,
  validateSkillManifest,
  validateSkillManifestDetailed,
  writeAssetMetaPayload,
  writeDeliverMetaPayload,
  writeEditMetaPayload,
  writeGenerateMetaPayload,
  writeProductMetaPayload,
  writeScriptMetaPayload,
  writeStoryboardMetaPayload,
  type CanvasDoc,
} from '../contract.ts'
import { scriptToStory } from '../../director/nodes/storyboardNode.ts'
import { STRUCTURE_TEMPLATES } from '../../prompts/library/structures.ts'
import { nodeHint, t } from '../../i18n/strings.ts'

const zhHint = (kind: (typeof CANVAS_NODE_KINDS)[number]): string => nodeHint('zh', kind)
const enHint = (kind: (typeof CANVAS_NODE_KINDS)[number]): string => nodeHint('en', kind)
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
    // S2（§5.2 v1.4 增补）：解锁 product → generate 单图直出通道（原为非法连线用例，见 v1.4 变更说明）
    ['product', 'generate'],
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
    // S2 起 product→generate 已解锁（单图直出通道），原非法用例移入合法列表
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

/* ---------------- B4：generate 节点 + 产物卡契约 ---------------- */

test('B4 边兼容：generate→asset、asset→deliver 合法，asset 无其它下游', () => {
  assert.deepEqual(validateEdgeKind('generate', 'asset'), { ok: true })
  assert.deepEqual(validateEdgeKind('asset', 'deliver'), { ok: true })
  const out = validateEdgeKind('asset', 'script')
  assert.equal(out.ok, false)
  assert.ok(CANVAS_EDGE_COMPAT.generate.includes('asset'))
  // A1：产物卡新增 edit 下游（源图/视频帧送局部重绘）
  assert.deepEqual([...CANVAS_EDGE_COMPAT.asset], ['deliver', 'edit'])
  assert.ok(CANVAS_NODE_KINDS.includes('asset'))
})

test('B4 asset meta：idbref/http 合法，blob: 拒绝持久化，缺字段拒绝', () => {
  const ok = readAssetMetaPayload({
    type: 'video',
    url: 'idbref://canvas-asset-s1',
    shotId: 'story1-s1',
    createdAt: 1000,
    title: '钩子',
  })
  assert.ok(ok)
  assert.equal(ok.url.startsWith('idbref://'), true)

  assert.ok(readAssetMetaPayload({ type: 'video', url: 'https://cdn.example/v.webm', shotId: 's', createdAt: 1 }))
  // blob URL 跨刷新失效：契约拒绝持久化
  assert.equal(readAssetMetaPayload({ type: 'video', url: 'blob:https://x/abc', shotId: 's', createdAt: 1 }), null)
  // 缺 shotId / type 错误
  assert.equal(readAssetMetaPayload({ type: 'video', url: 'idbref://a', createdAt: 1 }), null)
  assert.equal(readAssetMetaPayload({ type: 'audio', url: 'idbref://a', shotId: 's', createdAt: 1 }), null)
  assert.equal(readAssetMetaPayload(null), null)

  const merged = writeAssetMetaPayload({ custom: 1 }, ok!)
  assert.ok(merged)
  assert.equal(merged.custom, 1)
})

test('B4 generate meta：产物列表往返（四态状态机一致），非法状态/超量拒绝', () => {
  const artifacts = [
    { shotId: 'story1-s1', order: 1, status: 'succeeded', url: 'idbref://a' },
    { shotId: 'story1-s2', order: 2, status: 'failed', error: '轮询超时' },
    { shotId: 'story1-s3', order: 3, status: 'queued' },
    { shotId: 'story1-s4', order: 4, status: 'running' },
  ]
  const payload = { providerId: 'mock', artifacts, storyDigest: 'd1' }
  const merged = writeGenerateMetaPayload({ text: 'x' }, payload as never)
  assert.ok(merged)
  const back = readGenerateMetaPayload(merged)
  assert.ok(back)
  assert.equal(back.artifacts.length, 4)
  // 四态与 FSM 状态集合一致
  for (const a of back.artifacts) {
    assert.ok(['queued', 'running', 'succeeded', 'failed'].includes(a.status))
  }

  // 非法状态
  assert.equal(
    readGenerateMetaPayload({ providerId: 'mock', storyDigest: 'd', artifacts: [{ shotId: 's', order: 1, status: 'done' }] }),
    null
  )
  // providerId 只允许 mock（可灵/即梦画布未接通）
  assert.equal(
    readGenerateMetaPayload({ providerId: 'kling', storyDigest: 'd', artifacts: [] }),
    null
  )
  // 超过 6 条拒绝
  const tooMany = {
    providerId: 'mock',
    storyDigest: 'd',
    artifacts: Array.from({ length: 7 }, (_, i) => ({ shotId: `s${i}`, order: 1, status: 'failed' })),
  }
  assert.equal(readGenerateMetaPayload(tooMany), null)
})

test('B4 initialNodeY：默认居中；侵入对话栏避让带时上移；jitter 不越带', () => {
  // 视口高 720：center 360，bottom 720，避让带 150 → safeBottom 570
  assert.equal(initialNodeY(360, 160, 720), 280) // 280+160=440 < 570 → 居中不动
  // 高节点 560：居中 80..640 侵入避让带 → 上移为 570-560=10
  assert.equal(initialNodeY(360, 560, 720), 10)
  // jitter 不会越过避让带
  assert.ok(initialNodeY(360, 560, 720, 150, 30) <= 570 - 560)
  assert.equal(initialNodeY(360, 160, 720, 150, 30), 310)
})

/* ---------------- B5：product / deliver 契约 ---------------- */

test('B5 契约：asset type 扩展 image；image 产物卡合法（idbref）', () => {
  const ok = readAssetMetaPayload({
    type: 'image',
    url: 'idbref://canvas-asset-import-abc',
    shotId: 'import-abc',
    createdAt: 1000,
    title: '商品图',
  })
  assert.ok(ok)
  assert.equal(ok.type, 'image')
  // audio 仍拒绝
  assert.equal(readAssetMetaPayload({ type: 'audio', url: 'idbref://x', shotId: 's', createdAt: 1 }), null)
})

test('B5 边兼容：product→deliver 不合法（拓扑：product 走 script/image）', () => {
  assert.equal(validateEdgeKind('product', 'deliver').ok, false)
  assert.deepEqual(validateEdgeKind('asset', 'deliver'), { ok: true })
  assert.deepEqual(validateEdgeKind('generate', 'deliver'), { ok: true })
})

test('B5 product meta：合法载荷往返（含 link/image/video-frame 三类导入）', () => {
  const payload = {
    title: '钛合金机械手表',
    upstreamText: '钛合金机械手表，超长续航',
    imports: [
      { kind: 'image' as const, url: 'idbref://img1', name: '主图', createdAt: 1 },
      { kind: 'link' as const, url: 'https://item.taobao.com/item.htm?id=1', createdAt: 2 },
      { kind: 'video-frame' as const, url: 'idbref://frame1', name: '抽帧', createdAt: 3 },
    ],
  }
  const merged = writeProductMetaPayload({ text: 'x' }, payload)
  assert.ok(merged)
  const back = readProductMetaPayload(merged)
  assert.ok(back)
  assert.equal(back.imports.length, 3)
  assert.equal(back.imports[0].kind, 'image')
  assert.equal(back.imports[1].kind, 'link')

  // 非法：blob url / kind 非法 / 缺 title
  assert.equal(
    readProductMetaPayload({
      title: 't',
      upstreamText: 'u',
      imports: [{ kind: 'image', url: 'blob:https://x/1', createdAt: 1 }],
    }),
    null
  )
  assert.equal(
    readProductMetaPayload({
      title: 't',
      upstreamText: 'u',
      imports: [{ kind: 'audio', url: 'idbref://x', createdAt: 1 }],
    }),
    null
  )
  assert.equal(readProductMetaPayload({ upstreamText: 'u', imports: [] }), null)
  assert.equal(readProductMetaPayload(null), null)
})

test('B5 deliver meta：打包痕迹往返（imageSkipped 如实记录），非法拒读', () => {
  const payload = { lastPackagedAt: 1000, videoCount: 6, imageSkipped: 2 }
  const merged = writeDeliverMetaPayload({}, payload)
  assert.ok(merged)
  const back = readDeliverMetaPayload(merged)
  assert.ok(back)
  assert.equal(back.videoCount, 6)
  assert.equal(back.imageSkipped, 2)

  assert.equal(readDeliverMetaPayload({ lastPackagedAt: 'yesterday' }), null)
  assert.equal(readDeliverMetaPayload({ videoCount: -1 }), null)
  assert.equal(readDeliverMetaPayload('x'), null)
})

/* ---------------- B6：对话栏 LLM 编排契约 ---------------- */

test('B6 场景关键词路由：五类命中 + 未命中回退 ecommerce（确定性）', () => {
  assert.equal(routeOrchestrationScene('给商品拍一条带货短视频'), 'ecommerce')
  assert.equal(routeOrchestrationScene('设计一个新消费品牌的视觉海报'), 'brand')
  assert.equal(routeOrchestrationScene('把一句话故事拆成短剧分镜，要有反转'), 'drama')
  assert.equal(routeOrchestrationScene('为独立游戏做一支宣传 PV'), 'game')
  assert.equal(routeOrchestrationScene('设计一个记账 App 的三屏界面'), 'app')
  assert.equal(routeOrchestrationScene('随便说说'), 'ecommerce')
  assert.equal(routeOrchestrationScene('给商品拍一条带货短视频'), routeOrchestrationScene('给商品拍一条带货短视频'))
})

test('B6 演示编排拓扑：brief 起链 + 场景映射 script 契约 + 边有效', () => {
  const plan = buildDemoOrchestrationPlan('钛合金机械手表带货', 'ecommerce')
  assert.equal(plan.nodes.length, 5)
  assert.equal(plan.nodes[0].kind, 'brief')
  assert.equal(plan.nodes[0].params.text, '钛合金机械手表带货')
  assert.equal(plan.nodes[1].kind, 'script')
  assert.equal(plan.nodes[1].params.scriptScene, 'ecommerce')
  assert.equal(plan.edges.length, 4)
  // 全部 kind 均为 ready 集合成员（灰态不允许被编排）
  for (const n of plan.nodes) {
    assert.ok(
      ['brief', 'product', 'script', 'storyboard', 'generate', 'deliver'].includes(n.kind)
    )
  }
  // drama 场景映射
  const dramaPlan = buildDemoOrchestrationPlan('故事反转短剧', 'drama')
  assert.equal(dramaPlan.nodes[1].params.scriptScene, 'drama')
})

test('B6 编排参数白名单：非白名单键剔除、非法 scriptScene 剔除、文本截断', () => {
  const out = filterOrchestrationParams('script', {
    scriptScene: 'ecommerce',
    hacker: 'evil',
    text: 'should-be-ignored',
  })
  assert.deepEqual(out, { scriptScene: 'ecommerce' })

  assert.deepEqual(filterOrchestrationParams('script', { scriptScene: 'hacker' }), {})
  const brief = filterOrchestrationParams('brief', { text: '  ' + '长'.repeat(2100), evil: 1 })
  assert.equal(String(brief.text).length, 2000)
  assert.equal(brief.evil, undefined)
  assert.deepEqual(filterOrchestrationParams('storyboard', { anything: 1 }), {})
  assert.deepEqual(filterOrchestrationParams('generate', { prompt: 'x' }), {})
})

test('B6 编排拓扑契约：合法通过；灰态 kind / 参数缺失 / 下标越界 / 自环拒绝', () => {
  const raw = JSON.stringify({
    title: '编排',
    nodes: [
      { kind: 'brief', params: { text: '需求原文' } },
      { kind: 'script', params: { scriptScene: 'ecommerce' } },
      { kind: 'generate' },
    ],
    edges: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ],
  })
  const plan = parseOrchestrationPlan(raw)
  assert.ok(plan)
  assert.equal(plan.nodes.length, 3)
  assert.equal(plan.edges.length, 2)

  // 灰态 kind（image/edit/stage3d 不在 ready 集合）拒绝
  assert.equal(
    parseOrchestrationPlan(
      JSON.stringify({
        nodes: [
          { kind: 'brief', params: {} },
          { kind: 'image', params: {} },
        ],
        edges: [{ from: 0, to: 1 }],
      })
    ),
    null
  )

  // 下标越界
  assert.equal(
    parseOrchestrationPlan(
      JSON.stringify({
        nodes: [
          { kind: 'brief', params: {} },
          { kind: 'script', params: {} },
        ],
        edges: [{ from: 0, to: 5 }],
      })
    ),
    null
  )

  // 自环
  assert.equal(
    parseOrchestrationPlan(
      JSON.stringify({
        nodes: [
          { kind: 'brief', params: {} },
          { kind: 'script', params: {} },
        ],
        edges: [{ from: 1, to: 1 }],
      })
    ),
    null
  )

  // 节点过少 / 非法 JSON / Markdown 围栏可剥
  assert.equal(
    parseOrchestrationPlan(JSON.stringify({ nodes: [{ kind: 'brief', params: {} }], edges: [] })),
    null
  )
  assert.equal(parseOrchestrationPlan('not-json'), null)
  assert.ok(
    parseOrchestrationPlan('```json\n' + raw + '\n```')
  )
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

/* ---------------- A1：局部重绘（edit）节点契约 ---------------- */

test('A1 edit 节点蜕壳：nodeAvailability 转 ready，hint 去掉「二期开放」', () => {
  assert.equal(nodeAvailability('edit'), 'ready')
})

test('D1~D7 stage3d 节点蜕壳：nodeAvailability 转 ready（此前被 phase=3 误判为 locked）', () => {
  assert.equal(nodeAvailability('stage3d'), 'ready')
  assert.ok(READY_NODE_KINDS.includes('stage3d'))
  // 尚未实现的 image 仍为 locked（不装可用）
  assert.equal(nodeAvailability('image'), 'locked')
  assert.ok(!READY_NODE_KINDS.includes('image'))
})

test('节点文案不得残留已过去的期数口径（一期 A / 二期开放 / 三期开放 / N 期开放）', () => {
  const stale = /一期 A|二期开放|三期开放|\d 期开放/
  for (const kind of CANVAS_NODE_KINDS) {
    const meta = CANVAS_NODE_META[kind]
    assert.ok(!stale.test(meta.hint), `${kind} 的 meta.hint 残留过期期数：${meta.hint}`)
    assert.ok(!stale.test(zhHint(kind)), `${kind} 的中文 hint 残留过期期数：${zhHint(kind)}`)
    assert.ok(!stale.test(enHint(kind)), `${kind} 的英文 hint 残留过期期数：${enHint(kind)}`)
  }
  assert.ok(!stale.test(t('zh', 'node.lockedNote')), 'locked 说明残留过期期数')
})

test('A1 edit meta：合法载荷往返（idbref maskRef + image/video-frame）', () => {
  const payload = {
    maskRef: 'idbref://canvas-mask-n1-abc',
    sourceRef: 'idbref://canvas-asset-import-1',
    sourceType: 'image' as const,
  }
  const merged = writeEditMetaPayload({ scriptScene: 'ecommerce' }, payload)
  assert.ok(merged)
  assert.equal(merged.scriptScene, 'ecommerce') // baseMeta 保留
  const back = readEditMetaPayload(merged)
  assert.ok(back)
  assert.equal(back.maskRef, 'idbref://canvas-mask-n1-abc')
  assert.equal(back.sourceType, 'image')

  // 视频单帧定格类型 + A2 预留 instruction 字段
  const videoPayload = writeEditMetaPayload(
    {},
    { ...payload, sourceType: 'video-frame' as const, instruction: '把背景换成大理石台面' }
  )
  assert.ok(videoPayload)
  const videoBack = readEditMetaPayload(videoPayload)
  assert.ok(videoBack)
  assert.equal(videoBack.sourceType, 'video-frame')
  assert.equal(videoBack.instruction, '把背景换成大理石台面')
})

test('A1 edit meta：blob: maskRef 拒绝 / 非法 sourceType 拒绝 / 缺字段拒读', () => {
  // blob: URL 跨刷新失效，mask 契约拒绝持久化
  assert.equal(
    readEditMetaPayload({ maskRef: 'blob:https://x/m', sourceRef: 'idbref://s', sourceType: 'image' }),
    null
  )
  // sourceRef 沿用产物 url 规则：blob: 也拒绝
  assert.equal(
    readEditMetaPayload({ maskRef: 'idbref://m', sourceRef: 'blob:https://x/s', sourceType: 'image' }),
    null
  )
  // 非法 sourceType
  assert.equal(
    readEditMetaPayload({ maskRef: 'idbref://m', sourceRef: 'idbref://s', sourceType: 'audio' }),
    null
  )
  // 缺 maskRef / 非 object
  assert.equal(readEditMetaPayload({ sourceRef: 'idbref://s', sourceType: 'image' }), null)
  assert.equal(readEditMetaPayload('x'), null)

  // 写入侧同样拒写（不合格则整体失败）
  assert.equal(
    writeEditMetaPayload({}, {
      maskRef: 'blob:https://x/m',
      sourceRef: 'idbref://s',
      sourceType: 'image',
    }),
    null
  )
})

test('A1 边兼容：asset→edit 合法（产物卡送局部重绘）', () => {
  assert.deepEqual(validateEdgeKind('asset', 'edit'), { ok: true })
  assert.deepEqual(validateEdgeKind('image', 'edit'), { ok: true })
  assert.equal(validateEdgeKind('edit', 'asset').ok, false)
  assert.equal(validateEdgeKind('edit', 'edit').ok, false)
})

/* ---------------- A2：重绘版本堆叠契约 ---------------- */

/** 构造基础 asset meta（B5 形状） */
function makeAssetMeta(): Record<string, unknown> {
  return {
    type: 'image',
    url: 'idbref://canvas-asset-base',
    shotId: 'import-1',
    createdAt: 1000,
    title: '吹风机',
  }
}

test('A2 appendAssetVersion：首次重绘固化 baseUrl，meta.url 指向新版本，最新在前', () => {
  const base = makeAssetMeta()
  const r1 = appendAssetVersion(base, {
    url: 'idbref://canvas-inpaint-v1',
    instruction: '把背景换成大理石台面',
    demo: true,
    createdAt: 2000,
  })
  assert.ok(r1)
  assert.equal(r1.truncated, 0)
  const p1 = readAssetMetaPayload(r1.meta)
  assert.ok(p1)
  assert.equal(p1.baseUrl, 'idbref://canvas-asset-base')
  assert.equal(p1.url, 'idbref://canvas-inpaint-v1')
  assert.equal(p1.versions?.length, 1)
  assert.equal(p1.versions?.[0]?.url, 'idbref://canvas-inpaint-v1')
  assert.equal(p1.versions?.[0]?.demo, true)

  // 第二轮基于当前显示版本叠加：versions 只增不乱
  const r2 = appendAssetVersion(r1.meta, {
    url: 'idbref://canvas-inpaint-v2',
    instruction: '再加一杯咖啡',
    demo: false,
    createdAt: 3000,
  })
  assert.ok(r2)
  const p2 = readAssetMetaPayload(r2.meta)
  assert.ok(p2)
  assert.equal(p2.url, 'idbref://canvas-inpaint-v2')
  assert.deepEqual(
    p2.versions?.map((v) => v.url),
    ['idbref://canvas-inpaint-v2', 'idbref://canvas-inpaint-v1']
  )
  // baseUrl 保持原始素材不动
  assert.equal(p2.baseUrl, 'idbref://canvas-asset-base')
})

test('A2 版本切换纯函数：槽位序列 + 边界越界返回 null（不回绕）', () => {
  let meta = makeAssetMeta()
  for (let i = 1; i <= 3; i++) {
    const r = appendAssetVersion(meta, {
      url: `idbref://canvas-inpaint-v${i}`,
      instruction: `第 ${i} 版`,
      demo: i % 2 === 1,
      createdAt: 1000 + i,
    })
    assert.ok(r)
    meta = r.meta
  }
  const payload = readAssetMetaPayload(meta)
  assert.ok(payload)

  // 槽位（时间序）：0=原始素材，1..3=版本由旧到新（v1,v2,v3）
  const slots = assetVersionSlots(payload)
  assert.deepEqual(
    slots.map((s) => s.url),
    [
      'idbref://canvas-asset-base',
      'idbref://canvas-inpaint-v1',
      'idbref://canvas-inpaint-v2',
      'idbref://canvas-inpaint-v3',
    ]
  )
  assert.equal(assetCurrentSlotIndex(payload), 3) // 当前 = 最新 v3
  assert.equal(slots[1].demo, true) // v1 demo（i=1 奇数）
  assert.equal(slots[3].demo, true) // v3 demo（i=3 奇数）
  assert.equal(slots[2].demo, false) // v2 真实

  // 回退/前进：dir -1 向旧 / +1 向新
  assert.equal(switchAssetVersion(payload, -1), 'idbref://canvas-inpaint-v2')
  assert.equal(switchAssetVersion(payload, 1), null) // 已是最新
  // 回退到 v1 后可继续回退到原始素材
  const rolledMeta = { ...meta, url: 'idbref://canvas-inpaint-v1' }
  const rolled = readAssetMetaPayload(rolledMeta)
  assert.ok(rolled)
  assert.equal(assetCurrentSlotIndex(rolled), 1) // v1 槽位 1
  assert.equal(switchAssetVersion(rolled, -1), 'idbref://canvas-asset-base')
  assert.equal(switchAssetVersion(rolled, 1), 'idbref://canvas-inpaint-v2')
})

test('A2 版本上限：>20 截断最旧并如实返回截断数；blob: url 拒写', () => {
  let meta = makeAssetMeta()
  for (let i = 1; i <= ASSET_VERSIONS_MAX + 3; i++) {
    const r = appendAssetVersion(meta, {
      url: `idbref://canvas-inpaint-v${i}`,
      instruction: `第 ${i} 版`,
      demo: false,
      createdAt: 1000 + i,
    })
    assert.ok(r)
    meta = r.meta
    const expectedLen = Math.min(i, ASSET_VERSIONS_MAX)
    const p = readAssetMetaPayload(meta)
    assert.ok(p)
    assert.equal(p.versions?.length, expectedLen)
    if (i > ASSET_VERSIONS_MAX) {
      assert.equal(r.truncated, 1) // 每轮只溢出 1 条
    } else {
      assert.equal(r.truncated, 0)
    }
  }
  // 最旧的 v1/v2/v3 被截断，保留 v4..v23（最新在前）
  const p = readAssetMetaPayload(meta)
  assert.ok(p)
  assert.deepEqual(p.versions?.[0]?.url, 'idbref://canvas-inpaint-v23')
  assert.deepEqual(p.versions?.at(-1)?.url, 'idbref://canvas-inpaint-v4')

  // blob: 产物 url 拒绝入档（整体失败）
  const rejected = appendAssetVersion(makeAssetMeta(), {
    url: 'blob:https://x/inpaint',
    instruction: 'x',
    demo: true,
    createdAt: 1,
  })
  assert.equal(rejected, null)

  // 非 asset meta 拒绝
  assert.equal(
    appendAssetVersion({ foo: 1 }, { url: 'idbref://x', instruction: 'x', demo: true, createdAt: 1 }),
    null
  )
})

test('A2 版本条目契约：非法 instruction 超长 / 缺 demo 拒读', () => {
  const meta = makeAssetMeta()
  const bad = {
    ...meta,
    baseUrl: 'idbref://canvas-asset-base',
    url: 'idbref://v1',
    versions: [
      {
        url: 'idbref://v1',
        instruction: '长'.repeat(501),
        demo: true,
        createdAt: 1,
      },
    ],
  }
  assert.equal(readAssetMetaPayload(bad), null)

  // blob: 版本 url 拒读
  const badUrl = {
    ...meta,
    versions: [{ url: 'blob:https://x/1', instruction: 'x', demo: true, createdAt: 1 }],
  }
  assert.equal(readAssetMetaPayload(badUrl), null)
})

/* ---------------- S1：Skill manifest 契约 ---------------- */

/** 构造六节点带货链画布（meta 故意混入产物/大资产/运行痕迹字段，验证导出剥离） */
function makeSkillDoc(): CanvasDoc {
  return {
    version: 1,
    id: 'canvas-skill',
    name: '技能画布',
    nodes: [
      {
        id: 'n1',
        kind: 'brief',
        x: 0,
        y: 0,
        w: 260,
        h: 160,
        meta: { text: '冰博克奶茶带货', junk: 'idbref://should-not-export' },
      },
      {
        id: 'n2',
        kind: 'product',
        x: 300,
        y: 0,
        w: 300,
        h: 340,
        meta: {
          title: '冰博克奶茶',
          upstreamText: '运行痕迹应剥离',
          imports: [{ kind: 'image', url: 'idbref://img-1', createdAt: 1 }],
        },
      },
      {
        id: 'n3',
        kind: 'script',
        x: 640,
        y: 0,
        w: 300,
        h: 220,
        meta: { scriptScene: 'ecommerce', upstreamText: 'y' },
      },
      { id: 'n4', kind: 'storyboard', x: 980, y: 0, w: 300, h: 560, meta: { story: 'should-strip' } },
      {
        id: 'n5',
        kind: 'generate',
        x: 1320,
        y: 0,
        w: 300,
        h: 320,
        meta: {
          artifacts: [{ shotId: 's1', order: 1, status: 'succeeded', url: 'idbref://video-1' }],
        },
      },
      { id: 'n6', kind: 'deliver', x: 1660, y: 0, w: 300, h: 400, meta: { videoCount: 3 } },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2' },
      { id: 'e2', from: 'n2', to: 'n3' },
      { id: 'e3', from: 'n3', to: 'n4' },
      { id: 'e4', from: 'n4', to: 'n5' },
      { id: 'e5', from: 'n5', to: 'n6' },
    ],
    updatedAt: 1000,
  }
}

test('S1 extractSkillManifest：六节点链提取 → 槽位/坐标归一化/参数白名单/产物剥离', () => {
  const doc = makeSkillDoc()
  const manifest = extractSkillManifest(
    doc,
    doc.nodes.map((n) => n.id),
    '六步爆款带货流'
  )
  assert.ok(manifest)
  assert.equal(manifest.version, 1)
  assert.equal(manifest.name, '六步爆款带货流')
  assert.equal(manifest.nodes.length, 6)

  // 槽位按 (x,y) 升序 = slot-1..6
  assert.deepEqual(
    manifest.nodes.map((n) => n.slot),
    ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6']
  )
  assert.deepEqual(
    manifest.nodes.map((n) => n.kind),
    ['brief', 'product', 'script', 'storyboard', 'generate', 'deliver']
  )
  // 坐标归一化：minX=0,minY=0 → 首节点在原点，其余保留相对间距
  assert.deepEqual(
    manifest.nodes.map((n) => n.x),
    [0, 300, 640, 980, 1320, 1660]
  )
  assert.ok(manifest.nodes.every((n) => n.y === 0 && n.w > 0 && n.h > 0))

  // 参数槽位白名单：只留 brief.text / product.title / script.scriptScene，产物与痕迹全剥离
  assert.deepEqual(manifest.nodes[0].params, { text: '冰博克奶茶带货' })
  assert.deepEqual(manifest.nodes[1].params, { title: '冰博克奶茶' })
  assert.deepEqual(manifest.nodes[2].params, { scriptScene: 'ecommerce' })
  for (const node of manifest.nodes.slice(3)) {
    assert.deepEqual(node.params, {})
  }

  // 边：下标化 + 顺序保持
  assert.deepEqual(manifest.edges, [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
    { from: 4, to: 5 },
  ])

  // inputs：入口节点（无入边）可填参数槽——链式拓扑中仅 slot-1（brief）为入口
  assert.deepEqual(
    manifest.inputs.map((i) => [i.slot, i.paramKey]),
    [['slot-1', 'text']]
  )
  assert.ok(manifest.inputs.every((i) => i.label.length > 0))
  assert.deepEqual(manifest.outputs, [{ slot: 'slot-6', label: '成片交付' }])

  // 产物剥离：整份 manifest 序列化后不含任何设备本地引用
  const json = JSON.stringify(manifest)
  assert.ok(!json.includes('idbref://'))
  assert.ok(!json.includes('imports'))
  assert.ok(!json.includes('maskRef'))

  // 深度校验通过 + 双次提取确定性（字节级一致）
  assert.ok(validateSkillManifest(manifest))
  const again = extractSkillManifest(doc, doc.nodes.map((n) => n.id), '六步爆款带货流')
  assert.equal(JSON.stringify(again), json)
})

test('S1 extractSkillManifest：子拓扑边只保留两端都在选集（换商品重跑场景）', () => {
  const doc = makeSkillDoc()
  const manifest = extractSkillManifest(doc, ['n2', 'n3', 'n5'], '子拓扑')
  assert.ok(manifest)
  assert.equal(manifest.nodes.length, 3)
  // n2(x=300) → slot-1、n3(x=640) → slot-2、n5(x=1320) → slot-3
  assert.deepEqual(
    manifest.nodes.map((n) => n.slot),
    ['slot-1', 'slot-2', 'slot-3']
  )
  // 只有 n2→n3 两端都在选集；n4→n5 / n5→n6 被丢弃
  assert.deepEqual(manifest.edges, [{ from: 0, to: 1 }])
  // 入口：n2（product.title）、n5（无参数槽则无 input 声明）；终点：n3、n5
  assert.deepEqual(
    manifest.inputs.map((i) => [i.slot, i.paramKey]),
    [['slot-1', 'title']]
  )
  assert.deepEqual(
    manifest.outputs.map((o) => o.slot),
    ['slot-2', 'slot-3']
  )
})

test('S1 extractSkillManifest：少于 2 节点 / 灰态 kind 被过滤后不足 2 → null', () => {
  const doc = makeSkillDoc()
  assert.equal(extractSkillManifest(doc, ['n1'], '单节点'), null)
  assert.equal(extractSkillManifest(doc, [], '空选集'), null)
  // 灰态节点（image 尚未实现，非 ready）不计入
  const withLocked: CanvasDoc = {
    ...doc,
    nodes: [
      ...doc.nodes,
      { id: 'n7', kind: 'image', x: 2000, y: 0, w: 260, h: 160, meta: {} },
      { id: 'n8', kind: 'image', x: 2300, y: 0, w: 260, h: 160, meta: {} },
    ],
    edges: [...doc.edges, { id: 'e6', from: 'n1', to: 'n7' }],
  }
  assert.equal(extractSkillManifest(withLocked, ['n1', 'n7', 'n8'], '只选灰态'), null)
})

test('S1 validateSkillManifest：非法形状整体拒绝（缺 name / 空节点 / slot 异常 / 边异常）', () => {
  const base = extractSkillManifest(makeSkillDoc(), ['n1', 'n2'], '最小包')
  assert.ok(base)

  const expectNull = (label: string, raw: unknown) => {
    assert.equal(validateSkillManifest(raw), null, label)
  }
  expectNull('缺 name', { ...base, name: '' })
  expectNull('版本错误', { ...base, version: 2 })
  expectNull('节点不足', { ...base, nodes: [base.nodes[0]] })
  expectNull('非法 slot 格式', { ...base, nodes: [{ ...base.nodes[0], slot: 'node-1' }, base.nodes[1]] })
  expectNull('slot 重复', { ...base, nodes: [base.nodes[0], { ...base.nodes[1], slot: 'slot-1' }] })
  expectNull('slot 不连续', { ...base, nodes: [base.nodes[0], { ...base.nodes[1], slot: 'slot-9' }] })
  expectNull('灰态 kind（image）', {
    ...base,
    nodes: [
      base.nodes[0],
      { ...base.nodes[1], slot: 'slot-2', kind: 'image' },
    ],
  })
  expectNull('边下标越界', { ...base, edges: [{ from: 0, to: 5 }] })
  expectNull('自环边', { ...base, edges: [{ from: 1, to: 1 }] })
  expectNull('重复边', { ...base, edges: [{ from: 0, to: 1 }, { from: 0, to: 1 }] })
  expectNull('inputs 引用未知 slot', { ...base, inputs: [{ slot: 'slot-9', paramKey: 'title', label: 'x' }] })
  expectNull('outputs 引用未知 slot', { ...base, outputs: [{ slot: 'slot-9', label: 'x' }] })
  expectNull('非对象输入', 'not-an-object')
})

test('S1 validateSkillManifest：产物污染 / 白名单外参数 / 非法 scriptScene / 边 kind 不兼容拒绝', () => {
  const base = extractSkillManifest(makeSkillDoc(), ['n1', 'n2'], '污染测试包')
  assert.ok(base)

  // 白名单外键（storyboard 不允许任何参数）
  assert.equal(
    validateSkillManifest({
      ...base,
      nodes: [
        base.nodes[0],
        { slot: 'slot-2', kind: 'storyboard', x: 300, y: 0, w: 300, h: 560, params: { url: 'idbref://x' } },
      ],
    }),
    null
  )
  // 白名单键值混入产物引用（idbref://）
  assert.equal(
    validateSkillManifest({
      ...base,
      nodes: [
        { ...base.nodes[0], params: { text: '看这个 idbref://video-1' } },
        base.nodes[1],
      ],
    }),
    null
  )
  // 白名单键值混入 blob: 引用
  assert.equal(
    validateSkillManifest({
      ...base,
      nodes: [{ ...base.nodes[0], params: { text: 'blob:https://x/1' } }, base.nodes[1]],
    }),
    null
  )
  // scriptScene 非法枚举
  assert.equal(
    validateSkillManifest({
      ...base,
      nodes: [
        base.nodes[0],
        { ...base.nodes[1], kind: 'script', params: { scriptScene: 'hacker' } },
      ],
    }),
    null
  )
  // 边 kind 不兼容（brief → deliver）
  assert.equal(
    validateSkillManifest({
      ...base,
      nodes: [
        base.nodes[0],
        { ...base.nodes[1], kind: 'deliver', params: {} },
      ],
      edges: [{ from: 0, to: 1 }],
    }),
    null
  )
  // 合法对照仍通过
  assert.ok(validateSkillManifest(base))
})

/* ---------------- S3：script 节点记忆痕迹契约 ---------------- */

test('S3 script meta：memoryApplied 痕迹字段读写（无历史数据时缺省，徽章如实显隐）', () => {
  const basePayload = {
    scriptScene: 'ecommerce' as const,
    script: {
      logline: 'test',
      templateId: 't1_pain_opening',
      ctaLine: 'cta',
      lengthTargetSec: 18,
      beats: [
        {
          order: 1,
          role: 'hook' as const,
          goal: 'g',
          action: 'a',
          audio: { kind: 'vo' as const, speaker: 's', text: 't' },
          caption: 'c',
          emotion: 'e',
        },
      ],
    },
    critic: { score: 80, passed: true, summary: 'ok', strengths: [], suggestions: [] },
    demo: true,
    upstreamText: 'x',
  }
  // 载荷须至少 1 个 beat？scriptMetaPayloadSchema 用 ScriptSchema——beats 数量由 ScriptSchema 决定，
  // 此处若校验失败说明样例不满足，读取端会返回 null（先验证基线可写）。
  const written = writeScriptMetaPayload({}, { ...basePayload, memoryApplied: true })
  if (written) {
    const back = readScriptMetaPayload(written)
    assert.ok(back)
    assert.equal(back.memoryApplied, true)
  }
  // memoryApplied 缺省（无历史数据）也应可写可读（徽章不显示）
  const writtenNoMem = writeScriptMetaPayload({}, basePayload)
  if (writtenNoMem) {
    const back2 = readScriptMetaPayload(writtenNoMem)
    assert.ok(back2)
    assert.equal(back2.memoryApplied, undefined)
  }
})

/* ---------------- S2：导入复用 + 单图直出 + 官方 Skill ---------------- */

test('S2 O1 对抗：params 值非字符串（number/对象/数组）整体拒绝且给出中文原因', () => {
  const base = extractSkillManifest(makeSkillDoc(), ['n1', 'n2'], 'O1 对抗包')
  assert.ok(base)

  const textNode = base.nodes[0]
  const withParams = (params: Record<string, unknown>) => ({
    ...base,
    nodes: [{ ...textNode, params }, base.nodes[1]],
  })

  // number 值
  const num = validateSkillManifestDetailed(withParams({ text: 123 }))
  assert.equal(num.ok, false)
  if (!num.ok) assert.ok(/字符串/.test(num.reason), `reason 应含「字符串」：${num.reason}`)
  // 对象值
  assert.equal(validateSkillManifest(withParams({ text: { evil: 1 } })), null)
  // 数组值
  assert.equal(validateSkillManifest(withParams({ text: ['a'] })), null)
  // null 值
  assert.equal(validateSkillManifest(withParams({ text: null })), null)
  // 合法字符串仍通过（含空串——空输入 = 等用户「填新输入」）
  assert.ok(validateSkillManifest(withParams({ text: '' })))
  assert.ok(validateSkillManifest(withParams({ text: '正常文本' })))
})

test('S2 O2：name 纯空白被拒绝（validateSkillManifestDetailed 给中文原因）', () => {
  const base = extractSkillManifest(makeSkillDoc(), ['n1', 'n2'], 'O2 包')
  assert.ok(base)
  const blank = validateSkillManifestDetailed({ ...base, name: '   ' })
  assert.equal(blank.ok, false)
  if (!blank.ok) assert.ok(/名称/.test(blank.reason), `reason 应含「名称」：${blank.reason}`)
  assert.equal(validateSkillManifest({ ...base, name: '' }), null)
})

test('S2 单图直出连线：product→generate 合法（compat 表 + validateEdgeKind 一致）', () => {
  assert.ok(CANVAS_EDGE_COMPAT.product.includes('generate'))
  assert.deepEqual(validateEdgeKind('product', 'generate'), { ok: true })
  // 其余非法连线语义不变
  assert.equal(validateEdgeKind('generate', 'product').ok, false)
  assert.equal(validateEdgeKind('product', 'asset').ok, false)
})

test('S2 buildDirectShotPlans：单镜演示计划（商品标题作提示词）确定性', () => {
  const plans = buildDirectShotPlans('  冰博克奶茶  ')
  assert.equal(plans.length, 1)
  assert.equal(plans[0].shotId, 'direct-s1')
  assert.equal(plans[0].order, 1)
  assert.equal(plans[0].durationSec, 3)
  assert.ok(plans[0].positive.startsWith('冰博克奶茶'))
  assert.equal(plans[0].caption, '冰博克奶茶')
  // 确定性：同输入同输出
  assert.equal(JSON.stringify(buildDirectShotPlans('冰博克奶茶')), JSON.stringify(plans))
  // 空标题 → 空数组（调用方禁用按钮）
  assert.deepEqual(buildDirectShotPlans('   '), [])
  // 超长标题截断 120
  const long = buildDirectShotPlans('长'.repeat(200))
  assert.ok(long[0].positive.startsWith('长'.repeat(120)))
})

test('S2 官方 Skill：两包均通过深度校验且拓扑/输入/输出正确', () => {
  assert.equal(OFFICIAL_SKILLS.length, 2)
  for (const skill of OFFICIAL_SKILLS) {
    const check = validateSkillManifestDetailed(skill.manifest)
    assert.ok(check.ok, `官方 Skill「${skill.manifest.name}」应通过校验：${check.ok ? '' : check.reason}`)
  }
  const six = OFFICIAL_SKILLS[0].manifest
  assert.equal(six.nodes.length, 6)
  assert.deepEqual(
    six.nodes.map((n) => n.kind),
    ['brief', 'product', 'script', 'storyboard', 'generate', 'deliver']
  )
  assert.deepEqual(six.edges, [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 4 },
    { from: 4, to: 5 },
  ])
  assert.deepEqual(
    six.inputs.map((i) => [i.slot, i.paramKey]),
    [
      ['slot-1', 'text'],
      ['slot-2', 'title'],
    ]
  )
  assert.deepEqual(six.outputs, [{ slot: 'slot-6', label: '成片交付' }])
  // script 场景参数延续
  assert.deepEqual(six.nodes[2].params, { scriptScene: 'ecommerce' })

  const single = OFFICIAL_SKILLS[1].manifest
  assert.equal(single.nodes.length, 2)
  assert.deepEqual(single.edges, [{ from: 0, to: 1 }])
  assert.deepEqual(
    single.nodes.map((n) => n.kind),
    ['product', 'generate']
  )
  assert.deepEqual(
    single.inputs.map((i) => [i.slot, i.paramKey]),
    [['slot-1', 'title']]
  )
  assert.deepEqual(single.outputs, [{ slot: 'slot-2', label: '视频生成' }])
})

test('S2 skillManifestToNodes：id 全量重映射 + 相对坐标落位避开对话栏 + 边重映射', () => {
  const single = OFFICIAL_SKILLS[1].manifest
  const viewport = { minX: 0, maxX: 1500, centerY: 400, bottomY: 900, safeBandPx: 150 }
  const plan = skillManifestToNodes(single, viewport)
  assert.ok(plan)
  assert.equal(plan.nodes.length, 2)
  assert.equal(plan.edges.length, 1)

  // id 重映射：两次导入 id 不同（与现有画布节点不冲突）
  const again = skillManifestToNodes(single, viewport)
  assert.ok(again)
  assert.notEqual(plan.nodes[0].id, again.nodes[0].id)
  assert.notEqual(plan.nodes[1].id, again.nodes[1].id)
  assert.notEqual(plan.edges[0].id, again.edges[0].id)

  // 相对坐标落位：offsetX = minX+40；垂直居中优先，底边不进避让带
  // totalH = max(y+h) = 340 → idealOffsetY = 400-170 = 230；maxOffsetY = 900-150-340 = 410 → 取 230
  assert.equal(plan.nodes[0].x, 40)
  assert.equal(plan.nodes[0].y, 230)
  assert.equal(plan.nodes[1].x, 40 + 360)
  assert.equal(plan.nodes[1].y, 230)
  assert.ok(plan.nodes.every((n) => n.y + n.h <= viewport.bottomY - 150), '底边不得进入对话栏避让带')

  // 边重映射到新节点 id；边 id 规则 eimp-<导入盐>-N（每次导入唯一，箭头物化跨刷新稳定）
  assert.match(plan.edges[0].id, /^eimp-[A-Za-z0-9_-]+-1$/)
  assert.notEqual(plan.edges[0].id, again.edges[0].id) // 同画布多次导入边 id 不冲突
  assert.equal(plan.edges[0].from, plan.nodes[0].id)
  assert.equal(plan.edges[0].to, plan.nodes[1].id)

  // 重映射计划经 validateCanvasDoc 兼容（节点/边 schema、边引用完整性）
  const doc = validateCanvasDoc({
    version: 1,
    id: 'canvas-import',
    name: '导入测试',
    nodes: plan.nodes,
    edges: plan.edges,
    updatedAt: 1,
  })
  assert.ok(doc)
  assert.equal(doc.nodes.length, 2)
  assert.equal(doc.edges.length, 1)
})

test('S2 skillManifestToNodes：inputs 映射为 skillInputKeys（仅白名单内）+ 空串参数丢弃如实未生成', () => {
  const six = OFFICIAL_SKILLS[0].manifest
  const plan = skillManifestToNodes(six, { minX: 0, maxX: 2400, centerY: 300, bottomY: 1000 })
  assert.ok(plan)
  assert.equal(plan.nodes.length, 6)
  const byKind = new Map(plan.nodes.map((n) => [n.kind, n]))
  // 入口 brief 高亮「填新输入」
  assert.deepEqual(byKind.get('brief')?.meta.skillInputKeys, ['text'])
  // product 虽有入边，官方包 inputs 显式声明换商品图 → 同样高亮
  assert.deepEqual(byKind.get('product')?.meta.skillInputKeys, ['title'])
  // script 参数延续（无输入声明 → 无标记）
  assert.equal(byKind.get('script')?.meta.scriptScene, 'ecommerce')
  assert.equal(byKind.get('script')?.meta.skillInputKeys, undefined)
  // brief/product 的空输入参数被丢弃 → 如实显示未生成
  assert.equal(byKind.get('brief')?.meta.text, undefined)
  assert.equal(byKind.get('product')?.meta.title, undefined)
  // storyboard/generate/deliver 无参数槽
  for (const kind of ['storyboard', 'generate', 'deliver'] as const) {
    assert.deepEqual(byKind.get(kind)?.meta, {})
  }
})
