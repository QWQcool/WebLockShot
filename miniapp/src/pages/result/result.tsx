import { useState } from 'react'
import { View, Text, Video, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getCurrentTask } from '../../store/taskStore'
import './result.scss'

/**
 * 页面 3：看片交付（Taro Video 播放）。
 * 能力边界：小程序端只做播放与重新发起，不做剪映导出/下载工程包。
 */
export default function Result() {
  const task = getCurrentTask()
  const [savedTip, setSavedTip] = useState(false)

  if (!task?.videoUrl) {
    return (
      <View className="page-result">
        <View className="panel">
          <Text className="hint">暂无已完成的视频任务，请先在首页提交生成任务。</Text>
        </View>
        <Button className="btn-primary" onClick={() => Taro.reLaunch({ url: '/pages/index/index' })}>
          去录入商品
        </Button>
      </View>
    )
  }

  const copyLink = () => {
    Taro.setClipboardData({
      data: task.videoUrl!,
      success: () => setSavedTip(true),
    })
  }

  return (
    <View className="page-result">
      <View className="panel">
        <Video
          className="result-video"
          src={task.videoUrl}
          controls
          loop
          objectFit="contain"
        />
        <Text className="hint">提示词：{task.prompt}</Text>
      </View>

      <Button className="btn-primary" onClick={copyLink}>
        {savedTip ? '✓ 链接已复制' : '🔗 复制视频链接（供桌面端进入剪映交付）'}
      </Button>
      <Button className="btn-secondary" onClick={() => Taro.reLaunch({ url: '/pages/index/index' })}>
        🔄 再生成一条
      </Button>

      <View className="panel">
        <Text className="hint">
          能力边界：小程序端不做剪映草稿导出（需桌面端文件系统能力），复制链接后请到桌面工作台的「审片交付」步骤继续。
        </Text>
      </View>
    </View>
  )
}
