import React, { useEffect, useMemo, useRef, useState } from 'react'
import { resolveMemorySource, type MemorySource } from '../../canvas/memorySource.ts'
import { buildMemoryGraph, type MemoryGraphNode } from '../../canvas/memoryGraph.ts'
import { readMemoryEnabled, writeMemoryEnabled } from '../../domain/memoryPrefs.ts'
import { getAssetObjectUrl, idbRefToId, isIdbRef } from '../../persist/assetStore.ts'
import './memoryGraph.css'

/**
 * E1 记忆图谱（CANVAS_PLAN.md §9 E1，Miora 图4 1:1 回炉）
 *
 * - 全屏覆盖层，视图内部暗色主题（点阵底 + 发光主节点）；退出后对画布/工作台零污染；
 * - 数据全部来自 resolveMemorySource 双模真实数据，空记录 = 诚实空态，绝不摆样例；
 * - 「记忆已开启」开关：关闭后新回流不再写入（写侧门控见 FeedbackDashboard），
 *   已有记录不静默删除，状态经 memoryPrefs 持久化（刷新保持）；
 * - 素材缩略叶仅来自真实画布图片产物引用（无图源时素材节点如实缺省）。
 */

type Props = {
  onClose: () => void
  /** 真实素材产物引用（画布 asset 卡图片）；缺省/空 = 无素材叶 */
  thumbs?: { ref: string; label: string }[]
}

const SVG_W = 2400
const SVG_H = 1600
const ZOOM_MIN = 0.5
const ZOOM_MAX = 1.6
const ZOOM_STEP = 0.15

