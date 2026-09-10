/**
 * 预置姿势库（CANVAS_PLAN.md §9 D2「姿势 tab」，骨骼旋转参数化）
 *
 * rig 基准：Quaternius Universal Animation Library 通用角色（Blender metarig 导出，
 * DEF- 前缀，53 骨）。姿势 = 关节旋转集（弧度欧拉）纯数据——「不做骨骼动画手动编辑」
 * 边界不破：姿势切换 = 一次性应用一组参数，非动画系统。
 *
 * 标定方式：实机对 DEF- rig 逐关节旋转截图迭代（D1 Spike 的 Mixamo 轴向结论不适用
 * ——rig 不同，符号/轴向按 Blender 导出重新标定）。
 * 未知/缺失骨骼（用户导入的自定义模型）：apply 时按骨骼名匹配，无匹配骨骼跳过。
 */

export type Stage3DPoseId = 'tpose' | 'stand' | 'sit' | 'walk'

export const STAGE3D_POSE_IDS: Stage3DPoseId[] = ['tpose', 'stand', 'sit', 'walk']

export const STAGE3D_POSE_LABELS: Record<Stage3DPoseId, string> = {
  tpose: 'T-Pose（默认）',
  stand: '站立',
  sit: '坐姿',
  walk: '行走',
}

/** 关节旋转集：骨骼名 → 欧拉角（弧度，XYZ 序，与 three Object3D.rotation 同语义） */
export type Stage3DPoseJoints = Record<string, [number, number, number]>

/** 度 → 弧度（标定数据用度书写，可读性好） */
const deg = (d: number): number => (d * Math.PI) / 180

/**
 * 预置姿势库（实机标定值，弧度存储）。
 * - tpose：空旋转集（rig 绑定姿势即 T-pose，应用 = 复位全部关节）；
 * - stand：手臂自然下垂（upper_arm 绕臂轴下压约 65°）+ 前臂微屈；
 * - sit：大腿前抬 90°、小腿下垂 90°（臀部下降由对象 position 承担）；
 * - walk：双腿前后分立 + 双臂反向摆动 + 躯干微转。
 */
export const STAGE3D_POSE_PRESETS: Record<Stage3DPoseId, Stage3DPoseJoints> = {
  tpose: {},
  stand: {
    'DEF-upper_arm.L': [0, 0, deg(-62)],
    'DEF-upper_arm.R': [0, 0, deg(-62)],
    'DEF-forearm.L': [0, deg(-8), 0],
    'DEF-forearm.R': [0, deg(8), 0],
  },
  sit: {
    'DEF-thigh.L': [deg(-88), 0, deg(6)],
    'DEF-thigh.R': [deg(-88), 0, deg(-6)],
    'DEF-shin.L': [deg(84), 0, 0],
    'DEF-shin.R': [deg(84), 0, 0],
    'DEF-upper_arm.L': [0, 0, deg(-58)],
    'DEF-upper_arm.R': [0, 0, deg(-58)],
    'DEF-forearm.L': [deg(-42), 0, 0],
    'DEF-forearm.R': [deg(-42), 0, 0],
  },
  walk: {
    'DEF-thigh.L': [deg(24), 0, 0],
    'DEF-thigh.R': [deg(-20), 0, 0],
    'DEF-shin.L': [deg(-18), 0, 0],
    'DEF-shin.R': [deg(14), 0, 0],
    'DEF-upper_arm.L': [0, 0, deg(-55)],
    'DEF-upper_arm.R': [0, 0, deg(-55)],
    'DEF-forearm.L': [deg(22), 0, 0],
    'DEF-forearm.R': [deg(-22), 0, 0],
    'DEF-spine.002': [0, deg(6), 0],
  },
}

/** 校验姿势 id（zod 用枚举；纯函数供非 zod 场景） */
export function isStage3DPoseId(v: unknown): v is Stage3DPoseId {
  return typeof v === 'string' && (STAGE3D_POSE_IDS as string[]).includes(v)
}

/**
 * 骨骼名归一（复刻 three GLTFLoader PropertyBinding.sanitizeNodeName 规则：
 * 空格→下划线，`[ ] . : /` 字符删除）。GLB 里 "DEF-thigh.L" 运行时实际叫 "DEF-thighL"，
 * 姿势库按原始名书写、应用时对双侧归一匹配——纯函数，node --test 可测。
 */
export function sanitizeBoneName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[[\].:/\\]/g, '')
}
