import { useEffect, useRef, useState } from 'react'
import { View, Text, Progress, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
// 复用主仓 domain 轮询配置（@domain 别名 → ../src/domain，src 层面零改动）
import { getPollingWindow, pollSleep } from '@domain/pollingConfig.ts'
import { pollVideoTask } from '../../api/client'
import { getCurrentTask, markTaskSucceeded } from '../../store/taskStore'
import './progress.scss'

/**
 * 页面 2：任务进度（复用 domain/pollingConfig 轮询窗口与 pollSleep）。
 *
 * pollSleep 的「切后台回前台立即唤醒」依赖 document/visibilitychange，
 * 小程序运行时无 document → 自动退化为普通 setTimeout，行为安全。
 */
export default function ProgressPage() {
  const [progress, setProgress] = useState(10)
  const [statusText, setStatusText] = useState('正在排队…')
  const [error, setError] = useState<string | null>(null)
  const pollingRef = useRef(true)

  useEffect(() => {
    const task = getCurrentTask()
    if (!task) {
      Taro.reLaunch({ url: '/pages/index/index' })
      return
    }

    const pollingWindow = getPollingWindow()
    let attempt = 0

    const loop = async () => {
      while (pollingRef.current && attempt < pollingWindow.maxAttempts) {
        await pollSleep(pollingWindow.intervalMs)
        if (!pollingRef.current) return
        attempt += 1

        try {
          const result = await pollVideoTask(task)
          if (!pollingRef.current) return
          setProgress(Math.max(progress, result.progress))
          setStatusText(`模型渲染中…（已等待 ${Math.round((attempt * pollingWindow.intervalMs) / 1000)}s）`)

          if (result.status === 'succeeded' && result.videoUrl) {
            pollingRef.current = false
            markTaskSucceeded(result.videoUrl)
            Taro.redirectTo({ url: '/pages/result/result' })
            return
          }
          if (result.status === 'failed') {
            pollingRef.current = false
            setError(result.error || '生成失败')
            return
          }
        } catch (err) {
          pollingRef.current = false
          setError(err instanceof Error ? err.message : '查询任务状态失败')
          return
        }
      }

      if (pollingRef.current) {
        pollingRef.current = false
        setError('生成超时：已超出轮询窗口（复用主仓 pollingConfig 默认 10 分钟），请回首页重试或联系管理员。')
      }
    }

    void loop()
    return () => {
      pollingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View className="page-progress">
      <View className="panel">
        <Text className="progress-title">{error ? '❌ 任务异常' : '🎬 正在生成带货视频'}</Text>
        <Progress percent={error ? 0 : progress} strokeWidth={8} activeColor="#22d3ee" />
        <Text className="hint">{error || statusText}</Text>
      </View>

      {error && (
        <Button className="btn-primary" onClick={() => Taro.reLaunch({ url: '/pages/index/index' })}>
          返回首页
        </Button>
      )}

      <View className="panel">
        <Text className="hint">
          进度百分比来自轮询响应映射（契约见主仓 test/fixtures/kling/poll-*.json）；超时窗口复用主仓 domain/pollingConfig。
        </Text>
      </View>
    </View>
  )
}
