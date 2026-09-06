import { z } from 'zod'

export const ProductInputSchema = z.object({
  source: z.enum(['link', 'image', 'manual']),
  link: z.string().url().optional().or(z.literal('')),
  title: z.string().optional(),
  sellingPointsManual: z.array(z.string()).default([]),
  imagePreview: z.string().optional(), // 本地 dataURL 仅预览
  videoPreview: z.string().optional(), // 本地 video blob/dataURL
})

export type ProductInput = z.infer<typeof ProductInputSchema>

export const ProductInsightSchema = z.object({
  category: z.string(),
  look: z.string(),
  sellingPoints: z.array(z.string()).min(1),
  audience: z.string(),
  scenarios: z.array(z.string()),
  priceBand: z.string().optional(),
  tone: z.string().default('真诚带感，节奏紧凑'),
})

export type ProductInsight = z.infer<typeof ProductInsightSchema>
