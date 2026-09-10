/**
 * D3 出片衔接契约（CANVAS_PLAN.md §6.2 / §9 D3，图7 语义）。
 *
 * 三条衔接通道共用同一份「机位帧序列」导出物：
 * - 每机位 = { 渲染首帧图, 渲染尾帧图, 相机参数 position/target/fov, 运镜轨迹结构化数据, 运镜文字描述 }；
 * - **B 口**：单机位首尾帧 + 运镜文字 → generate 节点「3D 单镜直出」（参考底图 + 文字，演示引擎）；
 * - **D 口**：多机位帧整组 → storyboard 节点「3D 台自由分镜」（镜数 = 机位数，1~12 不伪造不截断）；
 * - **C 升级口**：keyframes 轨迹结构化数据随帧入契约（不丢信息，未来 Provider 放开运动控制 API 时升级）。
 *
 * 诚实边界：
 * - 渲染帧大资产只允许 idbref:// / http(s)（blob: 跨刷新失效，禁止入档）；
 * - 自由分镜镜数超过 12 时**诚实拒绝**（不截断不伪造），由调用方如实提示；
 * - 本模块为纯函数（node --test 可跑），不 import three/R3F，也不 import tldraw。
 */
import { z } from 'zod'
import { VisualPlanSchema, type VisualPlan } from '../domain/sellVisual.ts'
import { STAGE3D_CAMERA_MAX, vec3Schema, type Stage3DCamera } from './stage3dMeta.ts'
import {
  keyframesDuration,
  normalizeKeyframes,
  stage3dKeyframeSchema,
  type Stage3DKeyframe,
} from './stage3dKeyframes.ts'

/** 自由分镜（canvas 原生）镜数上限：镜数 = 机位数，超出诚实拒绝（不截断不伪造） */
export const STAGE3D_SHOT_PLAN_MAX = 12

/** 帧图引用：idbref://（IndexedDB）或 http(s) 直链；blob: 禁止入档 */
const persistentRefSchema = z.string().refine(
  (u) => u.startsWith('idbref://') || u.startsWith('http://') || u.startsWith('https://'),
  { message: '帧图引用只允许 idbref:// 或 http(s) 直链（blob: 跨刷新失效，禁止入档）' }
)

/** 相机姿态（与 stage3dMeta 的机位参数同形状） */
export const cameraPoseSchema = z.object({
  position: vec3Schema,
  target: vec3Schema,
  fov: z.number().finite().min(20).max(120),
})
export type CameraPose = z.infer<typeof cameraPoseSchema>

/**
 * 单机位帧记录（导出物最小单元）：
 * - firstFrameRef / lastFrameRef = 轨迹首/尾帧渲染图（无关键帧时二者同值 = 固定机位）；
 * - camera = 机位起始参数（首帧姿态）；
 * - keyframes = 运镜轨迹结构化数据（C 升级口，缺省=固定机位）；
 * - motionText = 运镜文字描述（确定性生成，供图生视频提示词使用）。
 */
export const stage3dCameraFrameSchema = z.object({
  cameraId: z.string().min(1).max(64),
  cameraName: z.string().min(1).max(60),
  firstFrameRef: persistentRefSchema,
  lastFrameRef: persistentRefSchema,
  camera: cameraPoseSchema,
  keyframes: z.array(stage3dKeyframeSchema).max(60).optional(),
  motionText: z.string().max(200),
})
export type Stage3DCameraFrame = z.infer<typeof stage3dCameraFrameSchema>

/** 机位帧序列（导出物整体）：每机位一帧记录，上限 = 机位上限 */
export const stage3dFrameSequenceSchema = z.object({
  version: z.literal(1),
  frames: z.array(stage3dCameraFrameSchema).min(1).max(STAGE3D_CAMERA_MAX),
  exportedAt: z.number().finite().positive(),
})
export type Stage3DFrameSequence = z.infer<typeof stage3dFrameSequenceSchema>

