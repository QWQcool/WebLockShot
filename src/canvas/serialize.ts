import type { Editor, JsonObject, TLShape, TLShapeId } from 'tldraw'
import {
  arrowSnapshotsToEdges,
  canvasNodeToShapePartial,
  edgeToArrowMaterial,
  shapeSnapshotToCanvasNode,
  type ArrowBindingSnapshot,
  type CanvasDoc,
  type CanvasNode,
} from './contract.ts'

/**
 * tldraw editor ↔ CanvasDoc 双向序列化（CANVAS_PLAN.md §3 / §4.1-1）。
 *
 * 依赖 tldraw Editor 运行时（无法进 node --test）；
 * 纯逻辑部分在 contract.ts（nodeToShapePartial / shapeSnapshotToCanvasNode / arrowSnapshotsToEdges），有单测。
 */

/** CanvasDoc → 新建 shape 列表（载入画布时用；id 按 `shape:wls-<nodeId>` 规则稳定映射） */
export function docToShapePartials(doc: CanvasDoc) {
  return doc.nodes.map((node) => {
    const partial = canvasNodeToShapePartial(node)
    return {
      ...partial,
      id: partial.id as TLShapeId,
      props: {
        ...partial.props,
        // CanvasNode.meta 为宽型 Record<string, unknown>；入 store 时收窄为 JsonObject（tldraw props 校验兜底）
        meta: partial.props.meta as JsonObject,
      },
    }
  })
}

/** 恢复路径：doc.edges → 箭头 shape + 两端 binding 创建参数（B1 P1 返工：刷新后物化箭头，边不丢） */
export type ArrowShapePartial = {
  id: TLShapeId
  type: 'arrow'
  x: number
  y: number
  props: { start: { x: number; y: number }; end: { x: number; y: number } }
}

export type ArrowBindingCreate = {
  fromId: TLShapeId
  toId: TLShapeId
  type: 'arrow'
  props: { terminal: 'start' | 'end' }
}

export function docEdgesToArrowCreations(doc: CanvasDoc): {
  arrowPartials: ArrowShapePartial[]
  bindingCreates: ArrowBindingCreate[]
} {
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]))
  const arrowPartials: ArrowShapePartial[] = []
  const bindingCreates: ArrowBindingCreate[] = []
  for (const edge of doc.edges) {
    const from = nodeById.get(edge.from)
    const to = nodeById.get(edge.to)
    if (!from || !to) continue
    const material = edgeToArrowMaterial(edge, from, to)
    if (!material) continue
    arrowPartials.push({
      id: material.arrowShapeId as TLShapeId,
      type: 'arrow',
      x: material.x,
      y: material.y,
      props: { start: material.start, end: material.end },
    })
    for (const binding of material.bindings) {
      bindingCreates.push({
        fromId: material.arrowShapeId as TLShapeId,
        toId: binding.toShapeId as TLShapeId,
        type: 'arrow',
        props: { terminal: binding.terminal },
      })
    }
  }
  return { arrowPartials, bindingCreates }
}

/** 从当前页 shapes + 箭头绑定提取画布文档草稿（节点/边；校验由 validateCanvasDoc 收口） */
export function editorPageToCanvasDraft(
  editor: Pick<Editor, 'getCurrentPageShapes' | 'getBindingsFromShape'>,
  base: { id: string; name: string; updatedAt: number }
): Omit<CanvasDoc, 'version'> {
  const shapes = editor.getCurrentPageShapes()
  const nodes: CanvasNode[] = []
  for (const shape of shapes) {
    const node = shapeSnapshotToCanvasNode(toSnapshot(shape))
    if (node) nodes.push(node)
  }
  if (nodes.length === 0) {
    return { id: base.id, name: base.name, nodes: [], edges: [], updatedAt: base.updatedAt }
  }

  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const arrows: ArrowBindingSnapshot[] = []
  for (const shape of shapes) {
    if (shape.type !== 'arrow') continue
    let start: string | null = null
    let end: string | null = null
    try {
      const bindings = editor.getBindingsFromShape(shape, 'arrow')
      for (const binding of bindings) {
        const terminal = (binding.props as { terminal?: unknown }).terminal
        const target = (binding.toId as string) ?? null
        if (terminal === 'start') start = target
        if (terminal === 'end') end = target
      }
    } catch {
      // 绑定读取失败按无边处理
    }
    arrows.push({ arrowId: shape.id, startShapeId: start, endShapeId: end })
  }

  const edges = arrowSnapshotsToEdges(arrows, (shapeId) => {
    const found = shapes.find((s) => s.id === shapeId) ?? null
    const node = shapeSnapshotToCanvasNode(toSnapshot(found))
    if (!node || !nodeIdSet.has(node.id)) return null
    return node.id
  })

  return { id: base.id, name: base.name, nodes, edges, updatedAt: base.updatedAt }
}

function toSnapshot(shape: TLShape | null | undefined) {
  if (!shape) {
    return { id: '', type: '', x: 0, y: 0, props: {} }
  }
  return {
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    props: (shape.props ?? {}) as { w?: number; h?: number; kind?: string; meta?: unknown },
  }
}
