import React, { useState, useRef, useEffect } from 'react'
import type { ShotJob } from '../../domain/shotJob.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import type { Story } from '../../types.ts'

type Props = {
  jobs: ShotJob[]
  story: Story
  visualPlans: VisualPlan[]
  onRegenerateSingleShot: (shotId: string) => void
  onRestartPipeline: () => void
}

export const DeliverPlayer: React.FC<Props> = ({
  jobs,
  story,
  visualPlans,
  onRegenerateSingleShot,
  onRestartPipeline,
}) => {
  const [currentShotIndex, setCurrentShotIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const activeJob = jobs[currentShotIndex] || jobs[0]
  const activePlan = visualPlans[currentShotIndex] || visualPlans[0]
  const activeShot = story.shots[currentShotIndex] || story.shots[0]

  useEffect(() => {
    if (videoRef.current && activeJob?.asset?.url) {
      videoRef.current.src = activeJob.asset.url
      videoRef.current.load()
      if (isPlaying) {
        videoRef.current.play().catch(() => setIsPlaying(false))
      }
    }
  }, [currentShotIndex, activeJob?.asset?.url, isPlaying])

  const handleVideoEnded = () => {
    if (currentShotIndex < jobs.length - 1) {
      // 自动播放下一镜
      setCurrentShotIndex((prev) => prev + 1)
    } else {
      // 整条 6 镜播完
      setIsPlaying(false)
      setCurrentShotIndex(0)
    }
  }

  const togglePlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
      setIsPlaying(false)
    } else {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
    }
  }

  const handleDownloadActive = () => {
    if (!activeJob?.asset?.url) return
    const a = document.createElement('a')
    a.href = activeJob.asset.url
    a.download = `${activeShot.id}_commercial_clip.webm`
    a.click()
  }

  return (
    <div className="deliver-player-container">
      <div className="step-header-intro">
        <h2>⑦ 审片与交付播放器（6 镜连播）</h2>
        <p>
          6 镜视频无缝顺序播放。支持同步大字幕叠加、单镜不满意单独重生成、以及本地资产下载。
        </p>
      </div>

      <div className="player-workspace-grid">
        {/* 左侧：9:16 视频播放器 */}
        <div className="player-column">
          <div className="video-9-16-wrapper">
            {activeJob?.asset?.url ? (
              <video
                ref={videoRef}
                src={activeJob.asset.url}
                className="main-video-player"
                playsInline
                onEnded={handleVideoEnded}
                onClick={togglePlay}
              />
            ) : (
              <div className="player-placeholder">视频未就绪</div>
            )}

            {/* 贴片/烧录同步字幕 */}
            {activePlan?.caption && (
              <div className="video-caption-overlay">
                <span className="caption-text">{activePlan.caption}</span>
              </div>
            )}

            {/* 顶部镜号指示 */}
            <div className="video-shot-badge">
              <span>{activeShot?.id.toUpperCase()}</span>
              <span className="divider">/</span>
              <span>S6</span>
            </div>

            {/* 居中播放控制按钮 */}
            {!isPlaying && (
              <button type="button" className="video-center-play-btn" onClick={togglePlay}>
                ▶
              </button>
            )}
          </div>

          {/* 播放条控制器 */}
          <div className="player-controls-bar">
            <button
              type="button"
              className="btn-control-icon"
              onClick={() => setCurrentShotIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentShotIndex === 0}
            >
              ⏮ 上一镜
            </button>
            <button type="button" className="btn-control-play" onClick={togglePlay}>
              {isPlaying ? '⏸ 暂停' : '▶ 播放'}
            </button>
            <button
              type="button"
              className="btn-control-icon"
              onClick={() => setCurrentShotIndex((prev) => Math.min(jobs.length - 1, prev + 1))}
              disabled={currentShotIndex === jobs.length - 1}
            >
              下一镜 ⏭
            </button>
          </div>
        </div>

        {/* 右侧：单镜列表与单镜重试交付 */}
        <div className="deliver-details-column">
          <div className="playlist-card">
            <h3>分镜列表（点选跳转）</h3>
            <div className="playlist-items">
              {jobs.map((job, idx) => {
                const plan = visualPlans[idx]
                const shot = story.shots[idx]
                const isActive = idx === currentShotIndex

                return (
                  <div
                    key={job.shotId}
                    className={`playlist-item ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setCurrentShotIndex(idx)
                      setIsPlaying(true)
                    }}
                  >
                    <span className="item-order">{job.shotId.toUpperCase()}</span>
                    <div className="item-info">
                      <span className="item-purpose">{shot?.purpose}</span>
                      <small className="item-caption">{plan?.caption || '无字幕'}</small>
                    </div>
                    <span className="item-dur">{shot?.durationSec}s</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 单镜局部重新生成操作卡 */}
          <div className="single-shot-action-card">
            <h4>🎯 单镜局部重新生成</h4>
            <p>
              若对当前 <strong>{activeShot?.id.toUpperCase()}</strong> 镜头的画面不满意，可单独重新生成，无需重跑整条链路。
            </p>
            <div className="single-actions-bar">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onRegenerateSingleShot(activeShot.id)}
              >
                🔄 重新生成此镜 ({activeShot?.id.toUpperCase()})
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleDownloadActive}
              >
                💾 下载此镜视频 (WebM)
              </button>
            </div>
          </div>

          {/* 新一轮生成入口 */}
          <div className="pipeline-restart-box">
            <button type="button" className="btn-primary" onClick={onRestartPipeline}>
              ✨ 新建下一个爆款带货视频
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
