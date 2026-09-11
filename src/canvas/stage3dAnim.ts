/**
 * D7 动作预设（CANVAS_PLAN.md §9 D7-②，骨骼动画增强）
 *
 * 复用内置素体（Quaternius Universal Animation Library，CC0）**内嵌的 45 个动画片段**，
 * 经 three 自带 `AnimationMixer` 播放——不引任何新重依赖（红线：不引新重依赖）。
 *
 * 诚实边界：
 * - 这些是**预演动作**（本地实时渲染），不是成片；UI 如实标注「预演动作 · 非成片」；
 * - 片段名以实际 GLB 为准（`Rig|Xxx_Loop` 命名，实测 45 个）；参考稿提到的「挥手 / 转身」
 *   在该 CC0 库里**不存在对应片段**，此处不伪造，改为提供库内真实存在的等价预演动作；
 * - 自定义导入模型若无同名片段，UI 如实禁用（播放失败不伪造）。
 *
 * 本模块为纯函数（node --test 可跑），不 import three/R3F。
 */

/** 动作预设 id（入 meta 契约的白名单枚举） */
export const STAGE3D_ANIM_IDS = [
  'idle',
  'walk',
  'jog',
  'sprint',
  'dance',
  'sit',
  'jump',
  'talk',
] as const
export type Stage3DAnimId = (typeof STAGE3D_ANIM_IDS)[number]

export type Stage3DAnimPreset = {
  id: Stage3DAnimId
  label: string
  /** GLB 内真实片段名（实测清单，改动需同步 public/models 模型） */
  clip: string
  hint: string
}

/** 动作预设库（全部来自内置素体内嵌片段，无外部资产） */
export const STAGE3D_ANIM_PRESETS: readonly Stage3DAnimPreset[] = [
  { id: 'idle', label: '待机', clip: 'Rig|Idle_Loop', hint: '站立呼吸循环' },
  { id: 'walk', label: '走路循环', clip: 'Rig|Walk_Loop', hint: '自然行走' },
  { id: 'jog', label: '慢跑循环', clip: 'Rig|Jog_Fwd_Loop', hint: '向前慢跑' },
  { id: 'sprint', label: '冲刺循环', clip: 'Rig|Sprint_Loop', hint: '全力冲刺' },
  { id: 'dance', label: '跳舞循环', clip: 'Rig|Dance_Loop', hint: '节奏舞动' },
  { id: 'sit', label: '坐姿待机', clip: 'Rig|Sitting_Idle_Loop', hint: '坐下待机（需自行落到座面）' },
  { id: 'jump', label: '跳跃循环', clip: 'Rig|Jump_Loop', hint: '原地起跳' },
  { id: 'talk', label: '交谈待机', clip: 'Rig|Idle_Talking_Loop', hint: '说话手势' },
]

const BY_ID = new Map(STAGE3D_ANIM_PRESETS.map((p) => [p.id, p]))

/** 动作 id → 真实片段名（未知/缺省返回 null = 不播放） */
export function animClipFor(id: string | undefined | null): string | null {
  if (!id) return null
  return BY_ID.get(id as Stage3DAnimId)?.clip ?? null
}

/** 动作 id → 中文标签（未知回退原值，UI 不空白） */
export function animLabelFor(id: string | undefined | null): string {
  if (!id) return ''
  return BY_ID.get(id as Stage3DAnimId)?.label ?? String(id)
}

/** 动作 id 是否在契约白名单内 */
export function isStage3DAnimId(id: unknown): id is Stage3DAnimId {
  return typeof id === 'string' && BY_ID.has(id as Stage3DAnimId)
}

/**
 * 在给定片段名集合中挑选可用的动作预设（UI 按模型实际能力如实启用/禁用）。
 * 自定义导入模型片段名不同 → 返回空数组，UI 如实提示「该模型无内置动作片段」。
 */
export function availableAnimPresets(clipNames: readonly string[]): Stage3DAnimPreset[] {
  const set = new Set(clipNames)
  return STAGE3D_ANIM_PRESETS.filter((p) => set.has(p.clip))
}
