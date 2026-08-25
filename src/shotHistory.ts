import type { Shot } from './types'

export type ShotHistoryItem = {
  key: string
  shot: Shot
}

export type ShotHistory = Record<string, ShotHistoryItem[]>

export function withoutAlts(shot: Shot): Shot {
  const { alts: _alts, ...rest } = shot
  return rest
}

export function shotKey(shot: Shot): string {
  return `${shot.motionId}|${shot.shotSize}|${shot.line}|${shot.prop ?? 'none'}|${shot.durationSec}`
}

export function pushShotHistory(
  prev: ShotHistory,
  current: Shot,
  limit = 8,
): ShotHistory {
  const entry: ShotHistoryItem = {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    shot: structuredClone(withoutAlts(current)),
  }
  const list = [entry, ...(prev[current.id] ?? [])].slice(0, limit)
  return { ...prev, [current.id]: list }
}

/** 空值则用上一镜时长；否则夹在 2–5 秒。 */
export function resolveDuration(raw: string, fallback: number): number {
  const trimmed = raw.trim()
  if (!trimmed) return clampDuration(fallback)
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return clampDuration(fallback)
  return clampDuration(n)
}

function clampDuration(n: number): number {
  return Math.min(5, Math.max(2, Math.round(n * 10) / 10))
}
