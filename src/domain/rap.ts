import { z } from 'zod'

export const RapSectionSchema = z.object({
  name: z.string(),
  timeHint: z.string(),
  note: z.string(),
})

export const RapSheetSchema = z.object({
  source: z.enum(['local-video', 'paste-copy', 'template']),
  structureId: z.string().optional(),
  hookType: z.string().optional(),
  sections: z.array(RapSectionSchema),
  pacingNote: z.string(),
  styleNote: z.string(),
})

export type RapSection = z.infer<typeof RapSectionSchema>
export type RapSheet = z.infer<typeof RapSheetSchema>
