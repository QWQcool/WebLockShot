/**
 * stage3d 节点 meta 契约（CANVAS_PLAN.md §9 D1，图7 3D 运镜台）
 *
 * 数据形状（meta.stage3d 键承载，与 asset meta / script meta 同模式：各 kind 独立 zod schema）：
 * - objects：摆台对象（素体角色 + 几何体占位），上限 50；
 * - cameras：相机机位（位置/朝向目标/FOV），上限 20（D1 只做添加，视角切换 D2）；
 * - env：环境配置（全景图 idbref 引用等）。
 *
 * 诚实边界：全程本地渲染 0 灵感币；非法 meta 整体拒绝不半渲染。
 * 本模块为纯函数（node --test 可跑），不 import three/R3F。
 */
import { z } from 'zod'
import { STAGE3D_ANIM_IDS } from './stage3dAnim.ts'

/** 8 色板（图7 右栏圆形色块，与画布设计 token 同源的克制色系） */
export const STAGE3D_PALETTE = [
  '#c06a38', // 素体默认（写实假人橙棕）
  '#39c5bb', // 初音青
  '#2aa8a0', // 深青
  '#ff7eb6', // 粉
  '#7ec8e3', // 天蓝
  '#f2c14e', // 暖黄
  '#8b7355', // 大地棕
  '#e8e6e3', // 浅灰白
] as const

export const STAGE3D_OBJECT_MAX = 50
export const STAGE3D_CAMERA_MAX = 20

/**
 * stage3d 节点 → 页面层打开运镜台的 window 事件名
 * （tldraw shapeUtils 静态注册拿不到外部 props，事件总线是既定解耦模式）
 */
export const STAGE3D_OPEN_EVENT = 'wls-open-stage3d'

/** 摆台对象类型：character = 素体（内置 Quaternius 或用户导入），其余为几何体占位 */
export const STAGE3D_OBJECT_TYPES = ['character', 'box', 'cylinder', 'sphere'] as const

export const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])

const stage3dObjectSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(STAGE3D_OBJECT_TYPES),
  name: z.string().min(1).max(60),
  position: vec3Schema,
  /** 欧拉角（弧度） */
  rotation: vec3Schema,
  scale: vec3Schema,
  /** 8 色板内的颜色值（白名单校验，防任意注入） */
  color: z.string(),
  /**
   * 素体模型来源：内置模型省略该字段；用户导入的模型为 IndexedDB 引用
   * （idbref://，经 assetStore 落档；blob: 拒绝入档——跨刷新失效）
   */
  modelRef: z
    .string()
    .refine((u) => u.startsWith('idbref://'), {
      message: '自定义模型引用只允许 idbref://（blob: 跨刷新失效，禁止入档）',
    })
    .optional(),
  /**
   * D2：预置姿势 id（引用 stage3dPose.ts 的骨骼旋转参数库，不存整份关节数据）。
   * 缺省 = rig 绑定姿势（T-Pose）。自定义模型无 DEF- 骨骼时 UI 如实禁用姿势切换。
   */
  pose: z.enum(['tpose', 'stand', 'sit', 'walk']).optional(),
  /**
   * D7：预演动作 id（引用 stage3dAnim.ts 的动画预设库 → 内置素体内嵌片段）。
   * 缺省 = 不播放动作（静态摆位/姿势）。播放期间姿势叠加暂停（避免骨骼冲突）。
   */
  anim: z.enum(STAGE3D_ANIM_IDS).optional(),
})

const stage3dCameraSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  position: vec3Schema,
  /** 注视目标点（lookAt），与 position 一起完整描述机位 */
  target: vec3Schema,
  /** 视场角（度，20~120） */
  fov: z.number().finite().min(20).max(120),
  /**
   * D2：运镜关键帧轨迹（结构化数据从第一天入库——D3 C 升级口）。
   * t 毫秒单调；上限 60 帧（契约层同步 STAGE3D_KEYFRAME_MAX）。
   */
  keyframes: z.array(
    z.object({
      t: z.number().finite().min(0),
      position: vec3Schema,
      target: vec3Schema,
      fov: z.number().finite().min(20).max(120),
    })
  ).max(60).optional(),
})