export type Stage3DFrameSequenceCheck =
  | { ok: true; sequence: Stage3DFrameSequence }
  | { ok: false; reason: string }

/** 距离（纯函数）：相机位置到注视目标的距离 */
function distToTarget(pose: CameraPose): number {
  const [px, py, pz] = pose.position
  const [tx, ty, tz] = pose.target
  return Math.sqrt((px - tx) ** 2 + (py - ty) ** 2 + (pz - tz) ** 2)
}

const round1 = (v: number): number => Math.round(v * 10) / 10

/**
 * 运镜文字描述（确定性纯函数）：由关键帧轨迹推导「推近/拉远/横移 + 变焦 + 时长 + 帧数」，
 * 无关键帧时如实描述为固定机位。用于 B 口图生视频提示词与 D 口每镜运镜文字。
 */
export function describeCameraMotion(camera: Stage3DCamera): string {
  const kfs = normalizeKeyframes(camera.keyframes ?? [])
  if (kfs.length < 2) {
    return `「${camera.name}」固定机位 · FOV ${round1(camera.fov)}°`
  }
  const first = kfs[0]
  const last = kfs[kfs.length - 1]
  const duration = last.t - first.t
  const d0 = distToTarget({ position: first.position, target: first.target, fov: first.fov })
  const d1 = distToTarget({ position: last.position, target: last.target, fov: last.fov })
  let move: string
  if (d1 < d0 - 0.05) move = `推近（距离 ${round1(d0)}→${round1(d1)}）`
  else if (d1 > d0 + 0.05) move = `拉远（距离 ${round1(d0)}→${round1(d1)}）`
  else {
    const dx = last.position[0] - first.position[0]
    const dy = last.position[1] - first.position[1]
    const dz = last.position[2] - first.position[2]
    const travel = Math.sqrt(dx * dx + dy * dy + dz * dz)
    move = travel < 0.05 ? '定点环绕' : '横移/环绕'
  }
  let zoom = ''
  if (last.fov < first.fov - 0.5) zoom = ` · 变焦收窄 FOV ${round1(first.fov)}°→${round1(last.fov)}°`
  else if (last.fov > first.fov + 0.5) zoom = ` · 变焦放宽 FOV ${round1(first.fov)}°→${round1(last.fov)}°`
  return `「${camera.name}」${move}${zoom} · 时长 ${duration}ms · ${kfs.length} 个关键帧`
}

/**
 * 组装单机位帧记录（纯函数）：把机位参数 + 已渲染的首/尾帧引用 + 轨迹快照归一为契约记录。
 * 轨迹经 normalizeKeyframes 排序去重后入库（C 升级口不丢信息）。
 */
export function buildCameraFrame(
  camera: Stage3DCamera,
  firstFrameRef: string,
  lastFrameRef: string
): Stage3DCameraFrame {
  const kfs = normalizeKeyframes(camera.keyframes ?? [])
  return {
    cameraId: camera.id,
    cameraName: camera.name,
    firstFrameRef,
    lastFrameRef,
    camera: { position: camera.position, target: camera.target, fov: camera.fov },
    ...(kfs.length > 0 ? { keyframes: kfs } : {}),
    motionText: describeCameraMotion(camera),
  }
}

/** 机位帧序列整体校验（整体拒绝，不半渲染）：空序列 / 非法引用 → 中文原因 */
export function buildStage3DFrameSequence(
  frames: Stage3DCameraFrame[],
  exportedAt: number = Date.now()
): Stage3DFrameSequenceCheck {
  if (frames.length === 0) {
    return { ok: false, reason: '没有可导出的机位帧：请先在「＋ 新增机位」添加机位并调好视角' }
  }
  const parsed = stage3dFrameSequenceSchema.safeParse({ version: 1, frames, exportedAt })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue && issue.path.length > 0 ? issue.path.join('.') : ''
    return {
      ok: false,
      reason: `机位帧序列不合法${path ? `（字段 ${path}）` : ''}：${issue?.message ?? '未知错误'}`,
    }
  }
  return { ok: true, sequence: parsed.data }
}

