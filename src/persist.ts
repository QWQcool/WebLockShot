import { parseShotJson, parseStoryEnvelope, parseStoryJson } from './ai/schema'
import type { Shot, Story, StoryEnvelope, StoryInput } from './types'

export const GENERATE_SESSION_KEY = 'weblockshot.generateSession'
export const LAST_GOOD_STORY_KEY = 'weblockshot.lastGoodStory'

export type GenerateSession = {
  version: 1
  id: string
  startedAt: number
  input: StoryInput
  model: string
  envelope: StoryEnvelope | null
  shots: Shot[]
}

export function createGenerateSession(
  input: StoryInput,
  model: string,
): GenerateSession {
  return {
    version: 1,
    id: `gen-${Date.now().toString(16)}`,
    startedAt: Date.now(),
    input: { ...input },
    model: model.trim(),
    envelope: null,
    shots: [],
  }
}

export function sessionProgress(session: GenerateSession): {
  done: number
  total: number
  nextOrder: 1 | 2 | 3 | 4 | 5 | 6 | null
} {
  const done = session.shots.length
  if (!session.envelope) {
    return { done, total: 6, nextOrder: 1 }
  }
  if (done >= 6) return { done: 6, total: 6, nextOrder: null }
  return { done, total: 6, nextOrder: (done + 1) as 1 | 2 | 3 | 4 | 5 | 6 }
}

export function isIncompleteSession(session: GenerateSession): boolean {
  return !session.envelope || session.shots.length < 6
}

export function writeGenerateSession(session: GenerateSession): void {
  localStorage.setItem(GENERATE_SESSION_KEY, JSON.stringify(session))
}

export function clearGenerateSession(): void {
  localStorage.removeItem(GENERATE_SESSION_KEY)
}

export function readGenerateSession(): GenerateSession | null {
  const raw = localStorage.getItem(GENERATE_SESSION_KEY)
  if (!raw) return null
  try {
    return parseSession(JSON.parse(raw))
  } catch {
    clearGenerateSession()
    return null
  }
}

export function writeLastGoodStory(story: Story): void {
  localStorage.setItem(
    LAST_GOOD_STORY_KEY,
    JSON.stringify({ savedAt: Date.now(), story }),
  )
}

export function readLastGoodStory(): Story | null {
  const raw = localStorage.getItem(LAST_GOOD_STORY_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const storyRaw = (parsed as { story?: unknown }).story
    const story = parseStoryJson(storyRaw, { allowAlts: true })
    return story.ok ? story.value : null
  } catch {
    return null
  }
}

function parseSession(raw: unknown): GenerateSession | null {
  if (typeof raw !== 'object' || raw === null) return null
  const rec = raw as Record<string, unknown>
  if (rec.version !== 1) return null
  if (typeof rec.id !== 'string' || typeof rec.startedAt !== 'number') return null
  if (typeof rec.model !== 'string') return null
  const input = rec.input
  if (typeof input !== 'object' || input === null) return null
  const inp = input as Record<string, unknown>
  if (
    typeof inp.theme !== 'string' ||
    typeof inp.character !== 'string' ||
    typeof inp.conflict !== 'string' ||
    typeof inp.hook !== 'string'
  ) {
    return null
  }

  let envelope: StoryEnvelope | null = null
  if (rec.envelope != null) {
    const parsed = parseStoryEnvelope(rec.envelope)
    if (!parsed.ok) return null
    envelope = parsed.value
  }

  if (!Array.isArray(rec.shots)) return null
  const shots: Shot[] = []
  if (envelope) {
    const charIds = new Set(envelope.characters.map((c) => c.id))
    for (const item of rec.shots) {
      const shot = parseShotJson(item, charIds)
      if (!shot.ok) return null
      shots.push(shot.value)
    }
    shots.sort((a, b) => a.order - b.order)
    for (let i = 0; i < shots.length; i++) {
      if (shots[i].order !== i + 1) return null
    }
  } else if (rec.shots.length > 0) {
    return null
  }

  return {
    version: 1,
    id: rec.id,
    startedAt: rec.startedAt,
    input: {
      theme: inp.theme,
      character: inp.character,
      conflict: inp.conflict,
      hook: inp.hook,
    },
    model: rec.model,
    envelope,
    shots,
  }
}
