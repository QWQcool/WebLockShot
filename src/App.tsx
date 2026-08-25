import { useEffect, useMemo, useRef, useState } from 'react'
import { chatCompletionsText, TokenClientError } from './ai/client'
import {
  generateUserPrompt,
  redoShotSystemPrompt,
  redoShotUserPrompt,
  reviseShotUserPrompt,
  storySystemPrompt,
} from './ai/prompts'
import { parseModelText, parseShotJson, parseStoryJson } from './ai/schema'
import { buildPromptPack } from './export/buildPromptPack'
import { defaultPresetId, loadPreset } from './presets/load'
import {
  pushShotHistory,
  resolveDuration,
  shotKey,
  withoutAlts,
  type ShotHistory,
} from './shotHistory'
import { ShotStage } from './stage/ShotStage'
import { useShotTimeline } from './stage/useShotTimeline'
import type {
  EditorMode,
  MotionId,
  Shot,
  Story,
  TokenConfig,
} from './types'
import { TOKEN_STORAGE_KEY } from './types'
import { EditorChrome } from './ui/EditorChrome'

const EMPTY_TOKEN: TokenConfig = { baseUrl: '', apiKey: '', model: '' }

export default function App() {
  const [mode, setMode] = useState<EditorMode>('preset')
  const [presetId, setPresetId] = useState(defaultPresetId)
  const [story, setStory] = useState<Story>(() => loadPreset(defaultPresetId()))
  const [draft, setDraft] = useState(() => story.input)
  const presetSource = useRef(story)
  const [token, setToken] = useState<TokenConfig>(readToken)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [history, setHistory] = useState<ShotHistory>({})
  const [supplement, setSupplement] = useState('')
  const [durationDraft, setDurationDraft] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const timelineKey = [
    story.id,
    ...story.shots.map(
      (item) =>
        `${item.id}:${item.motionId}:${item.durationSec}:${item.prop ?? 'none'}:${item.cast.join(',')}:${item.line.trim() ? '1' : '0'}`,
    ),
  ].join('|')
  const timeline = useShotTimeline(story, reducedMotion, rootRef, timelineKey)
  const shot = story.shots[timeline.shotIndex] ?? story.shots[0]

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token))
  }, [token])

  useEffect(() => {
    setSupplement('')
    setDurationDraft('')
  }, [shot.id])

  const canGenerate =
    mode === 'preset' ||
    Boolean(token.apiKey.trim() && token.baseUrl.trim() && token.model.trim())
  const generateHint =
    mode === 'token' && !canGenerate
      ? '自带 Token 模式需要 Base URL、Key 和模型名，生成才会发起请求。'
      : ''

  const originalShot = presetSource.current.shots.find((s) => s.id === shot.id)
  const canRedo =
    mode === 'token'
      ? canGenerate
      : Boolean(originalShot?.alts && originalShot.alts.length > 0)
  const redoHint =
    mode === 'preset'
      ? canRedo
        ? '切到这一镜的官方第二版本（台词或运动只改一项）。不能手改内容。'
        : '这一镜没有备选，按钮不可用。'
      : canGenerate
        ? '让模型重写这一镜。时长留空则沿用当前秒数。'
        : '填写密钥后才能让模型重做这一镜。'
  const canRevise = mode === 'token' && canGenerate && Boolean(supplement.trim())

  const charIds = useMemo(
    () => new Set(story.characters.map((c) => c.id)),
    [story.characters],
  )

  function applyStory(next: Story) {
    setStory(next)
    setDraft(next.input)
  }

  function replaceShot(nextShot: Shot, recordHistory: boolean) {
    if (recordHistory) {
      setHistory((hist) => pushShotHistory(hist, shot))
    }
    setStory((prev) => ({
      ...prev,
      shots: prev.shots.map((item) =>
        item.id === shot.id
          ? {
              ...item,
              ...nextShot,
              id: item.id,
              order: item.order,
            }
          : item,
      ),
    }))
  }

  function patchShot(patch: Partial<Shot>) {
    if (mode === 'preset') return
    setStory((prev) => ({
      ...prev,
      shots: prev.shots.map((item, i) =>
        i === timeline.shotIndex ? { ...item, ...patch } : item,
      ),
    }))
  }

  async function onGenerate() {
    setError(null)
    if (mode === 'preset') {
      const next = loadPreset(presetId)
      presetSource.current = next
      setHistory({})
      applyStory(next)
      return
    }
    setBusy(true)
    try {
      const text = await chatCompletionsText(token, [
        { role: 'system', content: storySystemPrompt() },
        { role: 'user', content: generateUserPrompt(draft) },
      ])
      const parsed = parseModelText(text, (raw) =>
        parseStoryJson(raw, { allowAlts: false }),
      )
      if (!parsed.ok) {
        setError(`模型返回不合格：${parsed.error}。上一版粗剪仍可播。`)
        return
      }
      setHistory({})
      applyStory(parsed.value)
    } catch (err) {
      setError(asErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onRedo() {
    setError(null)
    if (mode === 'preset') {
      const source = presetSource.current.shots.find((s) => s.id === shot.id)
      if (!source) return
      const pool = [withoutAlts(source), ...(source.alts ?? [])]
      const idx = pool.findIndex((item) => shotKey(item) === shotKey(withoutAlts(shot)))
      const nextShot = pool[(idx + 1) % pool.length]
      replaceShot({ ...nextShot, alts: source.alts }, true)
      return
    }
    const durationSec = resolveDuration(durationDraft, shot.durationSec)
    setBusy(true)
    try {
      const text = await chatCompletionsText(token, [
        { role: 'system', content: redoShotSystemPrompt() },
        { role: 'user', content: redoShotUserPrompt(story, shot, durationSec) },
      ])
      const parsed = parseModelText(text, (raw) => parseShotJson(raw, charIds))
      if (!parsed.ok) {
        setError(`单镜重写不合格：${parsed.error}。当前镜未改。`)
        return
      }
      replaceShot(
        { ...parsed.value, durationSec, id: shot.id, order: shot.order, alts: undefined },
        true,
      )
    } catch (err) {
      setError(asErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onRevise() {
    setError(null)
    if (mode !== 'token') return
    const note = supplement.trim()
    if (!note) {
      setError('请先填写要改变的内容，再按补充改这一镜。')
      return
    }
    const durationSec = resolveDuration(durationDraft, shot.durationSec)
    setBusy(true)
    try {
      const text = await chatCompletionsText(token, [
        { role: 'system', content: redoShotSystemPrompt() },
        { role: 'user', content: reviseShotUserPrompt(story, shot, note, durationSec) },
      ])
      const parsed = parseModelText(text, (raw) => parseShotJson(raw, charIds))
      if (!parsed.ok) {
        setError(`按补充改镜不合格：${parsed.error}。当前镜未改。`)
        return
      }
      replaceShot(
        { ...parsed.value, durationSec, id: shot.id, order: shot.order, alts: undefined },
        true,
      )
    } catch (err) {
      setError(asErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onCopy() {
    const pack = buildPromptPack(story)
    try {
      await navigator.clipboard.writeText(pack)
    } catch {
      window.prompt('复制失败，请手动全选复制：', pack)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  function onPresetId(id: string) {
    setPresetId(id)
    const next = loadPreset(id)
    presetSource.current = next
    setHistory({})
    applyStory(next)
    setError(null)
  }

  function onRestore(item: { key: string; shot: Shot }) {
    const source = presetSource.current.shots.find((s) => s.id === shot.id)
    replaceShot({ ...item.shot, alts: mode === 'preset' ? source?.alts : undefined }, true)
  }

  return (
    <EditorChrome
      mode={mode}
      onMode={setMode}
      presetId={presetId}
      onPresetId={onPresetId}
      draft={draft}
      onDraft={setDraft}
      story={story}
      shot={shot}
      shotIndex={timeline.shotIndex}
      playing={timeline.playing}
      time={timeline.time}
      duration={timeline.duration}
      busy={busy}
      error={error}
      copied={copied}
      token={token}
      onToken={setToken}
      canGenerate={canGenerate}
      generateHint={generateHint}
      canRedo={canRedo}
      redoHint={redoHint}
      canRevise={canRevise}
      supplement={supplement}
      onSupplement={setSupplement}
      durationDraft={durationDraft}
      onDurationDraft={setDurationDraft}
      history={history[shot.id] ?? []}
      onRestore={onRestore}
      onGenerate={() => void onGenerate()}
      onLine={(line) => patchShot({ line })}
      onMotion={(motionId: MotionId) => patchShot({ motionId })}
      onRedo={() => void onRedo()}
      onRevise={() => void onRevise()}
      onTogglePlay={timeline.toggle}
      onSeekShot={timeline.seekToShot}
      onCopy={() => void onCopy()}
    >
      <div className="stage-stack" ref={rootRef}>
        {story.shots.map((item) => (
          <ShotStage key={`${story.id}-${item.id}`} story={story} shot={item} />
        ))}
      </div>
    </EditorChrome>
  )
}

function readToken(): TokenConfig {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return EMPTY_TOKEN
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_TOKEN
    const rec = parsed as Record<string, unknown>
    return {
      baseUrl: typeof rec.baseUrl === 'string' ? rec.baseUrl : '',
      apiKey: typeof rec.apiKey === 'string' ? rec.apiKey : '',
      model: typeof rec.model === 'string' ? rec.model : '',
    }
  } catch {
    return EMPTY_TOKEN
  }
}

function asErrorMessage(err: unknown): string {
  if (err instanceof TokenClientError) return err.message
  if (err instanceof Error) return err.message
  return '生成失败，上一版粗剪仍可播。'
}