/**
 * 读取 stage3d 节点导出物（meta.stage3dFrames）。
 * 缺失 / 非法返回 null（下游 generate/storyboard 沿边读取，非法不半渲染）。
 */
export function readStage3DFrameSequence(meta: unknown): Stage3DFrameSequence | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const raw = (meta as Record<string, unknown>).stage3dFrames
  const parsed = stage3dFrameSequenceSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** 写入导出物（校验失败返回 null 拒写；其余 meta 键不受影响） */
export function writeStage3DFrameSequence(
  baseMeta: Record<string, unknown>,
  sequence: Stage3DFrameSequence
): Record<string, unknown> | null {
  const parsed = stage3dFrameSequenceSchema.safeParse(sequence)
  if (!parsed.success) return null
  return { ...baseMeta, stage3dFrames: parsed.data }
}

/* ------------------------------------------------------------------ *
 * D 口：canvas 原生自由镜数分镜契约（镜数 = 机位数，1~12）
 * ------------------------------------------------------------------ */

/**
 * 自由分镜单镜（canvas 契约，非 sell 6 镜契约）：
 * frameRef = 该机位首帧渲染图；camera = 机位参数；motionText = 运镜文字；
 * keyframes = 轨迹结构化数据（C 升级口）；lastFrameRef = 尾帧图（可选，图生视频备用）。
 */
export const canvasShotSchema = z.object({
  frameRef: persistentRefSchema,
  lastFrameRef: persistentRefSchema.optional(),
  camera: cameraPoseSchema,
  motionText: z.string().max(200),
  keyframes: z.array(stage3dKeyframeSchema).max(60).optional(),
})
export type CanvasShot = z.infer<typeof canvasShotSchema>

/** canvas 自由镜数分镜：shots 1~12，镜数 = 机位数（不伪造不截断） */
export const canvasShotPlanSchema = z.object({
  shots: z.array(canvasShotSchema).min(1).max(STAGE3D_SHOT_PLAN_MAX),
})
export type CanvasShotPlan = z.infer<typeof canvasShotPlanSchema>

export type ShotPlanCheck =
  | { ok: true; plan: CanvasShotPlan }
  | { ok: false; reason: string }

/**
 * 机位帧序列 → 自由分镜（纯函数）：镜数严格 = 机位数。
 * 机位数 > STAGE3D_SHOT_PLAN_MAX 时**诚实拒绝**（不截断不伪造）。
 */
export function frameSequenceToShotPlan(sequence: Stage3DFrameSequence): ShotPlanCheck {
  const frames = sequence.frames
  if (frames.length === 0) {
    return { ok: false, reason: '机位帧序列为空：请先在 3D 运镜台导出机位帧' }
  }
  if (frames.length > STAGE3D_SHOT_PLAN_MAX) {
    return {
      ok: false,
      reason: `机位数 ${frames.length} 超过自由分镜上限 ${STAGE3D_SHOT_PLAN_MAX}：请精简机位后重新导出（不截断不伪造）`,
    }
  }
  const shots: CanvasShot[] = frames.map((f) => ({
    frameRef: f.firstFrameRef,
    ...(f.lastFrameRef !== f.firstFrameRef ? { lastFrameRef: f.lastFrameRef } : {}),
    camera: f.camera,
    motionText: f.motionText,
    ...(f.keyframes && f.keyframes.length > 0 ? { keyframes: f.keyframes } : {}),
  }))
  const parsed = canvasShotPlanSchema.safeParse({ shots })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, reason: `自由分镜不合法：${issue?.message ?? '未知错误'}` }
  }
  return { ok: true, plan: parsed.data }
}

