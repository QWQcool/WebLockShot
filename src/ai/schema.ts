import {
  MOTION_IDS,
  PROP_IDS,
  SHOT_SIZES,
  type Character,
  type MotionId,
  type PropId,
  type Setting,
  type Shot,
  type ShotSize,
  type Story,
  type StoryInput,
} from '../types'

export type ParseOk<T> = { ok: true; value: T }
export type ParseErr = { ok: false; error: string }
export type ParseResult<T> = ParseOk<T> | ParseErr

const COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const ORDER = new Set([1, 2, 3, 4, 5, 6])

export function stripFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return (fenced ? fenced[1] : trimmed).trim()
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown, label: string): ParseResult<string> {
  if (typeof v !== 'string') return { ok: false, error: `${label} 必须是字符串` }
  return { ok: true, value: v }
}

function asNonEmpty(v: unknown, label: string): ParseResult<string> {
  const s = asString(v, label)
  if (!s.ok) return s
  if (s.value.trim() === '') return { ok: false, error: `${label} 不能为空` }
  return s
}

export function parseStoryJson(
  raw: unknown,
  opts: { allowAlts: boolean },
): ParseResult<Story> {
  if (!isRecord(raw)) return { ok: false, error: '根对象必须是 JSON 对象' }

  const id = asNonEmpty(raw.id, 'id')
  if (!id.ok) return id
  const title = asNonEmpty(raw.title, 'title')
  if (!title.ok) return title

  const input = parseInput(raw.input)
  if (!input.ok) return input

  if (!Array.isArray(raw.characters) || raw.characters.length < 1) {
    return { ok: false, error: 'characters 至少需要 1 人' }
  }
  const characters: Character[] = []
  const charIds = new Set<string>()
  for (let i = 0; i < raw.characters.length; i++) {
    const c = parseCharacter(raw.characters[i], `characters[${i}]`)
    if (!c.ok) return c
    if (charIds.has(c.value.id)) {
      return { ok: false, error: `角色 id 重复：${c.value.id}` }
    }
    charIds.add(c.value.id)
    characters.push(c.value)
  }

  const setting = parseSetting(raw.setting)
  if (!setting.ok) return setting

  if (!Array.isArray(raw.shots) || raw.shots.length !== 6) {
    return { ok: false, error: 'shots 必须恰好 6 镜' }
  }

  const shots: Shot[] = []
  const seenOrder = new Set<number>()
  for (let i = 0; i < raw.shots.length; i++) {
    const shot = parseShot(raw.shots[i], `shots[${i}]`, {
      allowAlts: opts.allowAlts,
      charIds,
    })
    if (!shot.ok) return shot
    if (seenOrder.has(shot.value.order)) {
      return { ok: false, error: `镜号 order 重复：${shot.value.order}` }
    }
    seenOrder.add(shot.value.order)
    shots.push(shot.value)
  }

  shots.sort((a, b) => a.order - b.order)
  for (let i = 0; i < 6; i++) {
    if (shots[i].order !== i + 1) {
      return { ok: false, error: 'shots.order 必须覆盖 1 到 6' }
    }
  }

  return {
    ok: true,
    value: {
      id: id.value,
      title: title.value,
      input: input.value,
      characters,
      setting: setting.value,
      shots,
    },
  }
}

export function parseShotJson(
  raw: unknown,
  charIds: Set<string>,
): ParseResult<Shot> {
  return parseShot(raw, 'shot', { allowAlts: false, charIds })
}

export function parseModelText<T>(
  text: string,
  parse: (raw: unknown) => ParseResult<T>,
): ParseResult<T> {
  const stripped = stripFence(text)
  let raw: unknown
  try {
    raw = JSON.parse(stripped)
  } catch {
    return { ok: false, error: '模型返回的不是合格 JSON（已尝试去掉 Markdown 围栏）' }
  }
  return parse(raw)
}

function parseInput(raw: unknown): ParseResult<StoryInput> {
  if (!isRecord(raw)) return { ok: false, error: 'input 必须是对象' }
  const theme = asNonEmpty(raw.theme, 'input.theme')
  if (!theme.ok) return theme
  const character = asNonEmpty(raw.character, 'input.character')
  if (!character.ok) return character
  const conflict = asNonEmpty(raw.conflict, 'input.conflict')
  if (!conflict.ok) return conflict
  const hook = asNonEmpty(raw.hook, 'input.hook')
  if (!hook.ok) return hook
  return {
    ok: true,
    value: {
      theme: theme.value,
      character: character.value,
      conflict: conflict.value,
      hook: hook.value,
    },
  }
}

