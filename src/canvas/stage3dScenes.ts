/**
 * D7 场景预设（CANVAS_PLAN.md §9 D7-①，程序化场景）
 *
 * 六套程序化场景（商品台 / 影棚 / 客厅 / 卧室 / 户外台阶 / 展台），**全部由代码生成的
 * primitive 组合而成（box / cylinder / sphere），零外部资产**——不引入任何模型/贴图文件。
 *
 * 应用语义：替换画布上的**几何体**（box/cylinder/sphere），**保留素体角色**（character）——
 * 用户摆好的人物不会被场景切换清掉；结果写入 meta.stage3d.objects，随画布持久化。
 *
 * 诚实边界：这些是**预演布景**（本地实时渲染 0 灵感币），不是成片；比例按网格地面（1 单位 ≈ 1 米）
 * 取近似值，仅供构图预演。
 *
 * 本模块为纯函数（node --test 可跑），不 import three/R3F。
 */
import {
  STAGE3D_OBJECT_MAX,
  STAGE3D_PALETTE,
  createStage3DObjectId,
  type Stage3DObject,
} from './stage3dMeta.ts'

type PrimKind = 'box' | 'cylinder' | 'sphere'

/** primitive 规格（几何体基础尺寸：box 0.8³ / cylinder r0.4 h1 / sphere r0.5，scale 为倍率） */
type PrimSpec = {
  kind: PrimKind
  name: string
  position: [number, number, number]
  scale?: [number, number, number]
  rotation?: [number, number, number]
  color: string
}

export const STAGE3D_SCENE_PRESET_IDS = [
  'product-podium',
  'studio',
  'living-room',
  'bedroom',
  'outdoor-steps',
  'exhibition',
] as const
export type Stage3DScenePresetId = (typeof STAGE3D_SCENE_PRESET_IDS)[number]

export type Stage3DScenePreset = {
  id: Stage3DScenePresetId
  label: string
  hint: string
  specs: readonly PrimSpec[]
}

const P = STAGE3D_PALETTE

