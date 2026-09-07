import React, { useState, useRef, useEffect } from 'react'
import type { ShotJob } from '../../domain/shotJob.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import type { Story } from '../../types.ts'
import { voiceoverEngine, isTtsSupported } from '../../media/audio.ts'
import { downloadJianyingDraft, downloadJianyingDraftZip } from '../../export/jianyingDraft.ts'

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
  const [ttsEnabled, setTtsEnabled] = useState(isTtsSupported())
  const [zipExporting, setZipExporting] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const activeJob = jobs[currentShotIndex] || jobs[0]
  const activePlan = visualPlans[currentShotIndex] || visualPlans[0]
  const activeShot = story.shots[currentShotIndex] || story.shots[0]

  useEffect(() => {
    voiceoverEngine.enabled = ttsEnabled
  }, [ttsEnabled])

  useEffect(() => {
    if (videoRef.current && activeJob?.asset?.url) {
      videoRef.current.src = activeJob.asset.url
      videoRef.current.load()
      if (isPlaying) {
        videoRef.current.play().catch(() => setIsPlaying(false))
        if (ttsEnabled) {
          const line = activeShot?.line || activePlan?.caption || ''
          voiceoverEngine.speak(line, activeShot?.durationSec || 5)
        }
      }
    }
  }, [currentShotIndex, activeJob?.asset?.url, isPlaying, ttsEnabled, activeShot?.line, activePlan?.caption, activeShot?.durationSec])

  // 组件卸载时停止配音
  useEffect(() => {
    return () => {
      voiceoverEngine.stop()
    }
  }, [])

  const handleVideoEnded = () => {
    voiceoverEngine.stop()
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
      voiceoverEngine.stop()
      setIsPlaying(false)
    } else {
      videoRef.current
        .play()
        .then(() => {
          setIsPlaying(true)
          if (ttsEnabled) {
            const line = activeShot?.line || activePlan?.caption || ''
            voiceoverEngine.speak(line, activeShot?.durationSec || 5)
          }
        })
        .catch(() => setIsPlaying(false))
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
          6 镜真实视频无缝顺序播放。已采用真实 WebM 视频流播放（印制标注：由 gemini3.8flash 预生成 · 仅供功能实验用），非纯 HTML 静态排版。支持智能台词同步口播、剪映草稿工程导出与原片下载。
        </p>
      </div>

      <div className="player-workspace-grid">
        {/* 左侧：9:16 视频播放器 */}
        <div className="player-column">
          <div className="video-9-16-wrapper">
            {activeJob?.asset?.urlExpired ? (
              <div className="player-placeholder">
                ⚠️ 素材已失效
                <br />
                <span style={{ fontSize: '0.8em', opacity: 0.7 }}>
                  页面刷新后本地缓存丢失，请返回上一步重新生成此镜
                </span>
              </div>
            ) : activeJob?.asset?.url ? (
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
            <button
              type="button"
              className={`btn-control-tts ${ttsEnabled ? 'active' : ''}`}
              onClick={() => setTtsEnabled(!ttsEnabled)}
              title="切换浏览器智能台词口播配音"
            >
              {ttsEnabled ? '🔊 口播开' : '🔇 口播关'}
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

          {/* 剪映草稿工程导出卡 */}
          <div className="export-draft-card">
            <h4>📦 导出剪映 / CapCut 草稿工程</h4>
            <p>
              将 6 镜分镜素材与智能口播台词一键打包为剪映标准工程文件 (<code>draft_content.json</code>)。下载后直接放进电脑版剪映工程文件夹，自动对齐 9:16 画布、分段镜头与字幕轨道，立即可进行专业二次混剪与添加 BGM！
            </p>
            <button
              type="button"
              className="btn-export-jianying"
              onClick={() =>
                downloadJianyingDraft({
                  story,
                  visualPlans,
                  jobs,
                  projectTitle: story.title || 'WebLockShot_带货工程',
                })
              }
            >
              🎬 一键打包下载剪映草稿 (draft_content.json)
            </button>
            <button
              type="button"
              className="btn-export-jianying"
              style={{ marginLeft: '0.6rem' }}
              onClick={async () => {
                setZipExporting(true)
                try {
                  const result = await downloadJianyingDraftZip({
                    story,
                    visualPlans,
                    jobs,
                    projectTitle: story.title || 'WebLockShot_带货工程',
                  })
                  if (result.missingAssets.length > 0) {
                    console.warn('[WebLockShot] 剪映 zip 导出存在缺失素材:', result.missingAssets)
                  }
                } finally {
                  setZipExporting(false)
                }
              }}
              disabled={zipExporting}
              title="包含视频素材 + draft_content.json + 使用说明，解压后放入剪映草稿目录即可导入"
            >
              {zipExporting ? '📦 素材打包中...' : '📦 下载完整草稿 zip 包 (含素材)'}
            </button>
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
