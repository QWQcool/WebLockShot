import type { Editor, JsonObject, TLShapeId } from 'tldraw'
import {
  createNodeId,
  nodeIdToShapeId,
  writeAssetMetaPayload,
  type AssetMetaPayload,
} from './contract.ts'
import type { WlsNodeShape } from './WlsNodeUtil.tsx'

/**
 * B5：产物卡（kind='asset'）共享创建/更新函数——generate（B4）与 product（B5）复用，
 * 避免两份「同 shotId 检索替换」逻辑。
 *
 * - 按 meta.shotId 全页检索：命中则原地替换 meta（url 变化驱动产物卡重新 hydrate）；
 *   不依赖组件内存 ref（tldraw 虚拟化下 shape 组件 remount 会清空 ref，B4 二轮教训）；
 * - 未命中才新建，新建后 zoomToFit 一次避免产物卡落在视口外（tester B4 建议）。
 * @returns 产物卡 shape id；meta 校验失败返回 null（诚实拒写）
 */
export function upsertAssetCard(
  editor: Editor,
  origin: { shapeId: TLShapeId; x: number; y: number; w: number },
  payload: AssetMetaPayload
): TLShapeId | null {
  const validated = writeAssetMetaPayload({}, payload)
  if (!validated) return null

  const hit = editor
    .getCurrentPageShapes()
    .find(
      (s): s is WlsNodeShape =>
        s.type === 'wls-node' &&
        (s.props as { kind?: unknown }).kind === 'asset' &&
        (s.props as { meta?: Record<string, unknown> }).meta?.shotId === payload.shotId
    )
  if (hit) {
    editor.updateShape({
      id: hit.id,
      type: hit.type,
      props: { meta: validated as JsonObject },
    })
    return hit.id
  }

  const count = editor.getCurrentPageShapes().filter(
    (s) => s.type === 'wls-node' && (s.props as { kind?: unknown }).kind === 'asset'
  ).length
  const nodeId = createNodeId()
  const shapeId = nodeIdToShapeId(nodeId) as TLShapeId
  editor.createShape({
    id: shapeId,
    type: 'wls-node',
    x: origin.x + origin.w + 60 + Math.floor(count / 2) * 240,
    y: origin.y + (count % 2) * 400,
    props: {
      w: 200,
      h: 380,
      kind: 'asset',
      meta: validated as JsonObject,
    },
  })
  editor.zoomToFit()
  return shapeId
}