export const MemoryGraphView: React.FC<Props> = ({ onClose, thumbs }) => {
  const [source, setSource] = useState<MemorySource | null>(null)
  const [loading, setLoading] = useState(true)
  // 开关初始值直接从持久化读取（惰性初始化，避免 effect 内同步 setState）
  const [enabled, setEnabled] = useState(() => readMemoryEnabled())
  const [zoom, setZoom] = useState(1)
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})
  const objectUrlsRef = useRef<string[]>([])

  useEffect(() => {
    let cancelled = false
    void resolveMemorySource().then((s) => {
      if (!cancelled) {
        setSource(s)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const model = useMemo(
    () => buildMemoryGraph(source?.records ?? [], thumbs ?? []),
    [source, thumbs]
  )

  // 素材缩略叶 hydration：idbref → IndexedDB objectURL；http(s) 直链直接用
  useEffect(() => {
    let cancelled = false
    const next: Record<string, string> = {}
    const tasks: Array<Promise<void>> = []
    for (const node of model.nodes) {
      if (!node.ref) continue
      if (isIdbRef(node.ref)) {
        const ref = node.ref
        tasks.push(
          getAssetObjectUrl(idbRefToId(ref)).then((url) => {
            if (url) {
              next[ref] = url
              objectUrlsRef.current.push(url)
            }
          })
        )
      } else {
        next[node.ref] = node.ref
      }
    }
    void Promise.all(tasks).then(() => {
      if (!cancelled) setThumbUrls(next)
    })
    return () => {
      cancelled = true
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
      objectUrlsRef.current = []
    }
  }, [model])

  const handleToggle = () => {
    const next = !enabled
    setEnabled(next)
    writeMemoryEnabled(next)
  }

  const nodePos = (n: MemoryGraphNode): React.CSSProperties => ({
    left: `calc(50% + ${n.x}px)`,
    top: `calc(50% + ${n.y}px)`,
  })

  return (
    <div className="mg-root" data-testid="memory-graph-view" role="dialog" aria-label="记忆图谱">
      {/* 顶栏三件套：左返回 / 中胶囊头 / 右开关 */}
      <div className="mg-topbar">
        <button type="button" className="mg-back" data-testid="memory-graph-close" onClick={onClose}>
          ← 返回
        </button>
        <div className="mg-title-group">
          <span className="mg-title-pill">持续记忆</span>
          <span className="mg-title-sub">个人记忆</span>
          {source && (
            <span className="mg-mode-tag">
              {source.mode === 'server' ? '伴生服务 sqlite' : '纯前端模式 · 仅存本地'}
            </span>
          )}
        </div>
        <button
          type="button"
          className={`mg-toggle${enabled ? ' on' : ''}`}
          data-testid="memory-toggle"
          aria-pressed={enabled}
          onClick={handleToggle}
          title={enabled ? '点击关闭记忆采集（已有记录保留）' : '点击重新开启记忆采集'}
        >
          <span className="mg-toggle-dot" aria-hidden />
          {enabled ? '记忆已开启' : '记忆已关闭'}
        </button>
      </div>

      {loading ? (
        <div className="mg-empty" data-testid="memory-graph-loading">
          <p>正在读取记忆…</p>
        </div>
      ) : model.isEmpty ? (
        <div className="mg-empty" data-testid="memory-graph-empty">
          <span className="mg-empty-icon" aria-hidden>
            🧠
          </span>
          <p>暂无记忆记录</p>
          <small>
            图谱由真实回流记录生成（永不摆样例数据）。可在回流看板或设置面板「3. 记忆」录入；
            图片缩略叶来自画布图片素材产物。
          </small>
        </div>
      ) : (
        <>
          <div className="mg-viewport">
            <div className="mg-canvas" style={{ transform: `scale(${zoom})` }}>
              <svg
                className="mg-edges"
                width={SVG_W}
                height={SVG_H}
                viewBox={`${-SVG_W / 2} ${-SVG_H / 2} ${SVG_W} ${SVG_H}`}
                aria-hidden
              >
                {model.edges.map((e) => {
                  const a = model.nodes.find((n) => n.id === e.from)
                  const b = model.nodes.find((n) => n.id === e.to)
                  if (!a || !b) return null
                  const mx = (a.x + b.x) / 2
                  return (
                    <path
                      key={`${e.from}->${e.to}`}
                      className={`mg-edge${a.kind === 'center' ? ' mg-edge--root' : ''}`}
                      d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
                    />
                  )
                })}
              </svg>

              {model.nodes.map((n) => {
                if (n.kind === 'center') {
                  return (
                    <div key={n.id} className="mg-node mg-center" style={nodePos(n)}>
                      <span className="mg-center-core" aria-hidden />
                    </div>
                  )
                }
                if (n.kind === 'bucket') {
                  return (
                    <div key={n.id} className="mg-node mg-bucket" style={nodePos(n)} title={n.detail}>
                      <span className="mg-bucket-label">{n.label}</span>
                      <span className="mg-bucket-count">{n.detail}</span>
                    </div>
                  )
                }
                if (n.bucket === 'material' && n.ref) {
                  return (
                    <div key={n.id} className="mg-node mg-thumb" style={nodePos(n)} title={n.label}>
                      {thumbUrls[n.ref] ? (
                        <img src={thumbUrls[n.ref]} alt={n.label} draggable={false} />
                      ) : (
                        <span className="mg-thumb-loading">…</span>
                      )}
                    </div>
                  )
                }
                return (
                  <div key={n.id} className="mg-node mg-bubble" style={nodePos(n)}>
                    <span className="mg-bubble-label" title={n.label}>
                      {n.label}
                    </span>
                    {n.detail && <span className="mg-bubble-detail">{n.detail}</span>}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mg-zoom" aria-label="视图缩放">
            <button
              type="button"
              data-testid="memory-zoom-in"
              aria-label="放大"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            >
              +
            </button>
            <button
              type="button"
              data-testid="memory-zoom-out"
              aria-label="缩小"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            >
              −
            </button>
          </div>

          <div className="mg-footnote" data-testid="memory-graph-footnote">
            共 {model.recordCount} 条真实回流记录 · 图谱为纯展示层（聚合复用回流看板 Laplace 胜率）·
            关闭「记忆已开启」后新回流不再写入，已有记录保留
          </div>
        </>
      )}
    </div>
  )
}
