import { useState } from 'react'
import { View, Text, Input, Textarea, Image, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { submitVideoTask } from '../../api/client'
import { setCurrentTask } from '../../store/taskStore'
import './index.scss'

/**
 * 页面 1：商品录入（表单 + 图片 chooseMedia）。
 * 提交经后端 /api 反代；密钥由服务端 WLS_KEYS 注入，本端不持有密钥。
 */
export default function Index() {
  const [title, setTitle] = useState('')
  const [sellingPoint, setSellingPoint] = useState('')
  const [imagePath, setImagePath] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chooseImage = () => {
    Taro.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = res.tempFiles?.[0]
        if (file) setImagePath(file.tempFilePath)
      },
    })
  }

  /** 本地图片转 dataURL（i2v 首帧）；失败不阻塞，可回退文生视频 */
  const readImageBase64 = (filePath: string): Promise<string | undefined> =>
    new Promise((resolve) => {
      try {
        Taro.getFileSystemManager().readFile({
          filePath,
          encoding: 'base64',
          success: (res) => resolve(`data:image/jpeg;base64,${res.data}`),
          fail: () => resolve(undefined),
        })
      } catch {
        resolve(undefined)
      }
    })

  const handleSubmit = async () => {
    // O9 修复：提交进行中直接拦截，防止双击创建双任务
    if (submitting) return
    const prompt = [title.trim(), sellingPoint.trim()].filter(Boolean).join('，')
    if (!prompt) {
      setError('请至少填写商品名称或核心卖点')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const imageBase64 = imagePath ? await readImageBase64(imagePath) : undefined
      const task = await submitVideoTask({ prompt, imageBase64, durationSec: 5 })
      setCurrentTask({ ...task, prompt, createdAt: Date.now() })
      Taro.navigateTo({ url: '/pages/progress/progress' })
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View className="page-index">
      <View className="panel">
        <Text className="field-label">商品名称</Text>
        <Input
          className="field-input"
          placeholder="例如：高速负离子静音电吹风"
          value={title}
          onInput={(e) => setTitle(e.detail.value)}
        />
        <Text className="field-label">核心卖点（一段话即可）</Text>
        <Textarea
          className="field-textarea"
          placeholder="例如：11万转高速马达，3分钟速干，2亿级负离子抚平毛躁"
          value={sellingPoint}
          maxlength={200}
          onInput={(e) => setSellingPoint(e.detail.value)}
        />
      </View>

      <View className="panel">
        <Text className="field-label">商品首帧图（可选，图生视频更稳）</Text>
        <View className="upload-box" onClick={chooseImage}>
          {imagePath ? (
            <Image className="upload-preview" src={imagePath} mode="aspectFill" />
          ) : (
            <Text className="hint">点击拍摄或从相册选择商品图</Text>
          )}
        </View>
      </View>

      {error && (
        <View className="error-banner">
          <Text>⚠️ {error}</Text>
        </View>
      )}

      <Button
        className="btn-primary submit-btn"
        loading={submitting}
        disabled={submitting}
        onClick={handleSubmit}
      >
        {submitting ? '正在提交任务…' : '🎬 提交生成任务'}
      </Button>

      <View className="panel">
        <Text className="hint">
          说明：任务经后端 /api 反代提交（密钥由服务端注入，本端不持有密钥）；生成通常需要 1~5 分钟。
        </Text>
      </View>
    </View>
  )
}
