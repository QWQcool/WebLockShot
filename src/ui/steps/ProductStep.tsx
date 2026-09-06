import React, { useState, useRef } from 'react'
import type { ProductInput } from '../../domain/product.ts'
import { understandProductImage } from '../../director/nodes/productNode.ts'
import { TOKEN_STORAGE_KEY } from '../../types.ts'

type Props = {
  productInput: ProductInput
  onChange: (input: ProductInput) => void
  onNext: () => void
}

const PRESET_PRODUCTS: {
  title: string
  points: string[]
  link: string
  desc: string
}[] = [
  {
    title: '高速负离子静音电吹风',
    points: ['11万转高速马达，3分钟速干', '2亿级高浓度负离子抚平毛躁', '智能恒温算法，绝不伤发'],
    link: 'https://item.taobao.com/item.htm?id=sample_hair_dryer',
    desc: '反常识与前后对比型爆款品类',
  },
  {
    title: '毛孔级火山泥吸附面膜',
    points: ['亚马逊白泥+深层高岭土', '深层带走黑头白头，不撑大毛孔', '温和不紧绷，敏感肌可用'],
    link: 'https://detail.tmall.com/item.htm?id=sample_clay_mask',
    desc: '痛点放大与视觉冲击极强',
  },
  {
    title: '机能防泼水数码收纳包',
    points: ['高密度军规防泼水面料', '内衬精密风琴分区，一目了然', '抗震抗摔，差旅通勤一包搞定'],
    link: 'https://haohuo.jinritemai.com/views/product/sample_bag',
    desc: '开箱测评与品质演示首选',
  },
]

