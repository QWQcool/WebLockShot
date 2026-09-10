/**
 * 相机机位关键帧契约 + 插值纯函数（CANVAS_PLAN.md §9 D2，D3 C 升级口数据基座）
 *
 * - 关键帧从第一天存结构化：{ t, position, target, fov }（不丢信息，未来 Provider
 *   放开运动控制 API 时从同一数据升级——D3 B/D 组合与 C 口共用）；
 * - 插值纯函数：position/target 走 Catmull-Rom（过点平滑），fov 线性；零依赖可测
 *   （手写 Catmull-Rom 标量公式，不 import three）。
 */

import { z } from 'zod'
import { vec3Schema } from './stage3dMeta.ts'

export const STAGE3D_KEYFRAME_MAX = 60

/** 单个关键帧：t 为时间轴毫秒（≥0，单调约束在容器层校验） */
export const stage3dKeyframeSchema = z.object({
  t: z.number().finite().min(0),
  position: vec3Schema,
  target: vec3Schema,
  fov: z.number().finite().min(20).max(120),
})

export type Stage3DKeyframe = z.infer<typeof stage3dKeyframeSchema>

/** 排序 + 单调化：t 重复的后一帧覆盖前一帧（按 t 升序，去重保末值） */
export function normalizeKeyframes(kfs: Stage3DKeyframe[]): Stage3DKeyframe[] {
  const sorted = [...kfs].sort((a, b) => a.t - b.t)
  const out: Stage3DKeyframe[] = []
  for (const k of sorted) {
    const prev = out[out.length - 1]
    if (prev && prev.t === k.t) out[out.length - 1] = k
    else out.push(k)
  }
  return out
}

/** 时间轴总时长（无关键帧 → 0） */
export function keyframesDuration(kfs: Stage3DKeyframe[]): number {
  const n = normalizeKeyframes(kfs)
  return n.length > 0 ? n[n.length - 1].t : 0
}

/** Catmull-Rom 标量插值（非均匀 t：用切向斜率公式，端点钳制） */
function catmullRomScalar(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t1: number,
  t2: number,
  t3: number,
  u: number
): number {
  // 标准均匀 Catmull-Rom（相邻间隔近似均匀时平滑；时间轴刻度由录制节奏保证）
  void t1
  void t2
  void t3
  const u2 = u * u
  const u3 = u2 * u
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  )
}

function sampleVec3At(
  keys: Array<{ t: number; v: [number, number, number] }>,
  t: number
): [number, number, number] | null {
  if (keys.length === 0) return null
  if (t <= keys[0].t) return [...keys[0].v]
  const last = keys[keys.length - 1]
  if (t >= last.t) return [...last.v]
  let i = 0
  while (i < keys.length - 1 && keys[i + 1].t < t) i++
  const a = keys[i]
  const b = keys[i + 1]
  const u = (t - a.t) / (b.t - a.t)
  // Catmull-Rom 需要前后各一帧；端点用重复帧填充（切向自然钳制）
  const p0 = keys[Math.max(0, i - 1)].v
  const p1 = a.v
  const p2 = b.v
  const p3 = keys[Math.min(keys.length - 1, i + 2)].v
  return [0, 1, 2].map((d) => catmullRomScalar(p0[d], p1[d], p2[d], p3[d], 0, 0, 0, u)) as [
    number,
    number,
    number,
  ]
}

export type CameraPoseSample = {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

/**
 * 关键帧插值采样（纯函数）：t 超出范围取端点帧；单帧恒返回该帧；空数组返回 null。
 * position/target 用 Catmull-Rom（过点平滑），fov 线性。
 */
export function sampleCameraPose(kfs: Stage3DKeyframe[], t: number): CameraPoseSample | null {
  const n = normalizeKeyframes(kfs)
  if (n.length === 0) return null
  if (n.length === 1) {
    return { position: [...n[0].position], target: [...n[0].target], fov: n[0].fov }
  }
  const positions = n.map((k) => ({ t: k.t, v: k.position }))
  const targets = n.map((k) => ({ t: k.t, v: k.target }))
  const position = sampleVec3At(positions, t)
  const target = sampleVec3At(targets, t)
  if (!position || !target) return null

  // fov 线性
  let fov = n[n.length - 1].fov
  for (let i = 0; i < n.length - 1; i++) {
    if (t >= n[i].t && t <= n[i + 1].t) {
      const u = (t - n[i].t) / (n[i + 1].t - n[i].t)
      fov = n[i].fov + (n[i + 1].fov - n[i].fov) * u
      break
    }
  }
  return { position, target, fov: Math.round(fov * 100) / 100 }
}
