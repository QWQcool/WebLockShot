import type { Character, Shot, Story } from '../types'
import { MOTION_LABEL, SHOT_SIZE_LABEL } from '../types'

type Props = {
  story: Story
  shot: Shot
}

export function ShotStage({ story, shot }: Props) {
  const cast = shot.cast
    .map((id) => story.characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c))
  const speaker = shot.lineSpeaker
    ? story.characters.find((c) => c.id === shot.lineSpeaker)
    : undefined
  const prop = shot.prop ?? 'none'

  return (
    <div
      className="stage"
      data-shot={shot.id}
      data-size={shot.shotSize}
      data-prop={prop}
      data-motion={shot.motionId}
    >
      <div className="layer-move">
        <div className="layer-bg" aria-hidden="true">
          <span className="bg-grain" />
          <span className="bg-wash" />
        </div>
        <div className="layer-cast">
          {cast.map((person) => (
            <div
              key={person.id}
              className="sil"
              style={{ ['--sil' as string]: person.color }}
            >
              <span className="sil-head" />
              <span className="sil-body" />
              <span className="sil-name">{person.name}</span>
            </div>
          ))}
        </div>
        <div className="layer-prop" data-prop={prop}>
          {prop === 'door' ? (
            <div className="prop-door" aria-hidden="true">
              <span className="prop-slit" />
            </div>
          ) : null}
          {prop === 'note' ? (
            <div className="prop-note" aria-hidden="true">
              <span className="prop-note-text">{shot.line || '字条'}</span>
            </div>
          ) : null}
          {prop === 'lock' ? (
            <div className="prop-lock" aria-hidden="true">
              <span />
            </div>
          ) : null}
        </div>
      </div>
      <div className="layer-line" data-has-line={shot.line.trim() ? '1' : '0'}>
        {shot.line.trim() ? (
          <>
            <span className="line-who">{speaker?.name ?? '字幕'}</span>
            <span className="line-text">{shot.line}</span>
          </>
        ) : null}
      </div>
      <div className="layer-slate">
        <span>镜 {shot.order}</span>
        <span>
          {SHOT_SIZE_LABEL[shot.shotSize]} · {MOTION_LABEL[shot.motionId]}
        </span>
        <span>{shot.durationSec.toFixed(0)}s</span>
      </div>
    </div>
  )
}