const stage3dEnvSchema = z.object({
  /** 全景图（equirectangular）引用：idbref://（经 assetStore 落档）或 http(s) 直链 */
  panoramaRef: z
    .string()
    .refine(
      (u) =>
        u.startsWith('idbref://') || u.startsWith('http://') || u.startsWith('https://'),
      {
        message: '全景图引用只允许 idbref:// 或 http(s) 直链（blob: 禁止入档）',
      }
    )
    .optional(),
  /**
   * D7：当前应用的场景预设 id（仅用于 UI 高亮「当前场景」；几何体本身已物化进 objects）。
   * 可选字段，老文档缺省仍合法（向后兼容）。
   */
  scenePreset: z.string().max(40).optional(),
})

export const stage3dMetaPayloadSchema = z.object({
  objects: z.array(stage3dObjectSchema).max(STAGE3D_OBJECT_MAX),
  cameras: z.array(stage3dCameraSchema).max(STAGE3D_CAMERA_MAX),
  env: stage3dEnvSchema,
})

export type Stage3DObject = z.infer<typeof stage3dObjectSchema>
export type Stage3DCamera = z.infer<typeof stage3dCameraSchema>
export type Stage3DEnv = z.infer<typeof stage3dEnvSchema>
export type Stage3DMetaPayload = z.infer<typeof stage3dMetaPayloadSchema>

export type Stage3DMetaCheck =
  | { ok: true; payload: Stage3DMetaPayload }
  | { ok: false; reason: string }

/** 读校验：非法/污染（任意 color 不在 8 色板）整体拒绝，返回中文原因 */
export function readStage3DMetaPayload(meta: unknown): Stage3DMetaCheck {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { ok: false, reason: 'stage3d meta 缺失或形状不合法' }
  }
  const parsed = stage3dMetaPayloadSchema.safeParse(meta)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue && issue.path.length > 0 ? issue.path.join('.') : ''
    return {
      ok: false,
      reason: `3D 摆台数据不合法${path ? `（字段 ${path}）` : ''}：${issue?.message ?? '未知错误'}`,
    }
  }
  const palette = STAGE3D_PALETTE as readonly string[]
  const badColor = parsed.data.objects.find((o) => !palette.includes(o.color))
  if (badColor) {
    return { ok: false, reason: `对象「${badColor.name}」的颜色不在 8 色板白名单内` }
  }
  const ids = new Set(parsed.data.objects.map((o) => o.id))
  if (ids.size !== parsed.data.objects.length) {
    return { ok: false, reason: '摆台对象 id 重复' }
  }
  const camIds = new Set(parsed.data.cameras.map((c) => c.id))
  if (camIds.size !== parsed.data.cameras.length) {
    return { ok: false, reason: '机位 id 重复' }
  }
  return { ok: true, payload: parsed.data }
}

/** 空场景（新增 stage3d 节点默认值：无对象无机位） */
export function createEmptyStage3DPayload(): Stage3DMetaPayload {
  return { objects: [], cameras: [], env: {} }
}

/**
 * 写合并（纯函数）：返回可直接入 meta 的新对象；校验失败返回 null（诚实拒写）。
 * 约定 stage3d 数据存 meta.stage3d 键（节点其余 meta 键不受影响）。
 */
export function writeStage3DMetaPayload(
  baseMeta: Record<string, unknown>,
  payload: Stage3DMetaPayload
): Record<string, unknown> | null {
  const check = readStage3DMetaPayload(payload)
  if (!check.ok) return null
  return { ...baseMeta, stage3d: check.payload }
}

/** 新对象 id（确定性前缀 + 随机尾，与 createNodeId 同风格） */
export function createStage3DObjectId(): string {
  return `s3o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createStage3DCameraId(): string {
  return `s3c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 默认素体对象（纯函数）：角色站在原点，scale = 用户倍率（1 = 模型自归一高度）。
 * 内置 Quaternius 模型在渲染层按包围盒自动归一至约 1.8 单位高（与网格地面尺度匹配），
 * 数据契约中的 scale 不承担模型原始尺寸换算（D2 姿势库同基准）。
 */
export function createDefaultCharacterPayload(name = '素体角色'): Stage3DObject {
  return {
    id: createStage3DObjectId(),
    type: 'character',
    name,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: STAGE3D_PALETTE[0],
  }
}

export function createPrimitivePayload(
  type: 'box' | 'cylinder' | 'sphere',
  name: string,
  position: [number, number, number] = [1.5, 0, 0]
): Stage3DObject {
  const label = type === 'box' ? '方块' : type === 'cylinder' ? '圆柱' : '球体'
  return {
    id: createStage3DObjectId(),
    type,
    name: name.trim().slice(0, 60) || label,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: STAGE3D_PALETTE[4],
  }
}