/** storyboard 节点「3D 台自由分镜」来源模式的 meta 载荷（与 script 6 镜模式互斥） */
export const shotPlanMetaPayloadSchema = z.object({
  shotPlan: canvasShotPlanSchema,
  /** 导出时上游帧序列的摘要指纹（djb2），用于「上游机位已更新」提示 */
  stage3dDigest: z.string(),
  /** 来源展示文案（如「3D 台自由分镜 · 4 机位」） */
  stage3dSource: z.string().max(200),
})
export type ShotPlanMetaPayload = z.infer<typeof shotPlanMetaPayloadSchema>

/** 读取：从 shape meta 解析自由分镜（缺失/非法返回 null，不半渲染） */
export function readShotPlanMetaPayload(meta: unknown): ShotPlanMetaPayload | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const parsed = shotPlanMetaPayloadSchema.safeParse(meta)
  return parsed.success ? parsed.data : null
}

/**
 * 写入：自由分镜经 zod 校验后合并进 meta（校验失败返回 null 拒写）。
 * 来源互斥：写入时剔除 script→6 镜模式的痕迹键（story / scriptDigest / scriptLogline）。
 */
export function writeShotPlanMetaPayload(
  baseMeta: Record<string, unknown>,
  payload: ShotPlanMetaPayload
): Record<string, unknown> | null {
  const parsed = shotPlanMetaPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  const cleaned = { ...baseMeta }
  delete cleaned.story
  delete cleaned.scriptDigest
  delete cleaned.scriptLogline
  return { ...cleaned, ...parsed.data }
}

/* ------------------------------------------------------------------ *
 * B 口：单机位 → generate 单镜直出（参考底图 + 运镜文字）
 * ------------------------------------------------------------------ */

/** 3D 单镜直出产物的固定镜号（generate meta.artifacts.shotId / 产物卡 shotId 共用） */
export const STAGE3D_DIRECT_SHOT_ID = 'stage3d-s1'

/**
 * 3D 单镜直出演示计划（纯函数，node --test 可跑）：
 * 以机位首帧渲染图作参考底图（image2video）、运镜文字作提示词，走 Mock/演示引擎单镜出片
 * （UI 必须标注「3D 单镜直出 · 演示引擎」）。
 * referenceImage 可为 idbref 水合后的 blob objectURL 或 http(s) 直链；缺省时退化为 text2video。
 */
export function buildStage3dDirectPlan(frame: Stage3DCameraFrame, referenceImage?: string): VisualPlan {
  const prompt = `${frame.cameraName}：${frame.motionText}`
  const ref = referenceImage?.trim()
  return VisualPlanSchema.parse({
    shotId: STAGE3D_DIRECT_SHOT_ID,
    order: 1,
    kind: ref ? 'image2video' : 'text2video',
    positive: prompt.slice(0, 400),
    caption: frame.cameraName.slice(0, 40),
    durationSec: 3,
    ...(ref ? { referenceImage: ref } : {}),
  })
}

/** 帧序列摘要指纹（djb2，纯函数）：上游机位/轨迹任何变化都会改变指纹，驱动「重新生成」提示 */
export function stage3dFramesDigest(sequence: Stage3DFrameSequence): string {
  let hash = 5381
  for (const ch of JSON.stringify(sequence)) {
    hash = ((hash << 5) + hash + ch.charCodeAt(0)) | 0
  }
  return (hash >>> 0).toString(36)
}

/** 来源展示文案（纯函数）：供 storyboard 节点如实标注「镜数 = 机位数」 */
export function describeShotPlanSource(sequence: Stage3DFrameSequence): string {
  return `3D 台自由分镜 · ${sequence.frames.length} 机位（镜数=机位数）`
}

/** 关键帧轨迹时长（转发，供 Studio 导出时取尾帧 t） */
export { keyframesDuration }
export type { Stage3DKeyframe }
