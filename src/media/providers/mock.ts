import type { MediaAsset } from '../../domain/shotJob.ts'
import type { PollResult, VideoGenRequest, VideoProvider } from '../types.ts'
import { getPresetImageByKeyword } from '../../assets/presets/index.ts'

type MockTaskState = {
  req: VideoGenRequest
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress: number
  asset?: MediaAsset
  error?: string
}

const mockTasks = new Map<string, MockTaskState>()

function inferPresetImage(imageSrc?: string, title?: string): string {
  if (imageSrc && (imageSrc.startsWith('data:') || imageSrc.startsWith('http') || imageSrc.startsWith('/') || imageSrc.includes('assets/'))) {
    return imageSrc
  }
  return getPresetImageByKeyword(title)
}

/**
 * 真实 Canvas + MediaRecorder 录制 9:16 动态短视频 Blob
 * 自动应用 Gemini 生成的高清商业主图与运镜模拟，并印制实验用标注
 */
async function recordCanvasWebm(
  shotId: string,
  title: string,
  caption: string,
  durationSec: number,
  imageSrc?: string
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

  // 1. 尝试异步预加载对应商品的真实商业大图
  const resolvedSrc = inferPresetImage(imageSrc, title)
  let imgObj: HTMLImageElement | null = null

  if (typeof Image !== 'undefined') {
    imgObj = new Image()
    imgObj.crossOrigin = 'anonymous'
    imgObj.src = resolvedSrc

    await Promise.race([
      new Promise((resolve) => {
        imgObj!.onload = () => resolve(true)
        imgObj!.onerror = () => resolve(false)
      }),
      new Promise((resolve) => setTimeout(resolve, 1200)), // 1.2s 超时防阻断
    ])
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

  const totalFrames = Math.max(20, Math.min(60, durationSec * 15)) // 帧数适度优化，保证顺畅渲染
  let frame = 0

  await new Promise<void>((resolveFrame) => {
    const render = () => {
      frame++
      const progress = frame / totalFrames

      // 1. 动态基础暗调底色
      ctx.fillStyle = '#090d16'
      ctx.fillRect(0, 0, 360, 640)

      // 2. 真实商品图的动态运镜 (Ken Burns Camera Animation)
      if (imgObj && imgObj.complete && imgObj.naturalWidth > 0) {
        ctx.save()

        // 依据分镜角色设定运镜曲线
        let scale = 1.05
        let panX = 0
        let panY = 0

        if (shotId === 's1') {
          // S1 痛点开场：缓慢推近
          scale = 1.0 + progress * 0.12
        } else if (shotId === 's2') {
          // S2 痛点共鸣：微摇镜
          scale = 1.08
          panX = Math.sin(progress * Math.PI) * 12
        } else if (shotId === 's3') {
          // S3 产品登场：动态展露
          scale = 1.15 - progress * 0.08
        } else if (shotId === 's4') {
          // S4 特写演示：局部放大
          scale = 1.22 + progress * 0.05
          panY = -15
        } else if (shotId === 's5') {
          // S5 效果证言：呼吸浮动
          scale = 1.1 + Math.sin(progress * Math.PI * 2) * 0.03
        } else {
          // S6 号召下单：利落定格推进
          scale = 1.06 + progress * 0.04
        }

        ctx.translate(180, 320)
        ctx.scale(scale, scale)
        ctx.translate(-180 + panX, -320 + panY)

        // 等比覆盖 (Cover) 绘制商品大图
        const imgRatio = imgObj.naturalWidth / imgObj.naturalHeight
        const canvasRatio = 360 / 640
        let dw = 360
        let dh = 640
        let dx = 0
        let dy = 0

        if (imgRatio > canvasRatio) {
          dh = 640
          dw = 640 * imgRatio
          dx = (360 - dw) / 2
        } else {
          dw = 360
          dh = 360 / imgRatio
          dy = (640 - dh) / 2
        }

        ctx.drawImage(imgObj, dx, dy, dw, dh)
        ctx.restore()
      } else {
        // 兜底渐变展示卡
        const grad = ctx.createLinearGradient(0, 0, 0, 640)
        grad.addColorStop(0, '#0f172a')
        grad.addColorStop(1, '#020617')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, 360, 640)
      }

      // 3. 上下暗部渐变阴影（确保文字与水印高清可见）
      const topGrad = ctx.createLinearGradient(0, 0, 0, 150)
      topGrad.addColorStop(0, 'rgba(0, 0, 0, 0.75)')
      topGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = topGrad
      ctx.fillRect(0, 0, 360, 150)

      const btmGrad = ctx.createLinearGradient(0, 480, 0, 640)
      btmGrad.addColorStop(0, 'rgba(0, 0, 0, 0)')
      btmGrad.addColorStop(1, 'rgba(0, 0, 0, 0.85)')
      ctx.fillStyle = btmGrad
      ctx.fillRect(0, 480, 360, 160)

      // 4. 用户要求的明确标注与水印（gemini3.8flash 实验标注）
      ctx.fillStyle = 'rgba(11, 20, 25, 0.88)'
      ctx.strokeStyle = 'rgba(57, 197, 187, 0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(14, 56, 332, 26, 13)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#7ec8e3'
      ctx.font = 'bold 10px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('✨ 由 gemini3.8flash 预生成 · 仅供功能实验 · 体验请配可灵等模型', 180, 73)

      // 5. 顶部镜号指示
      ctx.fillStyle = '#39c5bb'
      ctx.fillRect(16, 20, 64, 24)
      ctx.fillStyle = '#0b1419'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(shotId.toUpperCase(), 48, 36)

      ctx.fillStyle = '#85a9b5'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`9:16 商业分镜 · ${durationSec}s`, 344, 36)

      // 6. 底部字幕条（爆款高转化视觉标语）
      if (caption) {
        ctx.fillStyle = 'rgba(11, 20, 25, 0.88)'
        ctx.strokeStyle = 'rgba(57, 197, 187, 0.3)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(14, 535, 332, 50, 10)
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = '#fef08a'
        ctx.font = 'bold 14px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(caption.slice(0, 22), 180, 565)
      }

      // 7. 底部视频进度线
      ctx.fillStyle = '#39c5bb'
      ctx.fillRect(0, 636, 360 * progress, 4)

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
        req.durationSec || 3,
        req.imageBase64
      )

      task.progress = 100
      task.status = 'succeeded'
      task.asset = {
        shotId: req.shotId,
        url: videoUrl,
        durationSec: req.durationSec || 3,
        sizeBytes: 1024 * 350,
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
    return '¥0.00（实验预生成模式免费）'
  }
}

export const mockVideoProvider = new MockVideoProvider()
