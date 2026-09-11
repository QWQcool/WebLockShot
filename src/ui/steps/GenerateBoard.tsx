import React from 'react'
import type { ShotJob } from '../../domain/shotJob.ts'
import { ENGINE_OPTIONS } from '../components/PipelineEngineBar.tsx'

type Props = {
  jobs: ShotJob[]
  onRetryShot: (shotId: string) => void
  onNext: () => void
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  queued: { label: '排队中', color: '#94A3B8', icon: '⏳' },
  running: { label: '真实录制生成中', color: '#38BDF8', icon: '⚡' },
  succeeded: { label: '出片成功', color: '#10B981', icon: '✓' },
  failed: { label: '生成异常', color: '#EF4444', icon: '✕' },
}

export const GenerateBoard: React.FC<Props> = ({
  jobs,
  onRetryShot,
  onNext,
}) => {
  const allSucceeded =
    jobs.length === 6 && jobs.every((j) => j.status === 'succeeded')
  const completedCount = jobs.filter((j) => j.status === 'succeeded').length

  return (
    <div className="generate-board-container">
      <div className="step-header-intro">
        <h2>⑥ 媒体渲染生成台（浏览器串行队列）</h2>
        <p>
          单机串行队列调度中。支持快手可灵 (Kling) / 字节即梦 / ComfyUI 私有 GPU 集群官方真实出片，或 Mock 对 9:16 动态舞台进行极速录制。
        </p>
      </div>

      {/* 总体进度条 */}
      <div className="overall-progress-card">
        <div className="progress-top">
          <span className="progress-title">
            总体生成进度：{completedCount} / 6 镜
          </span>
          <span className="queue-hint">🛡️ 任务具备 sha1 幂等键防重保护</span>
        </div>
        <div className="progress-bar-bg">
          <div
            className="progress-bar-fill"
            style={{ width: `${(completedCount / 6) * 100}%` }}
          />
        </div>
      </div>

      {/* 6 张任务卡片 */}
      <div className="jobs-cards-grid">
        {jobs.map((job) => {
          const cfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.queued

          return (
            <div key={job.shotId} className={`job-card status-${job.status}`}>
              <div className="job-card-top">
                <span className="job-shot-id">{job.shotId.toUpperCase()}</span>
                <span
                  className="status-badge"
                  style={{
                    backgroundColor: cfg.color + '22',
                    color: cfg.color,
                    borderColor: cfg.color,
                  }}
                >
                  {cfg.icon} {cfg.label}
                </span>
              </div>

              {/* R4：刷新中断后被受控恢复的任务，明确告知可继续 */}
              {job.requeued && job.status === 'queued' && (
                <div className="job-error-box" role="status">
                  <p>🔁 已恢复，可继续（页面刷新中断的任务已自动重新排队）</p>
                </div>
              )}

              <div className="job-body">
                <div className="job-meta-row">
                  <span className="meta-label">Provider：</span>
                  {/* M1：按引擎 id 如实展示（此前只识别 kling，其余一律显示 Mock，海外引擎会误标） */}
                  <span className="meta-val">
                    {ENGINE_OPTIONS.find((o) => o.id === job.provider)?.label ?? job.provider}
                  </span>
                </div>
                <div className="job-meta-row">
                  <span className="meta-label">重试次数：</span>
                  <span className="meta-val">{job.attempt} 次</span>
                </div>
                <div className="job-meta-row">
                  <span className="meta-label">幂等键：</span>
                  <span className="meta-val font-mono">{job.taskKey.slice(0, 10)}...</span>
                </div>

                {job.status === 'running' && (
                  <div className="job-progress-wrap">
                    <div className="mini-progress-bg">
                      <div
                        className="mini-progress-fill"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                    <span className="progress-num">{job.progress}%</span>
                  </div>
                )}

                {job.error && (
                  <div className="job-error-box">
                    <p>{job.error}</p>
                    <button
                      type="button"
                      className="btn-retry-sm"
                      onClick={() => onRetryShot(job.shotId)}
                    >
                      🔄 立即重试该镜
                    </button>
                  </div>
                )}

                {job.status === 'succeeded' && job.asset && (
                  <div className="asset-ready-hint">
                    <span>🎬 视频资产就绪（{(job.asset.sizeBytes! / 1024).toFixed(0)} KB）</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部行动栏 */}
      <div className="step-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={!allSucceeded}
          onClick={onNext}
        >
          {allSucceeded ? '🎉 全部 6 镜生成完成，前往审片播放器 →' : '⏳ 正在等待 6 镜依次生成中...'}
        </button>
      </div>
    </div>
  )
}
