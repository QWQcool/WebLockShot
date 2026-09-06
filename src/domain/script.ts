import { z } from 'zod'

export const BEAT_ROLES = ['hook', 'pain', 'reveal', 'demo', 'proof', 'cta'] as const
export type BeatRole = (typeof BEAT_ROLES)[number]

export const ScriptBeatSchema = z.object({
  order: z.number().int().min(1).max(6),
  role: z.enum(BEAT_ROLES),
  goal: z.string(),
  action: z.string(),
  audio: z
    .object({
      kind: z.enum(['vo', 'dialogue', 'sfx', 'none']),
      speaker: z.string().optional(),
      text: z.string().optional(),
    })
    .optional(),
  caption: z.string().optional(), // 画面字幕/促销标语/卖点强化
  emotion: z.string().optional(),
})

export type ScriptBeat = z.infer<typeof ScriptBeatSchema>

export const ScriptSchema = z.object({
  logline: z.string(),
  templateId: z.string().optional(),
  beats: z.array(ScriptBeatSchema).length(6),
  ctaLine: z.string(),
  lengthTargetSec: z.number().default(18),
})

export type Script = z.infer<typeof ScriptSchema>