export const ProductStep: React.FC<Props> = ({
  productInput,
  onChange,
  onNext,
}) => {
  const [activeTab, setActiveTab] = useState<'link' | 'image' | 'video'>(
    productInput.source === 'image'
      ? 'image'
      : productInput.videoPreview
      ? 'video'
      : 'link'
  )
  const [newPoint, setNewPoint] = useState('')
  const [extractedFrames, setExtractedFrames] = useState<string[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const handleApplyPreset = (p: (typeof PRESET_PRODUCTS)[0]) => {
    onChange({
      ...productInput,
      title: p.title,
      link: p.link,
      sellingPointsManual: [...p.points],
    })
  }

  const handleAddPoint = () => {
    if (!newPoint.trim()) return
    onChange({
      ...productInput,
      sellingPointsManual: [...productInput.sellingPointsManual, newPoint.trim()],
    })
    setNewPoint('')
  }

  const handleRemovePoint = (index: number) => {
    onChange({
      ...productInput,
      sellingPointsManual: productInput.sellingPointsManual.filter((_, i) => i !== index),
    })
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      onChange({
        ...productInput,
        source: 'image',
        imagePreview: reader.result as string,
        title: productInput.title || file.name.replace(/\.[^/.]+$/, ''),
      })
    }
    reader.readAsDataURL(file)
  }

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const videoUrl = URL.createObjectURL(file)
    onChange({
      ...productInput,
      source: 'manual',
      videoPreview: videoUrl,
      title: productInput.title || file.name.replace(/\.[^/.]+$/, ''),
    })

    // 本地 Canvas 快速抽帧预览
    const tempVideo = document.createElement('video')
    tempVideo.src = videoUrl
    tempVideo.muted = true
    tempVideo.crossOrigin = 'anonymous'
    tempVideo.onloadeddata = () => {
      tempVideo.currentTime = 1
    }
    tempVideo.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 280
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(tempVideo, 0, 0, 160, 280)
        setExtractedFrames([canvas.toDataURL('image/jpeg', 0.8)])
      }
    }
  }

  return (
    <div className="product-step-container">
      <div className="step-header-intro">
        <h2>① 商品导入与卖点定义</h2>
        <p>
          导入要推广的商品素材。AI 将结合卖点与爆款套路，自动构思钩子与高转化分镜。
        </p>
      </div>

      {/* 预设样例卡 */}
      <div className="preset-shortcuts">
        <span className="preset-label">⚡ 快速载入预设样品：</span>
        {PRESET_PRODUCTS.map((p) => (
          <button
            key={p.title}
            type="button"
            className="preset-chip"
            onClick={() => handleApplyPreset(p)}
          >
            {p.title}
          </button>
        ))}
      </div>

      {/* 三大导入入口切换 */}
      <div className="import-card">
        <div className="import-tabs">
          <button
            type="button"
            className={`import-tab-btn ${activeTab === 'link' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('link')
              onChange({ ...productInput, source: 'link' })
            }}
          >
            🔗 平台商品链接
          </button>
          <button
            type="button"
            className={`import-tab-btn ${activeTab === 'image' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('image')
              onChange({ ...productInput, source: 'image' })
            }}
          >
            🖼️ 商品主图 / 实拍图
          </button>
          <button
            type="button"
            className={`import-tab-btn ${activeTab === 'video' ? 'active' : ''}`}
            onClick={() => setActiveTab('video')}
          >
            🎥 本地参考爆款视频（抽帧）
          </button>
        </div>

        <div className="tab-content-panel">
          {activeTab === 'link' && (
            <div className="tab-panel-inner">
              <label className="field-label">电商平台链接（淘宝 / 京东 / 抖音小店 / 拼多多）：</label>
              <input
                type="url"
                className="text-input"
                placeholder="https://item.taobao.com/item.htm?id=..."
                value={productInput.link || ''}
                onChange={(e) => onChange({ ...productInput, link: e.target.value })}
              />
              <div className="notice-box">
                <span className="notice-icon">🛡️</span>
                <div className="notice-text">
                  <strong>诚实边界说明：</strong>
                  受电商平台反爬机制与浏览器同源策略限制，纯前端模式无法静默抓取外部登录页数据。系统已将该 URL 作为档案留存，请在下方直接补充商品名称与核心卖点。
                </div>
              </div>
            </div>
          )}

          {activeTab === 'image' && (
            <div className="tab-panel-inner">
              <label className="field-label">上传商品外观图（支持 JPG/PNG/WEBP）：</label>
              <div className="upload-dropzone">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="file-input-hidden"
                  id="img-upload-input"
                />
                <label htmlFor="img-upload-input" className="dropzone-label">
                  {productInput.imagePreview ? (
                    <div className="preview-wrap">
                      <img src={productInput.imagePreview} alt="商品图预览" className="img-preview" />
                      <span className="change-hint">点击更换图片</span>
                    </div>
                  ) : (
                    <div className="placeholder-box">
                      <span className="icon-cloud">📁</span>
                      <span>点击选择商品实拍图或主图</span>
                      <small>图片将用于本地参考与视觉提示词增强</small>
                    </div>
                  )}
                </label>
              </div>

              {productInput.imagePreview && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isAnalyzing}
                    onClick={async () => {
                      setIsAnalyzing(true)
                      try {
                        let token = null
                        try {
                          const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
                          if (raw) token = JSON.parse(raw)
                        } catch {}
                        const insight = await understandProductImage(productInput.imagePreview!, token)
                        onChange({
                          ...productInput,
                          title: insight.category || productInput.title,
                          sellingPointsManual: insight.sellingPoints,
                        })
                      } finally {
                        setIsAnalyzing(false)
                      }
                    }}
                  >
                    {isAnalyzing ? '⚡ 视觉模型正在深度理解中...' : '🤖 AI 智能解析商品图（自动提炼卖点）'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'video' && (
            <div className="tab-panel-inner">
              <label className="field-label">选择本地参考爆款视频（仅浏览器本地抽帧分析，不上传远端）：</label>
              <input
                type="file"
                accept="video/*"
                onChange={handleVideoUpload}
                className="file-input"
              />
              {productInput.videoPreview && (
                <div className="video-extract-preview">
                  <div className="video-player-wrap">
                    <video
                      ref={videoRef}
                      src={productInput.videoPreview}
                      controls
                      className="preview-video"
                    />
                  </div>
                  {extractedFrames.length > 0 && (
                    <div className="frames-box">
                      <span className="frames-title">本地提取的关键视觉参考帧：</span>
                      <div className="frames-list">
                        {extractedFrames.map((f, i) => (
                          <img key={i} src={f} alt="帧抽样" className="frame-thumb" />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 卖点与基础信息 */}
      <div className="details-card">
        <div className="form-group">
          <label className="field-label">商品名称 / 推广主题：</label>
          <input
            type="text"
            className="text-input font-medium"
            placeholder="例如：高速负离子静音电吹风"
            value={productInput.title || ''}
            onChange={(e) => onChange({ ...productInput, title: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label className="field-label">核心卖点（2 ~ 4 条，越具体带货转化越高）：</label>
          <div className="points-tag-list">
            {productInput.sellingPointsManual.map((point, index) => (
              <div key={index} className="point-tag">
                <span className="tag-order">#{index + 1}</span>
                <span className="tag-text">{point}</span>
                <button
                  type="button"
                  className="tag-remove"
                  onClick={() => handleRemovePoint(index)}
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="add-point-bar">
            <input
              type="text"
              className="text-input add-input"
              placeholder="添加一条核心卖点（按回车或点添加）"
              value={newPoint}
              onChange={(e) => setNewPoint(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddPoint()
                }
              }}
            />
            <button type="button" className="btn-secondary" onClick={handleAddPoint}>
              + 添加卖点
            </button>
          </div>
        </div>
      </div>

      {/* 底部行动栏 */}
      <div className="step-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={!productInput.title?.trim() || productInput.sellingPointsManual.length === 0}
          onClick={onNext}
        >
          下一步：选择爆款套路模板 →
        </button>
      </div>
    </div>
  )
}
