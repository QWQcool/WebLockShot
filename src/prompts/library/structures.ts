/**
 * 爆款结构与钩子句式库加载器 (Hook Library Loader)
 *
 * 数据资产：src/assets/hooks/structures.data.json（纯 JSON，可由运营/数据侧维护）
 * 本文件只负责：zod Schema 校验 + 类型导出 + 元数据路由采样。
 * 结构库按「类型/适用品类/情绪轴/历史胜率」带元数据，ScriptWriter 按元数据路由采样。
 */
import { z } from 'zod'
import { BEAT_ROLES } from '../../domain/script.ts'
import structuresDataJson from '../../assets/hooks/structures.data.json' with { type: 'json' }

export const BeatSkeletonItemSchema = z.object({
  order: z.number().min(1).max(6),
  role: z.enum(BEAT_ROLES),
  hint: z.string(),
  defaultDurationSec: z.number().min(2).max(5).default(3),
})

export type BeatSkeletonItem = z.infer<typeof BeatSkeletonItemSchema>

export const StructureTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  fit: z.string(),
  /** 适用品类（元数据路由依据） */
  categories: z.array(z.string()).min(1),
  /** 6 拍情绪轴 */
  emotionArc: z.array(z.string()).length(6),
  /** 结构级历史先验胜率（回流数据可覆盖） */
  baselineWinRate: z.number().min(0).max(1).default(0.5),
  beatSkeleton: z.array(BeatSkeletonItemSchema).length(6),
  hookSamples: z.array(z.string()).min(3),
  /** 钩子类型标签，与 hookSamples 一一对应 */
  hookTypes: z.array(z.string()).optional(),
  /** 钩子级历史胜率，与 hookSamples 一一对应；回流数据驱动 */
  hookWinRates: z.array(z.number().min(0).max(1)).optional(),
})

export type StructureTemplate = z.infer<typeof StructureTemplateSchema>

export const HookSeedGroupSchema = z.object({
  type: z.string(),
  lines: z.array(z.string()).min(1),
})

export const HookLibrarySchema = z.object({
  structures: z.array(StructureTemplateSchema).min(5),
  hookSeeds: z.array(HookSeedGroupSchema).min(1),
})

const hookLibrary = HookLibrarySchema.parse(structuresDataJson)

export const STRUCTURE_TEMPLATES: StructureTemplate[] = hookLibrary.structures

/** 钩子与卖点句式库（type -> lines），供 PromptBooster 与 ScriptWriter 自由调配 */
export const HOOK_SEEDS: Record<string, string[]> = Object.fromEntries(
  hookLibrary.hookSeeds.map((g) => [g.type, g.lines])
)

/**
 * 元数据路由：按商品品类匹配适用品类命中数最高的模板；
 * 无品类或无命中时返回 undefined（调用方回退默认模板）。
 */
export function pickTemplateId(category?: string): string | undefined {
  if (!category?.trim()) return undefined
  const c = category.trim()
  let best: { id: string; score: number } | undefined
  for (const tpl of STRUCTURE_TEMPLATES) {
    let score = 0
    for (const cat of tpl.categories) {
      if (cat === c) score += 2
      else if (cat.includes(c) || c.includes(cat)) score += 1
    }
    if (score > (best?.score ?? 0)) {
      best = { id: tpl.id, score }
    }
  }
  return best?.id
}

/** 胜率查询器：回流看板可注入真实历史胜率；无数据时返回 undefined 走先验 */
export type WinRateLookup = (templateId: string, hookIndex: number) => number | undefined

/**
 * 胜率加权钩子采样：
 * - 优先使用 lookup 提供的历史胜率，其次模板内 hookWinRates，最后均匀分布；
 * - 全 0 权重时回退均匀采样，保证永不空转。
 */
export function weightedSampleHook(
  template: StructureTemplate,
  lookup?: WinRateLookup,
  rng: () => number = Math.random
): { text: string; index: number } {
  const n = template.hookSamples.length
  const weights = template.hookSamples.map((_, i) => {
    const w = lookup?.(template.id, i) ?? template.hookWinRates?.[i] ?? 1 / n
    return Math.max(0, w)
  })

  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) {
    const index = Math.floor(rng() * n)
    return { text: template.hookSamples[index], index }
  }

  let threshold = rng() * total
  for (let i = 0; i < n; i++) {
    threshold -= weights[i]
    if (threshold <= 0) {
      return { text: template.hookSamples[i], index: i }
    }
  }
  return { text: template.hookSamples[n - 1], index: n - 1 }
}
