/**
 * D5 开场层契约（CANVAS_PLAN.md §9 D5-⑤，Miora 图1 形态）。
 *
 * 首次进入画布叠加「图1 风格开场层」（五类场景 tab + 大输入卡 + 连接器条），
 * 「进入画布」后写入 seen 标记，之后不再弹出（折叠为既有底部对话栏）。
 *
 * 纯函数模块（node --test 可跑），Storage 注入以便测试。
 */
import { CANVAS_SCENE_TEMPLATES, type OrchestrationScene } from './contract.ts'

/** 开场层已读标记（localStorage）；缺失 = 首次进入需叠加 */
export const ONBOARDING_SEEN_KEY = 'weblockshot.canvas.onboarding_seen' as const

export type OnboardingSceneTab = {
  /** 图1 tab 标识 */
  id: string
  /** 图1 tab 文案 */
  label: string
  icon: string
  /** 映射到既有编排场景路由（复用 B6，不新增场景体系） */
  scene: OrchestrationScene
}

/**
 * 图1 五类场景 tab → 既有 ORCHESTRATION_SCENES 一一映射。
 * 文案对齐参考稿图1（品牌设计 / 影视创意 / 电商广告 / 互动游戏 / 网页应用）。
 */
export const ONBOARDING_SCENE_TABS: readonly OnboardingSceneTab[] = [
  { id: 'brand-design', label: '品牌设计', icon: '🎨', scene: 'brand' },
  { id: 'film-creative', label: '影视创意', icon: '🎬', scene: 'drama' },
  { id: 'ecommerce-ad', label: '电商广告', icon: '🛒', scene: 'ecommerce' },
  { id: 'interactive-game', label: '互动游戏', icon: '🎮', scene: 'game' },
  { id: 'web-app', label: '网页应用', icon: '🧩', scene: 'app' },
]

/** tab → 预填 prompt（复用既有场景模板文案，单一来源，不另写一套） */
export function onboardingPromptFor(scene: OrchestrationScene): string {
  const tpl = CANVAS_SCENE_TEMPLATES.find((t) => t.id === scene)
  return tpl?.prompt ?? ''
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

/** 是否已看过开场层（存储不可用/脏值一律视为「未看过」→ 首次进入正常叠加） */
export function readOnboardingSeen(storage?: StorageLike): boolean {
  const s = resolveStorage(storage)
  if (!s) return false
  try {
    return s.getItem(ONBOARDING_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/** 标记已看过（关闭开场层时调用） */
export function markOnboardingSeen(storage?: StorageLike): void {
  const s = resolveStorage(storage)
  if (!s) return
  try {
    s.setItem(ONBOARDING_SEEN_KEY, '1')
  } catch {
    // 存储不可用：本次会话内已关闭；下次刷新会再弹（可接受的降级）
  }
}

/** 重置标记（设置面板/测试用：让开场层可再次查看） */
export function resetOnboardingSeen(storage?: StorageLike): void {
  const s = resolveStorage(storage)
  if (!s) return
  try {
    s.removeItem(ONBOARDING_SEEN_KEY)
  } catch {
    // ignore
  }
}
