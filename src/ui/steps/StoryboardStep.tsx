import React, { useRef, useState } from 'react'
import type { Story, Shot } from '../../types.ts'
import { ShotStage } from '../../stage/ShotStage.tsx'
import { useShotTimeline } from '../../stage/useShotTimeline.ts'
import { MOTION_LABEL, SHOT_SIZE_LABEL } from '../../types.ts'

type Props = {
  story: Story
  onStoryChange: (updated: Story) => void
  onNext: () => void
}

export const StoryboardStep: React.FC<Props> = ({
  story,
  onStoryChange,
  onNext,
}) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const [timelineKey, setTimelineKey] = useState('sell-tl-0')
  const { time, shotIndex, playing, play, pause, seekToShot, duration } =
    useShotTimeline(story, false, rootRef, timelineKey)

  const activeShot: Shot = story.shots[shotIndex] || story.shots[0]

  const handleShotDurationChange = (shotId: string, delta: number) => {
    const updatedShots = story.shots.map((s) => {
      if (s.id !== shotId) return s
      const newDur = Math.max(2, Math.min(5, s.durationSec + delta))
      return { ...s, durationSec: newDur }
    })
    onStoryChange({ ...story, shots: updatedShots })
    setTimelineKey((prev) => `${prev}-upd`)
  }

  return (
    <div className="storyboard-step-container">
      <div className="step-header-intro">
        <h2>④ 9:16 分镜动态预演（GSAP 引擎）</h2>
        <p>
          遵循 `sell-stage` 带货契约将脚本编译为 6 镜动态分镜。在出片前锁好节奏、镜头运镜与台词。
        </p>
      </div>

      <div className="stage-workspace-grid">
        {/* 左侧：9:16 动态舞台 */}
        <div className="stage-column">
          <div className="stage-viewport-box" ref={rootRef}>
            {story.shots.map((shot, idx) => (
              <div
                key={shot.id}
                className="stage-instance-wrapper"
                style={{ display: idx === shotIndex ? 'block' : 'none' }}
              >
                <ShotStage story={story} shot={shot} />
              </div>
            ))}
          </div>

          {/* 播放控制条 */}
          <div className="stage-controls">
            <button
              type="button"
              className="btn-play-pause"
              onClick={playing ? pause : play}
            >
              {playing ? '⏸ 暂停' : '▶ 播放预演'}
            </button>
            <div className="time-display">
              <span>{time.toFixed(1)}s</span> / <span>{duration.toFixed(1)}s</span>
            </div>
          </div>
        </div>

        {/* 右侧：6 镜分镜表与参数调节 */}
        <div className="shots-list-column">
          <h3>6 镜分镜节奏表（点击跳转预览）</h3>
          <div className="shots-cards-scroll">
            {story.shots.map((shot, idx) => {
              const isCurrent = idx === shotIndex
              return (
                <div
                  key={shot.id}
                  className={`shot-card-row ${isCurrent ? 'active' : ''}`}
                  onClick={() => seekToShot(idx)}
                >
                  <div className="row-left">
                    <span className="shot-pill">{shot.id.toUpperCase()}</span>
                    <span className="shot-size-pill">
                      {SHOT_SIZE_LABEL[shot.shotSize] || shot.shotSize}
                    </span>
                    <span className="motion-pill">
                      {MOTION_LABEL[shot.motionId] || shot.motionId}
                    </span>
                  </div>

                  <div className="row-center">
                    <p className="shot-purpose">{shot.purpose}</p>
                    {shot.line && <p className="shot-line">“{shot.line}”</p>}
                  </div>

                  <div className="row-right">
                    <div className="duration-stepper">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleShotDurationChange(shot.id, -1)
                        }}
                        disabled={shot.durationSec <= 2}
                      >
                        -
                      </button>
                      <span className="dur-text">{shot.durationSec}s</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleShotDurationChange(shot.id, 1)
                        }}
                        disabled={shot.durationSec >= 5}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="shot-detail-box">
            <h4>当前焦点：{activeShot.id.toUpperCase()} 详细说明</h4>
            <p><strong>推进目标：</strong>{activeShot.purpose}</p>
            <p><strong>口播/台词：</strong>{activeShot.line || '无台词，纯动作/环境音'}</p>
            <p><strong>角色/主体：</strong>{activeShot.cast.join(', ')}</p>
          </div>
        </div>
      </div>

      {/* 底部行动栏 */}
      <div className="step-actions">
        <button type="button" className="btn-primary" onClick={onNext}>
          下一步：编译视觉方案与正向提示词 →
        </button>
      </div>
    </div>
  )
}
