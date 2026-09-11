/**
 * D9 小地图几何（CANVAS_PLAN.md §9 D9-①）
 *
 * 纯函数：内容包围盒 → 小地图变换（等比缩放 + 居中）→ 世界坐标 ↔ 小地图坐标互转。
 * 供 MiniMap 组件绘制缩略图与视口框，并把点击/拖动坐标反算回世界坐标（居中导航）。
 *
 * node --test 可跑，不 import React / tldraw。
 */

export type MiniRect = { x: number; y: number; w: number; h: number }
export type MiniBounds = { minX: number; minY: number; maxX: number; maxY: number }

export type MiniTransform = {
  scale: number
  offsetX: number
  offsetY: number
  bounds: MiniBounds
}

/** 多个矩形的最小包围盒（空数组 → null） */
export function boundsOfRects(rects: MiniRect[]): MiniBounds | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { minX, minY, maxX, maxY }
}

export function unionBounds(a: MiniBounds, b: MiniBounds): MiniBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function padBounds(b: MiniBounds, pad: number): MiniBounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }
}

/** 内容宽度（至少 1，防除零） */
export function boundsWidth(b: MiniBounds): number {
  return Math.max(1, b.maxX - b.minX)
}
export function boundsHeight(b: MiniBounds): number {
  return Math.max(1, b.maxY - b.minY)
}

/**
 * 计算小地图变换：等比缩放内容适配到 miniW×miniH（留 padding），并居中。
 * scale 上限 1（内容很小时不放大到失真，避免「一个节点占满小地图」）。
 */
export function computeTransform(
  bounds: MiniBounds,
  miniW: number,
  miniH: number,
  padding = 8
): MiniTransform {
  const bw = boundsWidth(bounds)
  const bh = boundsHeight(bounds)
  const availW = Math.max(1, miniW - padding * 2)
  const availH = Math.max(1, miniH - padding * 2)
  const scale = Math.min(1, availW / bw, availH / bh)
  const drawnW = bw * scale
  const drawnH = bh * scale
  return {
    scale,
    offsetX: padding + (availW - drawnW) / 2,
    offsetY: padding + (availH - drawnH) / 2,
    bounds,
  }
}

/** 世界坐标 → 小地图坐标 */
export function worldToMini(x: number, y: number, t: MiniTransform): { x: number; y: number } {
  return {
    x: (x - t.bounds.minX) * t.scale + t.offsetX,
    y: (y - t.bounds.minY) * t.scale + t.offsetY,
  }
}

/** 小地图坐标 → 世界坐标（点击/拖动导航用） */
export function miniToWorld(mx: number, my: number, t: MiniTransform): { x: number; y: number } {
  return {
    x: (mx - t.offsetX) / t.scale + t.bounds.minX,
    y: (my - t.offsetY) / t.scale + t.bounds.minY,
  }
}

/** 世界矩形 → 小地图矩形（最小可见尺寸 2px，保证视口框在小地图上看得见） */
export function rectToMini(r: MiniRect, t: MiniTransform, minSize = 2): MiniRect {
  const p = worldToMini(r.x, r.y, t)
  return {
    x: p.x,
    y: p.y,
    w: Math.max(minSize, r.w * t.scale),
    h: Math.max(minSize, r.h * t.scale),
  }
}

/**
 * 组装小地图绘制数据：内容矩形 + 视口矩形 + 变换。
 * 内容为空时用视口本身作为内容（小地图仍有意义：显示当前位置）。
 */
export function buildMiniMapModel(
  shapeRects: MiniRect[],
  viewportRect: MiniRect,
  miniW: number,
  miniH: number,
  padding = 8
): { transform: MiniTransform; shapes: MiniRect[]; viewport: MiniRect } {
  const content = boundsOfRects(shapeRects)
  const withViewport = content
    ? unionBounds(content, {
        minX: viewportRect.x,
        minY: viewportRect.y,
        maxX: viewportRect.x + viewportRect.w,
        maxY: viewportRect.y + viewportRect.h,
      })
    : {
        minX: viewportRect.x,
        minY: viewportRect.y,
        maxX: viewportRect.x + viewportRect.w,
        maxY: viewportRect.y + viewportRect.h,
      }
  const transform = computeTransform(padBounds(withViewport, 40), miniW, miniH, padding)
  return {
    transform,
    shapes: shapeRects.map((r) => rectToMini(r, transform)),
    viewport: rectToMini(viewportRect, transform),
  }
}
