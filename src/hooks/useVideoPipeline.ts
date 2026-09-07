import { useCallback, useEffect, useRef, useState } from 'react'
import type { VideoGenRequest } from '../media/types.ts'
import { resolveVideoProvider } from '../director/nodes/executorNode.ts'
import { walletManager } from '../domain/wallet.ts'
import { circuitBreaker } from '../domain/fsm.ts'
import { idempotencyManager } from '../domain/idempotency.ts'
import { getPollingWindow, pollSleep } from '../domain/pollingConfig.ts'

/**
 * 共享视频生成管线 Hook (Video Pipeline)
 *
 * 钱包两阶段事务 / 熔断 / 幂等锁 / 轮询 / 超时退款逻辑收敛于此，
 * SingleAgentStudio 与 MultiAgentStudio 只保留渲染与交互职责，杜绝第三份复制粘贴。
 * 组件卸载时自动停止轮询并释放锁（AbortController），杜绝内存泄漏与僵尸扣费。
 */

export type VideoPipelineParams = {
  providerId: 'mock' | 'kling' | 'jimeng' | 'comfyui'
  /** 幂等意图标识（区分单 Agent / 多 Agent / 其它入口） */
  intent: string
  prompt: string
  negative?: string
  imageBase64?: string
  referenceVideoUrl?: string
  motionPrompt?: string
  durationSec: number
  title: string
  /** 钱包流水描述（如「单 Agent 直出」） */
  billingLabel: string
}

export type VideoPipelineState = {
  running: boolean
  progress: number
  statusText: string
  videoUrl: string | null
  error: string | null
}

const IDLE_STATE: VideoPipelineState = {
  running: false,
  progress: 0,
  statusText: '',
  videoUrl: null,
  error: null,
}

export function useVideoPipeline() {
  const [state, setState] = useState<VideoPipelineState>(IDLE_STATE)
  const abortRef = useRef<AbortController | null>(null)
  // 组件卸载后标记，防止异步回调再触碰 setState / 资金
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // 卸载即中断轮询；任务凭据保留在钱包账本，孤儿冻结由 TTL 兜底回收
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    setState(IDLE_STATE)
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const run = useCallback(async (params: VideoPipelineParams): Promise<void> => {
    const { providerId, intent, prompt, negative, imageBase64, referenceVideoUrl, motionPrompt, durationSec, title, billingLabel } = params

    // 0. 熔断检查
    const breakerCheck = circuitBreaker.isAvailable(providerId)
    if (!breakerCheck.allowed) {
      setState({ ...IDLE_STATE, error: breakerCheck.reason || '当前服务暂时熔断保护中' })
      return
    }

    // 1. 幂等防连击锁
    const taskKey = idempotencyManager.generateKey({
      intent,
      providerId,
      prompt,
      durationSec,
      extra: title,
    })
    const lockResult = idempotencyManager.acquireLock(taskKey)
    if (!lockResult.success) {
      setState({ ...IDLE_STATE, error: lockResult.reason || '任务正在执行中，请勿连击' })
      return
    }

    // 2. 钱包两阶段事务：阶段 1 (预冻结)
    const cost = walletManager.getCost(providerId, 1)
    const freezeSuccess = walletManager.freeze(cost, taskKey, providerId, billingLabel)
    if (!freezeSuccess) {
      idempotencyManager.releaseLock(taskKey)
      setState({
        ...IDLE_STATE,
        error: `钱包可用余额不足 (需 ${cost} 灵感币)，请在顶部虚拟钱包中模拟充值。`,
      })
      return
    }

    const failAndRefund = (reason: string, errMessage: string) => {
      if (mountedRef.current) {
        setState({ ...IDLE_STATE, error: errMessage })
      }
      walletManager.refund(taskKey, cost, providerId, `${reason}: ${errMessage}`)
      circuitBreaker.recordFailure(providerId)
      idempotencyManager.releaseLock(taskKey)
    }

    setState({ running: true, progress: 10, statusText: '正在向视频生成服务提交请求...', videoUrl: null, error: null })

    const abortController = new AbortController()
    abortRef.current = abortController
    const signal = abortController.signal

    try {
      const provider = resolveVideoProvider(providerId)
      const req: VideoGenRequest = {
        clientTaskId: taskKey,
        shotId: `${intent}-${Date.now()}`,
        prompt,
        negative,
        imageBase64: imageBase64 || undefined,
        referenceVideoUrl: referenceVideoUrl || undefined,
        motionPrompt: motionPrompt || undefined,
        durationSec,
        ratio: '9:16',
        title,
      }

      setState((prev) => ({ ...prev, progress: 25 }))

      // 3. 提交至 provider
      const { taskId } = await provider.submit(req)

      // 4. 轮询窗口内轮询至终态（超时一律退款，绝不 settle）
      const pollingWindow = getPollingWindow()
      for (let attempt = 1; attempt <= pollingWindow.maxAttempts; attempt++) {
        if (signal.aborted || !mountedRef.current) {
          // 用户离开页面：释放幂等锁，资金留在冻结账本等待孤儿回收
          idempotencyManager.releaseLock(taskKey)
          return
        }

        // 统一轮询睡眠：切后台回来立即刷新一次状态（pollSleep 统一实现）
        await pollSleep(pollingWindow.intervalMs, signal)

        if (signal.aborted || !mountedRef.current) {
          idempotencyManager.releaseLock(taskKey)
          return
        }

        try {
          const pollRes = await provider.poll(taskId)
          const elapsedSec = Math.round(attempt * (pollingWindow.intervalMs / 1000))
          setState((prev) => ({
            ...prev,
            progress: Math.min(95, prev.progress + 3),
            statusText: `模型神经渲染中... (${elapsedSec}s)`,
          }))

          if (pollRes.status === 'succeeded') {
            const asset = await provider.getAsset(taskId)
            // 资金两阶段事务：阶段 2A (成功核销结算)
            walletManager.settle(taskKey, cost, providerId, `${billingLabel}成功核销`)
            circuitBreaker.recordSuccess(providerId)
            idempotencyManager.releaseLock(taskKey)
            setState({ running: false, progress: 100, statusText: '视频生成完成！', videoUrl: asset.url, error: null })
            return
          }

          if (pollRes.status === 'failed') {
            // 资金两阶段事务：阶段 2B (失败全额退款)
            failAndRefund(`${billingLabel}生成异常退还`, pollRes.error || '远端生成异常')
            return
          }
        } catch (err) {
          failAndRefund(
            `${billingLabel}状态查询异常退款`,
            err instanceof Error ? err.message : '查询任务状态出错'
          )
          return
        }
      }

      // 5. 轮询窗口耗尽：绝不 settle，全额退款
      failAndRefund(billingLabel, '生成超时，请检查网络或 API 余额。已自动全额退款。')
    } catch (err) {
      failAndRefund(
        `${billingLabel}提交异常退款`,
        err instanceof Error ? err.message : '提交生片请求失败'
      )
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null
      }
    }
  }, [])

  return { state, run, cancel, reset }
}