/** 六套程序化场景（全部 primitive，代码生成） */
export const STAGE3D_SCENE_PRESETS: readonly Stage3DScenePreset[] = [
  {
    id: 'product-podium',
    label: '商品台',
    hint: '圆形展台 + 背景板 + 顶部点缀',
    specs: [
      { kind: 'cylinder', name: '展台底座', position: [0, 0.25, 0], scale: [1.5, 0.5, 1.5], color: P[7] },
      { kind: 'box', name: '背景板', position: [0, 1.6, -1.6], scale: [5, 4, 0.25], color: P[7] },
      { kind: 'sphere', name: '展品占位', position: [0, 0.85, 0], scale: [0.7, 0.7, 0.7], color: P[3] },
    ],
  },
  {
    id: 'studio',
    label: '影棚',
    hint: '无缝背景 + 双侧柔光箱 + 地面',
    specs: [
      { kind: 'box', name: '影棚地面', position: [0, -0.05, 0], scale: [7, 0.12, 6], color: P[7] },
      { kind: 'box', name: '无缝背景', position: [0, 1.8, -2.2], scale: [7, 4.5, 0.25], color: P[7] },
      { kind: 'box', name: '柔光箱·左', position: [-2.4, 2.4, 0.6], scale: [0.8, 1.2, 0.35], color: P[4] },
      { kind: 'box', name: '柔光箱·右', position: [2.4, 2.4, 0.6], scale: [0.8, 1.2, 0.35], color: P[4] },
      { kind: 'cylinder', name: '灯架·左', position: [-2.4, 1.2, 0.6], scale: [0.15, 2.4, 0.15], color: P[7] },
      { kind: 'cylinder', name: '灯架·右', position: [2.4, 1.2, 0.6], scale: [0.15, 2.4, 0.15], color: P[7] },
    ],
  },
  {
    id: 'living-room',
    label: '客厅',
    hint: '沙发 + 茶几 + 地毯 + 落地灯',
    specs: [
      { kind: 'box', name: '地毯', position: [0, 0.02, 0.3], scale: [3.2, 0.06, 2.4], color: P[5] },
      { kind: 'box', name: '沙发座', position: [-1.3, 0.24, 0], scale: [2.6, 0.55, 1.0], color: P[1] },
      { kind: 'box', name: '沙发靠背', position: [-1.3, 0.72, -0.38], scale: [2.6, 0.8, 0.3], color: P[1] },
      { kind: 'box', name: '茶几', position: [0.7, 0.17, 0.35], scale: [1.4, 0.4, 0.8], color: P[6] },
      { kind: 'cylinder', name: '落地灯杆', position: [2.3, 0.8, -0.7], scale: [0.1, 1.6, 0.1], color: P[7] },
      { kind: 'sphere', name: '灯罩', position: [2.3, 1.7, -0.7], scale: [0.5, 0.5, 0.5], color: P[5] },
    ],
  },
  {
    id: 'bedroom',
    label: '卧室',
    hint: '床 + 床头柜 + 台灯',
    specs: [
      { kind: 'box', name: '床架', position: [0, 0.2, 0], scale: [2.2, 0.5, 2.8], color: P[7] },
      { kind: 'box', name: '床垫', position: [0, 0.58, 0], scale: [2.1, 0.25, 2.7], color: P[1] },
      { kind: 'box', name: '床头板', position: [0, 0.7, -1.45], scale: [2.2, 1.1, 0.2], color: P[6] },
      { kind: 'box', name: '床头柜', position: [1.6, 0.24, -1.2], scale: [0.7, 0.6, 0.7], color: P[6] },
      { kind: 'cylinder', name: '台灯杆', position: [1.6, 0.75, -1.2], scale: [0.1, 0.5, 0.1], color: P[7] },
      { kind: 'sphere', name: '灯罩', position: [1.6, 1.15, -1.2], scale: [0.45, 0.45, 0.45], color: P[5] },
    ],
  },
  {
    id: 'outdoor-steps',
    label: '户外台阶',
    hint: '三级台阶 + 地面 + 灌木',
    specs: [
      { kind: 'box', name: '地面', position: [0, -0.06, 0], scale: [8, 0.12, 8], color: P[6] },
      { kind: 'box', name: '台阶·一级', position: [0, 0.14, 0.9], scale: [4, 0.35, 1.4], color: P[7] },
      { kind: 'box', name: '台阶·二级', position: [0, 0.42, -0.5], scale: [4, 0.35, 1.4], color: P[7] },
      { kind: 'box', name: '台阶·三级', position: [0, 0.7, -1.9], scale: [4, 0.35, 1.4], color: P[7] },
      { kind: 'sphere', name: '灌木·左', position: [-2.2, 0.55, -1.2], scale: [1.1, 1.1, 1.1], color: P[2] },
      { kind: 'sphere', name: '灌木·右', position: [2.3, 0.4, -0.9], scale: [0.8, 0.8, 0.8], color: P[2] },
    ],
  },
  {
    id: 'exhibition',
    label: '展台',
    hint: '圆台 + 四立柱 + 横梁',
    specs: [
      { kind: 'cylinder', name: '圆形展台', position: [0, 0.125, 0], scale: [3.2, 0.25, 3.2], color: P[7] },
      { kind: 'cylinder', name: '立柱·1', position: [-1.6, 1.5, -1.6], scale: [0.22, 3, 0.22], color: P[7] },
      { kind: 'cylinder', name: '立柱·2', position: [1.6, 1.5, -1.6], scale: [0.22, 3, 0.22], color: P[7] },
      { kind: 'cylinder', name: '立柱·3', position: [-1.6, 1.5, 1.6], scale: [0.22, 3, 0.22], color: P[7] },
      { kind: 'cylinder', name: '立柱·4', position: [1.6, 1.5, 1.6], scale: [0.22, 3, 0.22], color: P[7] },
      { kind: 'box', name: '横梁·后', position: [0, 3.05, -1.6], scale: [4.4, 0.3, 0.3], color: P[4] },
      { kind: 'box', name: '横梁·前', position: [0, 3.05, 1.6], scale: [4.4, 0.3, 0.3], color: P[4] },
      { kind: 'sphere', name: '展品占位', position: [0, 0.7, 0], scale: [0.9, 0.9, 0.9], color: P[3] },
    ],
  },
]

const BY_ID = new Map(STAGE3D_SCENE_PRESETS.map((p) => [p.id, p]))

/** 场景 id → 预设定义（未知返回 null） */
export function scenePresetById(id: string | undefined | null): Stage3DScenePreset | null {
  if (!id) return null
  return BY_ID.get(id as Stage3DScenePresetId) ?? null
}

/** 规格 → 落库对象（每次生成全新 id，避免与既有对象冲突） */
export function materializeSceneSpecs(specs: readonly PrimSpec[]): Stage3DObject[] {
  return specs.map((s) => ({
    id: createStage3DObjectId(),
    type: s.kind,
    name: s.name,
    position: s.position,
    rotation: s.rotation ?? [0, 0, 0],
    scale: s.scale ?? [1, 1, 1],
    color: s.color,
  }))
}

export type ApplySceneResult =
  | { ok: true; objects: Stage3DObject[]; added: number }
  | { ok: false; reason: string }

/**
 * 应用场景预设：**保留 character 角色**，替换全部几何体为预设内容。
 * 超出对象上限（STAGE3D_OBJECT_MAX）时整体拒绝（不半渲染）。
 */
export function applyScenePreset(
  objects: Stage3DObject[],
  presetId: Stage3DScenePresetId
): ApplySceneResult {
  const preset = BY_ID.get(presetId)
  if (!preset) return { ok: false, reason: `未知场景预设：${presetId}` }
  const characters = objects.filter((o) => o.type === 'character')
  const geometry = materializeSceneSpecs(preset.specs)
  if (characters.length + geometry.length > STAGE3D_OBJECT_MAX) {
    return {
      ok: false,
      reason: `角色 ${characters.length} 个 + 场景 ${geometry.length} 个超过对象上限 ${STAGE3D_OBJECT_MAX}：请先删除部分角色`,
    }
  }
  return { ok: true, objects: [...characters, ...geometry], added: geometry.length }
}
