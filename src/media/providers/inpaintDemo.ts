/**
 * 演示重绘（CANVAS_PLAN.md §9 A2 离线兜底）：
 * 无 ComfyUI 时按 mask 区域做客户端可见色彩变换，产物必须标注
 * 「🧪 演示重绘 · 非真实生成」——绝不静默伪造真实生成。
 *
 * 核心为纯函数 demoInpaintPixels（node --test 可跑，不依赖 Canvas）：
 * - mask 白色区域（按块聚合）做「色调偏移 + 马赛克」两级可见变换；
 * - 变换 = 块内平均色 RGB 通道轮换（R,G,B → G,B,R），保证与原图肉眼可辨；
 * - 确定性：无随机数，同输入必同输出（与项目「本地重放逐像素一致」传统对齐）。
 */

/** RGB 通道轮换：让重绘区与源图肉眼可辨的确定性色彩变换 */
export function shiftChannels(r: number, g: number, b: number): [number, number, number] {
  return [g, b, r]
}

/**
 * 按块处理像素：
 * @param rgba 源图像素（就地修改，RGBA）
 * @param mask 与源图同尺寸的 mask 像素（白色笔画；按 alpha>0 判定重绘区）
 * @param w/h 尺寸
 * @param block 马赛克块边长 px（默认 8）
 */
export function demoInpaintPixels(
  rgba: Uint8ClampedArray,
  mask: Uint8ClampedArray | null,
  w: number,
  h: number,
  block = 8
): void {
  const size = w * h
  if (rgba.length < size * 4) return

  // mask 缺失或全空：不处理（诚实：没涂 mask 就没有"重绘区"）
  let maskPainted = mask !== null
  if (mask) {
    maskPainted = false
    for (let i = 3; i < mask.length; i += 4) {
      if (mask[i] > 0) {
        maskPainted = true
        break
      }
    }
  }
  if (!maskPainted) return

  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      // 块内统计：mask 覆盖像素数 + 源色平均
      let covered = 0
      let sr = 0
      let sg = 0
      let sb = 0
      const yEnd = Math.min(by + block, h)
      const xEnd = Math.min(bx + block, w)
      for (let y = by; y < yEnd; y++) {
        for (let x = bx; x < xEnd; x++) {
          const p = (y * w + x) * 4
          if (mask && mask[p + 3] > 0) {
            covered++
            sr += rgba[p]
            sg += rgba[p + 1]
            sb += rgba[p + 2]
          }
        }
      }
      if (covered === 0) continue
      const [tr, tg, tb] = shiftChannels(
        Math.round(sr / covered),
        Math.round(sg / covered),
        Math.round(sb / covered)
      )
      // 块内所有 mask 覆盖像素统一替换为马赛克块色（未覆盖像素保持原样）
      for (let y = by; y < yEnd; y++) {
        for (let x = bx; x < xEnd; x++) {
          const p = (y * w + x) * 4
          if (mask && mask[p + 3] > 0) {
            rgba[p] = tr
            rgba[p + 1] = tg
            rgba[p + 2] = tb
          }
        }
      }
    }
  }
}
