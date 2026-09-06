import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'

type MockTaskState = {
  req: VideoGenRequest
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress: number
  asset?: MediaAsset
  error?: string
}

const mockTasks = new Map<string, MockTaskState>()

/**
 * 真实 Canvas + MediaRecorder 录制 9:16 动态短视频 Blob
 */
async function recordCanvasWebm(
  shotId: string,
  title: string,
  caption: string,
  durationSec: number
): Promise<string> {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof MediaRecorder === 'undefined'
  ) {
    // 纯 Node/测试环境降级：返回虚拟资产 URL
    return `https://mock.weblockshot.local/video/${shotId}.webm`
  }

  const canvas = document.createElement('canvas')
  canvas.width = 360
  canvas.height = 640
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return `https://mock.weblockshot.local/video/${shotId}.webm`
  }

  const stream = canvas.captureStream(30)
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm'

  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks: Blob[] = []

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }

  const recordPromise = new Promise<string>((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      resolve(url)
    }
  })

  recorder.start()

  const totalFrames = Math.max(15, Math.min(60, durationSec * 15)) // 帧数适度加速，兼顾体验与真录制
  let frame = 0

  await new Promise<void>((resolveFrame) => {
    const render = () => {
      frame++
      const progress = frame / totalFrames

      // 1. 动态渐变背景
      const grad = ctx.createLinearGradient(0, 0, 0, 640)
      grad.addColorStop(0, '#0f172a')
      grad.addColorStop(0.5, '#1e293b')
      grad.addColorStop(1, '#020617')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 360, 640)

      // 2. 动感发光装饰圆球
      const circleY = 240 + Math.sin(progress * Math.PI * 2) * 40
      ctx.beginPath()
      ctx.arc(180, circleY, 80 + Math.sin(progress * Math.PI) * 20, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(230, 57, 70, 0.15)'
      ctx.fill()

      // 3. 镜号徽标
      ctx.fillStyle = '#e63946'
      ctx.fillRect(24, 32, 72, 28)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 14px sans-serif'
      ctx.fillText(shotId.toUpperCase(), 36, 51)

      // 4. 主标题与指示
      ctx.fillStyle = '#f8fafc'
      ctx.font = 'bold 18px sans-serif'
      ctx.fillText(title.slice(0, 16) || '带货视频分镜', 24, 96)

      // 5. 模拟产品展示卡
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
      ctx.lineWidth = 1
      ctx.roundRect(40, 160, 280, 240, 16)
      ctx.fill()
      ctx.stroke()

      // 产品动态脉冲
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 22px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('✨ 爆款好物展示', 180, 270)
      ctx.font = '14px sans-serif'
      ctx.fillStyle = '#94a3b8'
      ctx.fillText(`9:16 模拟出片 (帧率: 30fps)`, 180, 305)

      // 6. 底部字幕条
      if (caption) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
        ctx.fillRect(16, 510, 328, 54)
        ctx.fillStyle = '#fef08a'
        ctx.font = 'bold 15px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(caption.slice(0, 20), 180, 542)
      }

      // 7. 顶部进度条
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.fillRect(0, 0, 360, 4)
      ctx.fillStyle = '#e63946'
      ctx.fillRect(0, 0, 360 * progress, 4)

      ctx.textAlign = 'left'

      if (frame < totalFrames) {
        requestAnimationFrame(render)
      } else {
        resolveFrame()
      }
    }
    render()
  })

  recorder.stop()
  return recordPromise
}

export class MockVideoProvider implements VideoProvider {
  readonly id = 'mock' as const

  async submit(req: VideoGenRequest): Promise<{ taskId: string }> {
    const taskId = `mock_task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

    mockTasks.set(taskId, {
      req,
      status: 'queued',
      progress: 0,
    })

    // 启动异步模拟真实录制与进度轮询
    this.executeTask(taskId, req)

    return { taskId }
  }

  private async executeTask(taskId: string, req: VideoGenRequest) {
    const task = mockTasks.get(taskId)
    if (!task) return

    task.status = 'running'
    task.progress = 15

    try {
      // 真实录制视频流（若在浏览器环境）
      const videoUrl = await recordCanvasWebm(
        req.shotId,
        req.title || '电商分镜',
        req.caption || req.prompt,
        req.durationSec || 3
      )

      task.progress = 100
      task.status = 'succeeded'
      task.asset = {
        shotId: req.shotId,
        url: videoUrl,
        durationSec: req.durationSec || 3,
        sizeBytes: 1024 * 180,
      }
    } catch (err) {
      task.status = 'failed'
      task.error = String(err)
    }
  }

  async poll(taskId: string): Promise<PollResult> {
    const task = mockTasks.get(taskId)
    if (!task) {
      return { status: 'failed', error: '任务不存在或已被清理' }
    }
    return {
      status: task.status,
      progress: task.progress,
      error: task.error,
    }
  }

  async getAsset(taskId: string): Promise<MediaAsset> {
    const task = mockTasks.get(taskId)
    if (!task || !task.asset) {
      throw new Error(`资产尚未生成完成 (状态: ${task?.status})`)
    }
    return task.asset
  }

  estimateCost(_req: VideoGenRequest): string {
    return '¥0.00（模拟生成免费）'
  }
}

export const mockVideoProvider = new MockVideoProvider()
