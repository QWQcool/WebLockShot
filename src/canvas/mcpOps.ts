/**
 * D8 MCP 反向驱动 · 画布侧操作契约（CANVAS_PLAN.md §9 D8-②）
 *
 * 本地 Agent 经 MCP 工具提交的操作批 → 画布端校验 → 落成 tldraw shape。
 * 本模块为**纯函数**（node --test 可跑），不 import tldraw / three。
 *
 * id 隔离：Agent 侧节点 id（如 `n1`）经 `mcpNodeId(raw, salt)` 加前缀+盐，
 * 映射为 `shape:wls-mcp-<salt>-<raw>`——与本地既有节点 id 空间隔离，重复下发不冲突。
 */
import { CANVAS_NODE_KINDS, nodeIdToShapeId, type CanvasNodeKind } from './contract.ts'

export const MCP_MAX_OPS = 50

export const MCP_OPS_NODE_KINDS: readonly string[] = CANVAS_NODE_KINDS

/** Agent 侧节点 id → 画布节点 id（加 mcp- 前缀 + 导入盐，避免与本地 id 冲突） */
export function mcpNodeId(rawId: string, salt: string): string {
  return `mcp-${salt}-${rawId}`
}

/** Agent 侧节点 id → tldraw shape id */
export function mcpNodeShapeId(rawId: string, salt: string): string {
  return nodeIdToShapeId(mcpNodeId(rawId, salt))
}

/** Agent 侧边 id → tldraw arrow shape id（同样加盐隔离） */
export function mcpEdgeArrowId(rawId: string, salt: string): string {
  return `shape:arrow-mcp-${salt}-${rawId}`
}

export type McpCreateNodeOp = {
  type: 'create-node'
  id: string
  kind: CanvasNodeKind
  x: number
  y: number
  w: number
  h: number
  meta: Record<string, unknown>
}

export type McpCreateEdgeOp = { type: 'create-edge'; id: string; from: string; to: string }

export type McpOp = McpCreateNodeOp | McpCreateEdgeOp

export type McpOpCheck = { ok: true; ops: McpOp[] } | { ok: false; reason: string }

const DEFAULT_W = 260
const DEFAULT_H = 200

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

/**
 * 校验 Agent 操作批（整体拒绝不半应用）。
 * - create-node：id 非空且本批内唯一、kind 在白名单内、坐标数值兜底；
 * - create-edge：id 唯一、不允许自环、两端节点必须存在（含本批新建的）。
 */
export function validateMcpOps(input: unknown): McpOpCheck {
  if (!Array.isArray(input)) return { ok: false, reason: 'ops 必须是数组' }
  if (input.length === 0) return { ok: false, reason: 'ops 不能为空' }
  if (input.length > MCP_MAX_OPS) return { ok: false, reason: `单批操作数超过 ${MCP_MAX_OPS} 上限` }

  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const ops: McpOp[] = []

  for (let i = 0; i < input.length; i++) {
    const raw = input[i]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, reason: `第 ${i + 1} 个操作不是对象` }
    }
    const op = raw as Record<string, unknown>
    const type = op.type
    if (type === 'create-node') {
      const id = typeof op.id === 'string' ? op.id.trim() : ''
      if (!id) return { ok: false, reason: `第 ${i + 1} 个操作缺少 id` }
      if (nodeIds.has(id)) return { ok: false, reason: `节点 id 重复：${id}` }
      const kind = op.kind
      if (typeof kind !== 'string' || !MCP_OPS_NODE_KINDS.includes(kind)) {
        return { ok: false, reason: `节点类型不合法：${String(kind)}` }
      }
      ops.push({
        type: 'create-node',
        id,
        kind: kind as CanvasNodeKind,
        x: num(op.x, 0),
        y: num(op.y, 0),
        w: num(op.w, DEFAULT_W),
        h: num(op.h, DEFAULT_H),
        meta:
          op.meta && typeof op.meta === 'object' && !Array.isArray(op.meta)
            ? (op.meta as Record<string, unknown>)
            : {},
      })
      nodeIds.add(id)
    } else if (type === 'create-edge') {
      const id = typeof op.id === 'string' ? op.id.trim() : ''
      if (!id) return { ok: false, reason: `第 ${i + 1} 个操作缺少 id` }
      if (edgeIds.has(id)) return { ok: false, reason: `边 id 重复：${id}` }
      const from = typeof op.from === 'string' ? op.from.trim() : ''
      const to = typeof op.to === 'string' ? op.to.trim() : ''
      if (!from || !to) return { ok: false, reason: `第 ${i + 1} 个边操作缺少 from/to` }
      if (from === to) return { ok: false, reason: `不允许自环：${from}` }
      if (!nodeIds.has(from) || !nodeIds.has(to)) {
        return { ok: false, reason: `边两端节点不存在：${from} → ${to}` }
      }
      ops.push({ type: 'create-edge', id, from, to })
      edgeIds.add(id)
    } else {
      return { ok: false, reason: `不支持的操作类型：${String(type)}` }
    }
  }
  return { ok: true, ops }
}

/** 已存在节点/边集合（应用前判重，避免重复下发把画布搞乱） */
export type ExistingTopology = { nodeIds: Set<string>; edgeIds: Set<string> }

/** 过滤掉已存在的操作（幂等：Agent 重复提交同一批不会重复建） */
export function filterNewOps(ops: McpOp[], existing: ExistingTopology): McpOp[] {
  const pendingNodes = new Set<string>()
  const out: McpOp[] = []
  for (const op of ops) {
    if (op.type === 'create-node') {
      if (existing.nodeIds.has(mcpNodeId(op.id, '')) || existing.nodeIds.has(op.id)) continue
      if (pendingNodes.has(op.id)) continue
      pendingNodes.add(op.id)
      out.push(op)
    } else {
      if (existing.edgeIds.has(op.id)) continue
      out.push(op)
    }
  }
  return out
}
