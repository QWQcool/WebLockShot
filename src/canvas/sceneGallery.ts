/**
 * D6 创作场景画廊契约（CANVAS_PLAN.md §9 D6，Miora 图8 1:1）。
 *
 * 六类创作场景卡片：点击卡片 → 对话栏预填 + 可一键编排（复用 B6 既有编排路由）。
 *
 * 与 D5 开场层 / 对话栏模板 chips 的关系（理顺，不重复入口打架）：
 * - 开场层五类 tab = 快速开始（一句话场景，首次进入）；
 * - 本画廊 = 完整创作场景目录（六类，含建议拓扑说明，随时从工具条进入）；
 * - 对话栏模板 chips = 常用一句话模板（快捷回填）。
 * 三者共用同一条 B6 编排链路与场景路由，不新增场景体系。
 *
 * 诚实边界：卡片**配图为 CSS 风格化艺术面板**（渐变 + 图标），不是参考稿中的实拍图——
 * 本仓库不自产/不分发参考稿图片素材（版权），也不引入外部图库；如实呈现为风格化视觉。
 * 编排拓扑对所有场景同链（brief→script→storyboard→generate→deliver，见 buildDemoOrchestrationPlan），
 * 差异在 script 的契约场景（ecommerce/brand/drama），卡片如实标注。
 */
import { routeOrchestrationScene, type OrchestrationScene } from './contract.ts'

export type SceneGalleryCard = {
  /** 图8 卡片序号（01~06） */
  number: string
  title: string
  /** 图8 卡片副标题（能力面） */
  subtitle: string
  /** 图8 卡片标语（一行强调） */
  tagline: string
  /** 路由到的既有编排场景 */
  scene: OrchestrationScene
  /** 艺术面板图标字形 */
  glyph: string
  /** 艺术面板渐变（风格化配图，纯 CSS） */
  gradient: [string, string]
  /** 点击卡片预填对话栏的一句话（同时必须路由回本卡 scene） */
  prompt: string
}

export const SCENE_GALLERY_CARDS: readonly SceneGalleryCard[] = [
  {
    number: '01',
    title: '品牌设计',
    subtitle: '品牌全案 · IP · 宣传海报',
    tagline: '从 Brief 到视觉全案设计',
    scene: 'brand',
    glyph: '🎨',
    gradient: ['#e8f3ec', '#a8d5b8'],
    prompt: '为一个新消费品牌做全案设计：品牌方向、Logo、主视觉海报与社媒头图，风格统一可延展',
  },
  {
    number: '02',
    title: '电商物料',
    subtitle: '商品/模特/详情图和视频素材',
    tagline: '快速生成商品多用途多尺寸',
    scene: 'ecommerce',
    glyph: '🛍️',
    gradient: ['#f7efe4', '#e6c9a0'],
    prompt: '为一款商品批量产出电商物料：商品图、模特图、详情页配图与短视频素材，多用途多尺寸',
  },
  {
    number: '03',
    title: '影视文娱',
    subtitle: '故事板 → 分镜 → 成片',
    tagline: '一个平台完成全链路成片',
    scene: 'drama',
    glyph: '🎬',
    gradient: ['#fdeede', '#f0b183'],
    prompt: '把一个故事创意做成完整成片：故事板 → 分镜 → 出片，一个平台完成全链路',
  },
  {
    number: '04',
    title: '游戏内容',
    subtitle: '角色/道具/场景 · 玩法 Demo',
    tagline: '从创意到玩法 Demo 设计',
    scene: 'game',
    glyph: '🎮',
    gradient: ['#e9eefb', '#a9b8e8'],
    prompt: '为一个游戏做内容与玩法 Demo：角色、道具、场景设定与宣传 PV',
  },
  {
    number: '05',
    title: '产品 UI/UX',
    subtitle: 'Web/APP 全套 UI 和交互',
    tagline: '可预览可交付可继续开发',
    scene: 'app',
    glyph: '📱',
    gradient: ['#fbeaea', '#e39a9a'],
    prompt: '为一款 Web/APP 产品做全套 UI 和交互：界面设计、流程演示与可交付说明',
  },
  {
    number: '06',
    title: '宣传物料',
    subtitle: '活动海报 · 攻略长图 · 社媒物料',
    tagline: '从活动需求到多套宣传物料',
    scene: 'brand',
    glyph: '📣',
    gradient: ['#fdf3df', '#f2cd6e'],
    prompt: '围绕一场活动产出多套宣传物料：活动海报、攻略长图与社媒物料',
  },
]

/** 建议拓扑链（与 buildDemoOrchestrationPlan 同链，展示用） */
export const SCENE_GALLERY_TOPOLOGY: readonly { kind: string; label: string; icon: string }[] = [
  { kind: 'brief', label: '需求 Brief', icon: '📝' },
  { kind: 'script', label: '脚本创编', icon: '✍️' },
  { kind: 'storyboard', label: '分镜预演', icon: '🎞️' },
  { kind: 'generate', label: '逐镜出片', icon: '🎥' },
  { kind: 'deliver', label: '成片交付', icon: '✨' },
]

/**
 * 契约自检（供 UI 与单测）：卡片 prompt 必须经关键词路由回到自己的 scene——
 * 否则「点击卡片 → 预填 → 一键编排」会落到错误场景（违背卡片语义）。
 */
export function sceneCardRoutingIssues(): string[] {
  const issues: string[] = []
  for (const card of SCENE_GALLERY_CARDS) {
    if (routeOrchestrationScene(card.prompt) !== card.scene) {
      issues.push(`卡片「${card.title}」的 prompt 路由到 ${routeOrchestrationScene(card.prompt)}，期望 ${card.scene}`)
    }
  }
  return issues
}
