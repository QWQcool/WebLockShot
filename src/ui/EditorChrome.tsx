import type { ReactNode } from 'react'
import {
  MOTION_IDS,
  MOTION_LABEL,
  type EditorMode,
  type MotionId,
  type Shot,
  type Story,
  type StoryInput,
  type TokenConfig,
} from '../types'
import { modeFooter, modeLabel } from '../modes'
import { PRESETS } from '../presets/load'
import type { ShotHistoryItem } from '../shotHistory'

type Props = {
  mode: EditorMode
  onMode: (mode: EditorMode) => void
  presetId: string
  onPresetId: (id: string) => void
  draft: StoryInput
  onDraft: (draft: StoryInput) => void
  story: Story
  shot: Shot
  shotIndex: number
  playing: boolean
  time: number
  duration: number
  busy: boolean
  error: string | null
  copied: boolean
  token: TokenConfig
  onToken: (token: TokenConfig) => void
  canGenerate: boolean
  generateHint: string
  canRedo: boolean
  redoHint: string
  canRevise: boolean
  supplement: string
  onSupplement: (value: string) => void
  durationDraft: string
  onDurationDraft: (value: string) => void
  history: ShotHistoryItem[]
  onRestore: (item: ShotHistoryItem) => void
  onGenerate: () => void
  onLine: (line: string) => void
  onMotion: (motionId: MotionId) => void
  onRedo: () => void
  onRevise: () => void
  onTogglePlay: () => void
  onSeekShot: (index: number) => void
  onCopy: () => void
  children: ReactNode
}