function parseCharacter(raw: unknown, label: string): ParseResult<Character> {
  if (!isRecord(raw)) return { ok: false, error: `${label} 必须是对象` }
  const id = asNonEmpty(raw.id, `${label}.id`)
  if (!id.ok) return id
  const name = asNonEmpty(raw.name, `${label}.name`)
  if (!name.ok) return name
  const color = asNonEmpty(raw.color, `${label}.color`)
  if (!color.ok) return color
  if (!COLOR.test(color.value)) {
    return { ok: false, error: `${label}.color 必须是 #RGB 或 #RRGGBB` }
  }
  const anchor = asNonEmpty(raw.anchor, `${label}.anchor`)
  if (!anchor.ok) return anchor
  return {
    ok: true,
    value: {
      id: id.value,
      name: name.value,
      color: color.value,
      anchor: anchor.value,
    },
  }
}

function parseSetting(raw: unknown): ParseResult<Setting> {
  if (!isRecord(raw)) return { ok: false, error: 'setting 必须是对象' }
  const place = asNonEmpty(raw.place, 'setting.place')
  if (!place.ok) return place
  const time = asNonEmpty(raw.time, 'setting.time')
  if (!time.ok) return time
  const light = asNonEmpty(raw.light, 'setting.light')
  if (!light.ok) return light
  return {
    ok: true,
    value: { place: place.value, time: time.value, light: light.value },
  }
}

function parseShot(
  raw: unknown,
  label: string,
  opts: { allowAlts: boolean; charIds: Set<string> },
): ParseResult<Shot> {
  if (!isRecord(raw)) return { ok: false, error: `${label} 必须是对象` }

  const id = asNonEmpty(raw.id, `${label}.id`)
  if (!id.ok) return id

  if (typeof raw.order !== 'number' || !ORDER.has(raw.order)) {
    return { ok: false, error: `${label}.order 必须是 1–6 的整数` }
  }
  const order = raw.order as 1 | 2 | 3 | 4 | 5 | 6

  const purpose = asNonEmpty(raw.purpose, `${label}.purpose`)
  if (!purpose.ok) return purpose

  if (typeof raw.shotSize !== 'string' || !isShotSize(raw.shotSize)) {
    return { ok: false, error: `${label}.shotSize 不在景别词典里` }
  }
  if (typeof raw.motionId !== 'string' || !isMotionId(raw.motionId)) {
    return { ok: false, error: `${label}.motionId 不在镜头词典里` }
  }
  if (typeof raw.durationSec !== 'number' || raw.durationSec < 2 || raw.durationSec > 5) {
    return { ok: false, error: `${label}.durationSec 必须在 2–5 秒` }
  }

  if (!Array.isArray(raw.cast) || raw.cast.some((c) => typeof c !== 'string')) {
    return { ok: false, error: `${label}.cast 必须是角色 id 数组` }
  }
  for (const cid of raw.cast) {
    if (!opts.charIds.has(cid)) {
      return { ok: false, error: `${label}.cast 引用了未知角色：${cid}` }
    }
  }

  const line = asString(raw.line, `${label}.line`)
  if (!line.ok) return line

  let lineSpeaker: string | undefined
  if (raw.lineSpeaker !== undefined) {
    const sp = asString(raw.lineSpeaker, `${label}.lineSpeaker`)
    if (!sp.ok) return sp
    if (sp.value && !opts.charIds.has(sp.value)) {
      return { ok: false, error: `${label}.lineSpeaker 不是已知角色` }
    }
    lineSpeaker = sp.value || undefined
  }

  let prop: PropId | undefined
  if (raw.prop !== undefined) {
    if (typeof raw.prop !== 'string' || !isPropId(raw.prop)) {
      return { ok: false, error: `${label}.prop 只允许 none / door / note / lock` }
    }
    prop = raw.prop
  }

  let alts: Shot[] | undefined
  if (raw.alts !== undefined) {
    if (!opts.allowAlts) {
      return { ok: false, error: `${label} 模型输出不要带 alts` }
    }
    if (!Array.isArray(raw.alts)) {
      return { ok: false, error: `${label}.alts 必须是数组` }
    }
    alts = []
    for (let i = 0; i < raw.alts.length; i++) {
      const alt = parseShot(raw.alts[i], `${label}.alts[${i}]`, {
        allowAlts: false,
        charIds: opts.charIds,
      })
      if (!alt.ok) return alt
      alts.push(alt.value)
    }
  }

  return {
    ok: true,
    value: {
      id: id.value,
      order,
      purpose: purpose.value,
      shotSize: raw.shotSize,
      motionId: raw.motionId,
      durationSec: raw.durationSec,
      cast: raw.cast as string[],
      line: line.value,
      ...(lineSpeaker ? { lineSpeaker } : {}),
      ...(prop && prop !== 'none' ? { prop } : {}),
      ...(alts && alts.length > 0 ? { alts } : {}),
    },
  }
}

function isMotionId(v: string): v is MotionId {
  return (MOTION_IDS as readonly string[]).includes(v)
}

function isShotSize(v: string): v is ShotSize {
  return (SHOT_SIZES as readonly string[]).includes(v)
}

function isPropId(v: string): v is PropId {
  return (PROP_IDS as readonly string[]).includes(v)
}
