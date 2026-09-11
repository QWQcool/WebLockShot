import React, { useEffect } from 'react'
import { SCENE_GALLERY_CARDS, SCENE_GALLERY_TOPOLOGY } from '../../canvas/sceneGallery.ts'
import { publicUrl } from '../../assets/publicUrl.ts'
import './sceneGallery.css'

/**
 * D6 创作场景画廊（CANVAS_PLAN.md §9 D6，Miora 图8 1:1）。
 *
 * 六类创作场景卡片（品牌设计/电商物料/影视文娱/游戏内容/产品 UI/UX/宣传物料）：
 * - 点击卡片 → 预填对话栏（用户可改后再发送）；
 * - 「⚡ 一键编排」→ 直接跑 B6 既有编排链路（LLM / 演示两态，画布内如实标注）；
 * - 建议拓扑 chips 如实展示（所有场景同链，差异在脚本契约场景）。
 *
 * 诚实：配图为 CSS 风格化艺术面板（渐变 + 图标），不是参考稿实拍图（素材版权不随仓库分发）。
 */

/** 配图地址：BASE_URL 感知（GitHub Pages 子路径 /WebLockShot/ 下同样正确） */
function sceneImageUrl(filename: string): string {
  return publicUrl(`scenes/${filename}`)
}

type Props = {
  onClose: () => void
  /** 预填对话栏并关闭画廊 */
  onPrefill: (text: string) => void
  /** 一键编排（复用 B6 链路）并关闭画廊 */
  onOrchestrate: (text: string) => void
}

export const SceneGalleryView: React.FC<Props> = ({ onClose, onPrefill, onOrchestrate }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sg-root" data-testid="scene-gallery">
      <header className="sg-header">
        <div className="sg-header-left">
          <h2>🎬 创作场景</h2>
          <span className="sg-header-sub">选一个场景，Agent 帮你把创作流程摆上画布</span>
        </div>
        <button type="button" className="sg-close" data-testid="sg-close" aria-label="关闭创作场景" onClick={onClose}>
          ✕ 关闭
        </button>
      </header>

      <p className="sg-honest" role="note">
        六类场景共用同一条编排链路（需求 Brief → 脚本创编 → 分镜预演 → 逐镜出片 → 成片交付），
        差异在脚本契约场景（带货 / 品牌 / 短剧）；演示编排会如实标注「非真实 LLM」。
      </p>

      <div className="sg-grid" data-testid="sg-grid">
        {SCENE_GALLERY_CARDS.map((card) => (
          <article className="sg-card" key={card.number} data-testid={`sg-card-${card.number}`}>
            <button
              type="button"
              className="sg-card-art"
              style={{
                background: `linear-gradient(160deg, ${card.gradient[0]} 0%, ${card.gradient[1]} 100%)`,
              }}
              title={`预填到对话栏：${card.title}`}
              onClick={() => onPrefill(card.prompt)}
            >
              {/* 配图（懒加载）；未就绪时下方渐变 + 图标占位，不闪白块 */}
              <img
                className="sg-card-img"
                src={sceneImageUrl(card.image)}
                alt={`${card.title}场景配图`}
                loading="lazy"
                draggable={false}
              />
              <span className="sg-card-glyph" aria-hidden>
                {card.glyph}
              </span>
              <span className="sg-card-num-badge" aria-hidden>
                {card.number}
              </span>
            </button>
            <div className="sg-card-body">
              <h3 className="sg-card-title">
                <span className="sg-card-num">{card.number}</span>
                {card.title}
              </h3>
              <p className="sg-card-sub">{card.subtitle}</p>
              <p className="sg-card-tagline">{card.tagline}</p>

              <div className="sg-topology" aria-label="建议编排拓扑">
                {SCENE_GALLERY_TOPOLOGY.map((n, i) => (
                  <React.Fragment key={n.kind}>
                    {i > 0 && <span className="sg-topo-arrow" aria-hidden>→</span>}
                    <span className="sg-topo-chip" title={n.label}>
                      <span aria-hidden>{n.icon}</span> {n.label}
                    </span>
                  </React.Fragment>
                ))}
              </div>

              <div className="sg-card-actions">
                <button
                  type="button"
                  className="sg-btn sg-btn--ghost"
                  data-testid={`sg-prefill-${card.number}`}
                  onClick={() => onPrefill(card.prompt)}
                >
                  📝 预填到对话栏
                </button>
                <button
                  type="button"
                  className="sg-btn sg-btn--primary"
                  data-testid={`sg-run-${card.number}`}
                  onClick={() => onOrchestrate(card.prompt)}
                >
                  ⚡ 一键编排
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
