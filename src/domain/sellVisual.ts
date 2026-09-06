import { z } from 'zod'

export const VisualPlanSchema = z.object({
  shotId: z.string(),
  order: z.number().int().min(1).max(6),
  kind: z.enum(['text2video', 'image2video']).default('text2video'),
  positive: z.string().min(1),
  negative: z.string().optional(),
  ratio: z.literal('9:16').default('9:16'),
  durationSec: z.number().min(2).max(5),
  caption: z.string().optional(), // 烧录/贴片字幕内容
  referenceImage: z.string().optional(), // 产品/主体参考图
})

export type VisualPlan = z.infer<typeof VisualPlanSchema>
