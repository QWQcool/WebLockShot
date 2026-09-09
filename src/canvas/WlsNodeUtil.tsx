import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  type JsonObject,
  type TLResizeInfo,
  type TLShape,
} from 'tldraw'
import {
  CANVAS_NODE_META,
  nodeAvailability,
  type CanvasNodeKind,
} from './contract.ts'
import { AssetNodeBody } from './AssetNodeBody.tsx'
import { GenerateNodeBody } from './GenerateNodeBody.tsx'
import { ScriptNodeBody } from './ScriptNodeBody.tsx'
import { StoryboardNodeBody } from './StoryboardNodeBody.tsx'
import { ProductNodeBody } from './ProductNodeBody.tsx'
import { DeliverNodeBody } from './DeliverNodeBody.tsx'
import { EditNodeBody } from './EditNodeBody.tsx'

/**
 * 画布 Agent 节点 shape（CANVAS_PLAN.md §4.1-2）。
 *
 * - v5 通过 TLGlobalShapePropsMap 模块扩充注册自定义 shape（map 值 = props 形状）；
 * - w/h/kind/meta 走 tldraw props 校验（非法数据无法入 store，与 CanvasDoc zod 契约双保险）；
 * - 灰态节点（二期局部重绘 / 三期 3D 运镜台）如实标注开放阶段，不装可用。
 */

const WLS_NODE_TYPE = 'wls-node'

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [WLS_NODE_TYPE]: {
      w: number
      h: number
      kind: CanvasNodeKind
      meta: JsonObject
    }
  }
}

export type WlsNodeShape = TLShape<typeof WLS_NODE_TYPE>

export class WlsNodeUtil extends BaseBoxShapeUtil<WlsNodeShape> {
  static override type = WLS_NODE_TYPE

  static override props = {
    w: T.number,
    h: T.number,
    kind: T.literalEnum(...(Object.keys(CANVAS_NODE_META) as [CanvasNodeKind, ...CanvasNodeKind[]])),
    meta: T.dict(T.string, T.jsonValue),
  }

  override canBind() {
    // 一期 A 就允许箭头连接（连线类型校验与数据流是一期 B 的内容），为边序列化留好底座
    return true
  }

  override getDefaultProps(): WlsNodeShape['props'] {
    return { w: 260, h: 160, kind: 'brief', meta: {} }
  }

  override getGeometry(shape: WlsNodeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  override getIndicatorPath(shape: WlsNodeShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }

  override onResize(shape: WlsNodeShape, info: TLResizeInfo<WlsNodeShape>) {
    // B2/B3/B4/B5：上限扩展（script 300×220、storyboard 300×560、generate 300×320、asset 200×380、product 300×340、deliver 300×400）
    const w = Math.max(180, Math.min(560, Math.round(shape.props.w * info.scaleX)))
    const h = Math.max(120, Math.min(720, Math.round(shape.props.h * info.scaleY)))
    return {
      id: shape.id,
      type: shape.type,
      props: { w, h },
    }
  }

  override component(shape: WlsNodeShape) {
    const meta = CANVAS_NODE_META[shape.props.kind]
    const availability = nodeAvailability(shape.props.kind)
    const availabilityLabel =
      availability === 'ready'
        ? '就绪'
        : availability === 'pending'
          ? '一期 B 接通'
          : `${meta.phase} 期开放`
    // 对话栏生成的 Brief 文本存在 meta.text（script 节点沿边读取上游 Brief，见 ScriptNodeBody）
    const briefText =
      typeof shape.props.meta.text === 'string' && shape.props.meta.text.trim().length > 0
        ? shape.props.meta.text.trim()
        : null

    return (
      <HTMLContainer
        className="wls-node"
        data-kind={shape.props.kind}
        data-availability={availability}
        style={{ pointerEvents: 'all' }}
      >
        <div className="wls-node-accent" style={{ background: meta.accent }} />
        <div className="wls-node-head">
          <span className="wls-node-icon">{meta.icon}</span>
          <span className="wls-node-title">{meta.label}</span>
          <span className={`wls-node-badge wls-node-badge-${availability}`} title={meta.hint}>
            {availabilityLabel}
          </span>
        </div>
        <div className="wls-node-body">
          {shape.props.kind === 'asset' ? (
            <AssetNodeBody shape={shape} />
          ) : shape.props.kind === 'generate' ? (
            <GenerateNodeBody shape={shape} />
          ) : shape.props.kind === 'product' ? (
            <ProductNodeBody shape={shape} />
          ) : shape.props.kind === 'deliver' ? (
            <DeliverNodeBody shape={shape} />
          ) : shape.props.kind === 'edit' ? (
            // A1 局部重绘：绘图区（stage）整体阻断 pointerdown，节点拖动走标题区
            <EditNodeBody shape={shape} />
          ) : shape.props.kind === 'script' ? (
            // 内嵌交互节点约定（B4 generate / B5 product/deliver 同此）：
            // pointerdown 冒泡阻断必须收窄到【具体控件元素】（textarea/select/button 各自
            // onPointerDown stopPropagation），绝不可挂在 body 或卡片根容器——
            // 根容器级会吞掉从 body 空白区起笔的画线事件（start 端绑定失效，edges 不落盘）。
            <ScriptNodeBody shape={shape} />
          ) : shape.props.kind === 'storyboard' ? (
            <StoryboardNodeBody shape={shape} />
          ) : (
            <>
              {briefText ? (
                <p className="wls-node-text">{briefText}</p>
              ) : (
                <p className="wls-node-hint">{meta.hint}</p>
              )}
              {availability === 'locked' && (
                <p className="wls-node-locked-note">当前为 {meta.phase} 期开放能力，一期 A 仅摆放占位。</p>
              )}
            </>
          )}
        </div>
        <div className="wls-node-foot">
          <span className="wls-node-id">{shape.id.replace('shape:wls-', '')}</span>
        </div>
      </HTMLContainer>
    )
  }
}