export function EditorChrome(props: Props) {
  const {
    mode,
    onMode,
    presetId,
    onPresetId,
    draft,
    onDraft,
    story,
    shot,
    shotIndex,
    playing,
    time,
    duration,
    busy,
    error,
    copied,
    token,
    onToken,
    canGenerate,
    generateHint,
    canRedo,
    redoHint,
    canRevise,
    supplement,
    onSupplement,
    durationDraft,
    onDurationDraft,
    history,
    onRestore,
    onGenerate,
    onLine,
    onMotion,
    onRedo,
    onRevise,
    onTogglePlay,
    onSeekShot,
    onCopy,
    children,
  } = props

  const presetLocked = mode === 'preset'
  const progress = duration > 0 ? Math.min(1, time / duration) : 0
  const themeValue = presetLocked ? story.input.theme : draft.theme

  return (
    <div className="desk">
      <header className="mast">
        <div className="mast-brand">
          <span className="mast-slate">WEB锁镜</span>
          <p className="mast-tag">出可灵之前，先锁这六镜</p>
        </div>
        <div className="mast-actions">
          <div className="mode-switch" role="tablist" aria-label="工作模式">
            {(['preset', 'token'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={mode === id ? 'is-on' : ''}
                onClick={() => onMode(id)}
              >
                {modeLabel(id)}
              </button>
            ))}
          </div>
          <button type="button" className="btn-export" onClick={onCopy}>
            {copied ? '已复制提示词' : '导出提示词'}
          </button>
        </div>
      </header>

      <div className="desk-body">
        <aside className="rail">
          <section className="panel">
            <h2 className="panel-h">这一分钟</h2>
            {mode === 'preset' ? (
              <label className="field">
                <span>内置故事（预设）</span>
                <select
                  value={presetId}
                  onChange={(e) => onPresetId(e.target.value)}
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}（{p.theme}）
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="panel-note">
                主题 + 三个短框，不写长剧本。密钥只进 sessionStorage。
              </p>
            )}
            <Field
              label="主题"
              value={themeValue}
              readOnly={presetLocked}
              onChange={(theme) => onDraft({ ...draft, theme })}
            />
            <Field
              label="人物"
              value={presetLocked ? story.input.character : draft.character}
              readOnly={presetLocked}
              onChange={(character) => onDraft({ ...draft, character })}
            />
            <Field
              label="冲突"
              value={presetLocked ? story.input.conflict : draft.conflict}
              readOnly={presetLocked}
              onChange={(conflict) => onDraft({ ...draft, conflict })}
            />
            <Field
              label="钩子"
              value={presetLocked ? story.input.hook : draft.hook}
              readOnly={presetLocked}
              onChange={(hook) => onDraft({ ...draft, hook })}
              accent
            />
            <button
              type="button"
              className="btn-primary"
              disabled={!canGenerate || busy}
              onClick={onGenerate}
            >
              {busy ? '拆镜中…' : mode === 'preset' ? '载入该预设' : '生成粗剪'}
            </button>
            {!canGenerate ? <p className="hint">{generateHint}</p> : null}
            {presetLocked ? (
              <p className="hint">预设模拟只供预览。台词和运动不能改，重做只会切到官方第二镜。 </p>
            ) : null}
          </section>

          {mode === 'token' ? (
            <section className="panel">
              <h2 className="panel-h">会话密钥</h2>
              <label className="field">
                <span>API Base URL</span>
                <input
                  value={token.baseUrl}
                  onChange={(e) => onToken({ ...token, baseUrl: e.target.value })}
                  placeholder="https://openrouter.ai/api/v1"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>API Key</span>
                <input
                  type="password"
                  value={token.apiKey}
                  onChange={(e) => onToken({ ...token, apiKey: e.target.value })}
                  placeholder="只存在本标签页"
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span>模型名</span>
                <input
                  value={token.model}
                  onChange={(e) => onToken({ ...token, model: e.target.value })}
                  placeholder="deepseek/deepseek-chat"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            </section>
          ) : null}

          <section className="panel">
            <h2 className="panel-h">锁这一镜</h2>
            <p className="shot-purpose">{shot.purpose}</p>
            <label className={presetLocked ? 'field is-locked' : 'field'}>
              <span>台词</span>
              <textarea
                rows={3}
                value={shot.line}
                readOnly={presetLocked}
                onChange={(e) => onLine(e.target.value)}
              />
            </label>
            <label className={presetLocked ? 'field is-locked' : 'field'}>
              <span>运动模板</span>
              <select
                value={shot.motionId}
                disabled={presetLocked}
                onChange={(e) => onMotion(e.target.value as MotionId)}
              >
                {MOTION_IDS.map((id) => (
                  <option key={id} value={id}>
                    {MOTION_LABEL[id]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-ghost"
              disabled={!canRedo || busy}
              onClick={onRedo}
            >
              重做这一镜
            </button>
            <p className="hint">{redoHint}</p>

            {mode === 'token' ? (
              <div className="revise-block">
                <label className="field">
                  <span>补充要改变的内容</span>
                  <textarea
                    rows={3}
                    value={supplement}
                    onChange={(e) => onSupplement(e.target.value)}
                    placeholder="例如：台词更狠一点，运动换成推近"
                  />
                </label>
                <label className="field">
                  <span>镜头时长（秒）</span>
                  <input
                    inputMode="decimal"
                    value={durationDraft}
                    onChange={(e) => onDurationDraft(e.target.value)}
                    placeholder={`不填则沿用 ${shot.durationSec} 秒`}
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!canRevise || busy}
                  onClick={onRevise}
                >
                  按补充改这一镜
                </button>
                <p className="hint">
                  基于当前镜修改，不另起炉灶。时长留空则用上一版这一镜的秒数。
                </p>
              </div>
            ) : null}

            <details className="history">
              <summary>观看历史镜头</summary>
              {history.length === 0 ? (
                <p className="hint">这一镜还没有历史。重做或按补充修改后会出现，方便还原。</p>
              ) : (
                <ul className="history-list">
                  {history.map((item, i) => (
                    <li key={item.key} className="history-item">
                      <div>
                        <b>版本 {history.length - i}</b>
                        <span>
                          {MOTION_LABEL[item.shot.motionId]} · {item.shot.durationSec}s
                        </span>
                        <p>{item.shot.line.trim() || '（无对白）'}</p>
                      </div>
                      <button type="button" onClick={() => onRestore(item)}>
                        还原
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </section>

          {error ? (
            <p className="err" role="alert">
              {error}
            </p>
          ) : null}
        </aside>

        <main className="bay">
          <div className="monitor">
            <div className="monitor-bezel">
              <div className="monitor-meta">
                <span className={playing ? 'tally is-live' : 'tally'} />
                <span>
                  《{story.title}》 · {story.input.theme}
                </span>
                <span>{playing ? 'REC' : 'PAUSE'}</span>
              </div>
              <div className="monitor-glass">
                {busy ? <div className="busy">拆镜中…</div> : null}
                {children}
              </div>
            </div>
          </div>
        </main>
      </div>

      <footer className="strip">
        <button
          type="button"
          className="play"
          onClick={onTogglePlay}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? '暂停' : '播放'}
        </button>
        <div className="cells">
          {story.shots.map((item, i) => {
            const width = (item.durationSec / duration) * 100
            return (
              <button
                key={item.id}
                type="button"
                aria-label={`镜 ${item.order}，${item.durationSec} 秒`}
                aria-current={i === shotIndex ? 'true' : undefined}
                className={i === shotIndex ? 'cell is-now' : 'cell'}
                style={{ flexGrow: item.durationSec, flexBasis: `${width}%` }}
                onClick={() => onSeekShot(i)}
              >
                <b>{item.order}</b>
                <span>{item.durationSec}s</span>
              </button>
            )
          })}
          <span className="head" style={{ left: `${progress * 100}%` }} />
        </div>
        <div className="tc">
          {fmt(time)} / {fmt(duration)}
        </div>
      </footer>

      <p className="colophon">{modeFooter(mode)}</p>
    </div>
  )
}

function Field(props: {
  label: string
  value: string
  readOnly: boolean
  accent?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className={props.accent ? 'field is-hook' : props.readOnly ? 'field is-locked' : 'field'}>
      <span>{props.label}</span>
      <textarea
        rows={2}
        value={props.value}
        readOnly={props.readOnly}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  )
}

function fmt(seconds: number): string {
  const t = Math.max(0, seconds)
  const mm = Math.floor(t / 60)
  const ss = t - mm * 60
  return `${mm}:${ss.toFixed(1).padStart(4, '0')}`
}
