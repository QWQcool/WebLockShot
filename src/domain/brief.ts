import { z } from 'zod'
import { ProductInsightSchema } from './product.ts'
import { RapSheetSchema } from './rap.ts'

export const PlatformSchema = z.enum([
  'douyin_ecom',
  'kuaishou',
  'shipinhao',
  'xiaohongshu',
  'generic',
])
export type Platform = z.infer<typeof PlatformSchema>

export const CreativeBriefSchema = z.object({
  platform: PlatformSchema.default('douyin_ecom'),
  targetDurationSec: z.number().default(18),
  audience: z.string().optional(),
  sellingPoints: z.array(z.string()).default([]),
  style: z.string().optional(),
  cta: z.string().optional(),
  banned: z.array(z.string()).default([]),
  product: ProductInsightSchema.optional(),
  rap: RapSheetSchema.optional(),
  // 剧情模式回填保持兼容
  storyInput: z
    .object({
      theme: z.string(),
      character: z.string(),
      conflict: z.string(),
      hook: z.string(),
    })
    .optional(),
})

export type CreativeBrief = z.infer<typeof CreativeBriefSchema>
