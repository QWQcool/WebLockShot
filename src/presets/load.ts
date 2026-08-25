import floorThirteen from '../../presets/floor-thirteen/story.json' with { type: 'json' }
import hookAtTheDoor from '../../presets/hook-at-the-door/story.json' with { type: 'json' }
import unreadVoice from '../../presets/unread-voice/story.json' with { type: 'json' }
import { parseStoryJson } from '../ai/schema'
import type { Story } from '../types'

export type PresetMeta = { id: string; title: string; theme: string }

export const PRESETS: PresetMeta[] = [
  { id: 'hook-at-the-door', title: '门缝', theme: '悬疑租房' },
  { id: 'unread-voice', title: '未读', theme: '都市情感' },
  { id: 'floor-thirteen', title: '13层', theme: '职场悬疑' },
]

const RAW: Record<string, unknown> = {
  'hook-at-the-door': hookAtTheDoor,
  'unread-voice': unreadVoice,
  'floor-thirteen': floorThirteen,
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
