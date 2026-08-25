import hookAtTheDoor from '../../presets/hook-at-the-door/story.json' with { type: 'json' }
import { parseStoryJson } from '../ai/schema'
import type { Story } from '../types'

export type PresetMeta = { id: string; title: string }

export const PRESETS: PresetMeta[] = [{ id: 'hook-at-the-door', title: '门缝' }]

const RAW: Record<string, unknown> = {
  'hook-at-the-door': hookAtTheDoor,
}

export function loadPreset(id: string): Story {
  const raw = RAW[id]
  if (raw === undefined) {
    throw new Error(`未知预设：${id}`)
  }
  const parsed = parseStoryJson(raw, { allowAlts: true })
  if (!parsed.ok) {
    throw new Error(`预设不合格：${parsed.error}`)
  }
  return structuredClone(parsed.value)
}

export function defaultPresetId(): string {
  return PRESETS[0].id
}
