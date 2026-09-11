import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MCP_MAX_OPS,
  MCP_OPS_NODE_KINDS,
  filterNewOps,
  mcpEdgeArrowId,
  mcpNodeId,
  mcpNodeShapeId,
  validateMcpOps,
} from '../mcpOps.ts'
import { CANVAS_NODE_KINDS, shapeIdToNodeId } from '../contract.ts'

/* ---------------- id 映射（隔离 Agent 与本地 id 空间） ---------------- */

test('mcpNodeId / mcpNodeShapeId / mcpEdgeArrowId：加前缀+盐，且可双向还原', () => {
  const nodeId = mcpNodeId('n1', 'sabc')
  assert.equal(nodeId, 'mcp-sabc-n1')
  const shapeId = mcpNodeShapeId('n1', 'sabc')
  assert.equal(shapeId, 'shape:wls-mcp-sabc-n1')
  assert.equal(shapeIdToNodeId(shapeId), nodeId, '经既有 shapeIdToNodeId 可还原')
  assert.equal(mcpEdgeArrowId('e1', 'sabc'), 'shape:arrow-mcp-sabc-e1')

  // 不同盐 → 不同 id（同一 Agent 反复下发不冲突）
  assert.notEqual(mcpNodeShapeId('n1', 'sabc'), mcpNodeShapeId('n1', 'sxyz'))
})

test('MCP_OPS_NODE_KINDS 与前端契约 CANVAS_NODE_KINDS 完全一致', () => {
  assert.deepEqual([...MCP_OPS_NODE_KINDS], [...CANVAS_NODE_KINDS])
})

/* ---------------- validateMcpOps ---------------- */

test('validateMcpOps：合法批通过 + 缺省值兜底', () => {
  const r = validateMcpOps([
    { type: 'create-node', id: 'a', kind: 'brief', x: 10, y: 20, meta: { text: '需求' } },
    { type: 'create-node', id: 'b', kind: 'generate' },
    { type: 'create-edge', id: 'e', from: 'a', to: 'b' },
  ])
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.ops.length, 3)
  const n1 = r.ops[0]
  assert.equal(n1.type, 'create-node')
  if (n1.type === 'create-node') {
    assert.equal(n1.x, 10)
    assert.equal(n1.w, 260)
    assert.deepEqual(n1.meta, { text: '需求' })
  }
  const n2 = r.ops[1]
  if (n2.type === 'create-node') {
    assert.equal(n2.x, 0)
    assert.deepEqual(n2.meta, {})
  }
})

test('validateMcpOps：非法整体拒绝（中文 reason）', () => {
  const cases: [string, unknown, RegExp][] = [
    ['非数组', 'x', /数组/],
    ['空数组', [], /不能为空/],
    ['超上限', Array.from({ length: MCP_MAX_OPS + 1 }, (_, i) => ({ type: 'create-node', id: `n${i}`, kind: 'brief' })), /上限/],
    ['缺 id', [{ type: 'create-node', kind: 'brief' }], /缺少 id/],
    ['id 重复', [{ type: 'create-node', id: 'a', kind: 'brief' }, { type: 'create-node', id: 'a', kind: 'script' }], /重复/],
    ['类型非法', [{ type: 'create-node', id: 'a', kind: 'nope' }], /类型不合法/],
    ['边缺 from/to', [{ type: 'create-edge', id: 'e', from: 'a' }], /缺少 from\/to/],
    ['自环', [{ type: 'create-node', id: 'a', kind: 'brief' }, { type: 'create-edge', id: 'e', from: 'a', to: 'a' }], /自环/],
    ['端点不存在', [{ type: 'create-edge', id: 'e', from: 'a', to: 'b' }], /不存在/],
    ['未知操作', [{ type: 'delete-node', id: 'a' }], /不支持/],
    ['元素非对象', [1], /不是对象/],
  ]
  for (const [label, input, re] of cases) {
    const r = validateMcpOps(input)
    assert.equal(r.ok, false, `${label} 应拒绝`)
    if (!r.ok) assert.match(r.reason, re, label)
  }
})

/* ---------------- filterNewOps（幂等） ---------------- */

test('filterNewOps：已存在的节点/边被过滤（Agent 重复下发不重复建）', () => {
  const ops = validateMcpOps([
    { type: 'create-node', id: 'a', kind: 'brief' },
    { type: 'create-node', id: 'b', kind: 'script' },
    { type: 'create-edge', id: 'e', from: 'a', to: 'b' },
  ])
  assert.equal(ops.ok, true)
  if (!ops.ok) return

  const none = filterNewOps(ops.ops, { nodeIds: new Set(), edgeIds: new Set() })
  assert.equal(none.length, 3)

  const some = filterNewOps(ops.ops, { nodeIds: new Set(['a']), edgeIds: new Set() })
  assert.deepEqual(some.map((o) => o.id), ['b', 'e'])

  const all = filterNewOps(ops.ops, { nodeIds: new Set(['a', 'b']), edgeIds: new Set(['e']) })
  assert.equal(all.length, 0)
})
