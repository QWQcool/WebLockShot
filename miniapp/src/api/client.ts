import Taro from '@tarojs/taro'

/**
 * 后端 /api 反代适配层（M3）。
 *
 * 架构对齐主仓「预留接口做好不用」原则：
 * - 所有请求走 TARO_APP_API_BASE 指向的后端 /api 反代（伴生 server 或云端网关）；
 * - 密钥由服务端 WLS_KEYS 注入（未配置 WLS_KEYS = 透传模式，由远端显式返回 401），
 *   小程序端绝不持有 API Key；
 * - 响应契约与主仓 test/fixtures/kling 保持一致（code=0 / data.task_id / task_status）。
 */

// 未配置 TARO_APP_API_BASE 时回退本地开发地址；生产构建必须显式注入 HTTPS + 备案域名，
// 否则微信真机会因非 HTTPS 合法域名请求失败（错误信息已引导检查配置）。
const API_BASE = process.env.TARO_APP_API_BASE || 'http://localhost:5174'

export type SubmitTaskInput = {
  prompt: string
  negative?: string
  /** dataURL 形态首帧图；有值走 image2video，否则 text2video */
  imageBase64?: string
  durationSec: number
}

export type SubmitTaskResult = {
  taskId: string
  kind: 'text2video' | 'image2video'
}

export type TaskPollResult = {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress: number
  videoUrl?: string
  error?: string
}

async function request<T>(path: string, options: Taro.request.Option<any, any>): Promise<T> {
  try {
    const res = await Taro.request({
      url: `${API_BASE}${path}`,
      timeout: 15000,
      ...options,
    })
    if (res.statusCode >= 400) {
      const detail =
        res.data && typeof res.data === 'object' && 'error' in (res.data as Record<string, unknown>)
          ? String((res.data as Record<string, unknown>).error)
          : `HTTP ${res.statusCode}`
      throw new Error(`后端请求失败：${detail}`)
    }
    return res.data as T
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('后端请求失败')) throw err
    throw new Error('网络异常：无法连接后端服务，请检查 TARO_APP_API_BASE 配置与网络状态')
  }
}

/** 提交生片任务：经后端 /api/kling 反代（密钥由服务端 WLS_KEYS 注入） */
export async function submitVideoTask(input: SubmitTaskInput): Promise<SubmitTaskResult> {
  const kind: SubmitTaskResult['kind'] = input.imageBase64 ? 'image2video' : 'text2video'
  const body: Record<string, unknown> = {
    model_name: 'kling-v1',
    prompt: input.prompt,
    negative_prompt: input.negative || 'low quality, blurry, distorted, jitter, watermark',
    duration: String(Math.max(5, input.durationSec || 5)),
    aspect_ratio: '9:16',
  }
  if (input.imageBase64) body.image = input.imageBase64

  const data = await request<{ code?: number; message?: string; task_id?: string; data?: { task_id?: string } }>(
    `/api/kling/v1/videos/${kind}`,
    { method: 'POST', data: body, header: { 'Content-Type': 'application/json' } }
  )

  if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
    throw new Error(`可灵返回错误 [${data.code}]: ${data.message || '未知错误'}`)
  }
  const taskId = data.data?.task_id || data.task_id
  if (!taskId) throw new Error('后端未返回有效 taskId，请检查服务端引擎配置')
  return { taskId, kind }
}

/** 查询任务状态：响应结构与主仓 test/fixtures/kling/poll-*.json 契约一致 */
export async function pollVideoTask(task: { kind: string; taskId: string }): Promise<TaskPollResult> {
  const data = await request<{
    data?: { task_status?: string; task_status_msg?: string; task_result?: { videos?: Array<{ url?: string }> } }
    task_status?: string
    task_status_msg?: string
  }>(`/api/kling/v1/videos/${task.kind}/${task.taskId}`, { method: 'GET' })

  const taskStatus = data.data?.task_status || data.task_status || ''

  if (taskStatus === 'succeed') {
    const videoUrl = data.data?.task_result?.videos?.[0]?.url || ''
    if (!videoUrl) throw new Error('任务成功但未返回视频地址')
    return { status: 'succeeded', progress: 100, videoUrl }
  }
  if (taskStatus === 'failed') {
    return {
      status: 'failed',
      progress: 100,
      error: data.data?.task_status_msg || data.task_status_msg || '远端生成失败',
    }
  }
  if (taskStatus === 'submitted') return { status: 'queued', progress: 15 }
  return { status: 'running', progress: 50 }
}
