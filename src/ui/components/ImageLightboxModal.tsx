import React, { useEffect } from 'react'

type Props = {
  isOpen: boolean
  imageUrl: string | null
  title?: string
  onClose: () => void
}

export const ImageLightboxModal: React.FC<Props> = ({
  isOpen,
  imageUrl,
  title = '首帧参考图高清预览',
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !imageUrl) return null

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content-card" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-header">
          <div className="lightbox-title-box">
            <span className="lightbox-badge">🔍 高清首帧</span>
            <h4>{title}</h4>
          </div>
          <button
            type="button"
            className="btn-lightbox-close"
            onClick={onClose}
            title="按 ESC 或点击关闭"
          >
            ✕
          </button>
        </div>

        <div className="lightbox-image-container">
          <img src={imageUrl} alt={title} className="lightbox-img" />
        </div>

        <div className="lightbox-footer">
          <span className="lightbox-spec-hint">9:16 商业画幅 · 用于垫图控制与产品结构锁定</span>
          <div className="lightbox-footer-actions">
            <a
              href={imageUrl}
              download="weblockshot-reference-image"
              className="btn-lightbox-download"
            >
              ⬇️ 下载原图
            </a>
            <button type="button" className="btn-lightbox-confirm" onClick={onClose}>
              完成查看
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
