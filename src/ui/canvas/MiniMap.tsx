import React, { useCallback, useEffect, useRef, useState } from 'react'
import { buildMiniMapModel, miniToWorld, type MiniRect } from '../../canvas/minimap.ts'

/**
 * D9 小地图（CANVAS_PLAN.md §9 D9-①）
 *
 * tldraw 无内置小地图 → Canvas2D 自绘：
 * - 内容矩形 = 当前页所有 wls-node 的页坐标包围盒；视口矩形 = editor.getViewportPageBounds()；
 * - 点击 / 拖动 → 小地图坐标反算世界坐标 → 父组件调 editor.centerOnPoint 平滑导航；
 * - 无节点时如实显示「空画布」（小地图仍显示视口框，不摆假内容）。
 */

type Props = {
  shapes: MiniRect[]
  viewport: MiniRect
  onNavigate: (world: { x: number; y: number }) => void
  width?: number
  height?: number
}

const NODE_FILL = '#7ec8e3'
const NODE_STROKE = '#2aa8a0'
const VIEW_STROKE = '#ff7eb6'

export const MiniMap: React.FC<Props> = ({ shapes, viewport, onNavigate, width = 180, height = 120 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    // 底
    ctx.fillStyle = '#f7fbfc'
    ctx.fillRect(0, 0, width, height)

    const model = buildMiniMapModel(shapes, viewport, width, height, 8)

    // 内容矩形
    ctx.fillStyle = NODE_FILL
    ctx.strokeStyle = NODE_STROKE
    ctx.lineWidth = 1
    for (const r of model.shapes) {
      const rr = Math.max(1.5, Math.min(r.w, 3))
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, Math.max(r.w, 2), Math.max(r.h, 2), rr)
      ctx.fill()
      ctx.stroke()
    }

    // 视口框
    ctx.strokeStyle = VIEW_STROKE
    ctx.lineWidth = 1.6
    ctx.setLineDash([])
    ctx.strokeRect(model.viewport.x, model.viewport.y, model.viewport.w, model.viewport.h)
  }, [shapes, viewport, width, height])

  const navigateFromEvent = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      // 按窗口实际 CSS 像素换算（不依赖截图坐标）
      const mx = ((e.clientX - rect.left) / rect.width) * width
      const my = ((e.clientY - rect.top) / rect.height) * height
      const model = buildMiniMapModel(shapes, viewport, width, height, 8)
      onNavigate(miniToWorld(mx, my, model.transform))
    },
    [shapes, viewport, width, height, onNavigate]
  )

  return (
    <div className="wls-minimap" data-testid="minimap">
      <canvas
        ref={canvasRef}
        className="wls-minimap-canvas"
        data-testid="minimap-canvas"
        style={{ width, height }}
        aria-label="画布小地图（点击或拖动跳转）"
        onPointerDown={(e) => {
          e.stopPropagation()
          setDragging(true)
          // 指针捕获失败（异常 pointerId）不得中断导航——包一层 try/catch
          try {
            ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          } catch {
            // ignore：无捕获时靠 pointermove/up 仍可拖动
          }
          navigateFromEvent(e)
        }}
        onPointerMove={(e) => {
          if (!dragging) return
          e.stopPropagation()
          navigateFromEvent(e)
        }}
        onPointerUp={(e) => {
          e.stopPropagation()
          setDragging(false)
          try {
            ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
          } catch {
            // ignore
          }
        }}
        onPointerLeave={() => setDragging(false)}
      />
      <span className="wls-minimap-hint">
        {shapes.length === 0 ? '空画布' : `${shapes.length} 节点`} · 点击/拖动跳转
      </span>
    </div>
  )
}
