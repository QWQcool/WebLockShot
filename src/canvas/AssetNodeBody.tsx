import { useEffect, useRef, useState } from 'react'
import { useEditor, type JsonObject } from 'tldraw'
import {
  getAssetObjectUrl,
  idbRefToId,
  isIdbRef,
} from '../persist/assetStore.ts'
import {
  assetCurrentSlotIndex,
  assetVersionSlots,
  readAssetMetaPayload,
  switchAssetVersion,
} from './contract.ts'
import { useT } from '../i18n/useLanguage.ts'
import type { WlsNodeShape } from './WlsNodeUtil.tsx'

/**
 * B4 产物卡（kind='asset'）：单镜出片视频卡。
 *
 * - 大资产只存引用（meta.url = idbref:// 或 http 直链），本组件按需 hydrate 为
 *   blob objectURL 播放（卸载时回收）；
 * - blob: URL 不持久化（跨刷新失效），契约层已拒写；
 * - 控件级 stopPropagation（B2 标准）：video 播放控件阻断，卡片其余区域放行拖拽/画线；
 * - A2 版本堆叠卡：meta.versions（最新在前）+ meta.baseUrl（原始素材），
 *   ‹ k/N › 切换/回退，当前版本高亮；回退只改 meta.url（versions 只增不乱），
 *   回退后再重绘基于当前显示版本叠加（版本链如实记录）。
 */
export function AssetNodeBody({ shape }: { shape: WlsNodeShape }) {
  const editor = useEditor()
  const t = useT()
  // hooks 必须在所有 early return 之前（P1：条件调用会触发 rules-of-hooks 白屏崩溃）
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)

  const payload = readAssetMetaPayload(shape.props.meta)
  const missingUrl = !payload?.url

  // A2：版本槽位（0 = 原始素材，1..N = 重绘版本最新在前）与当前显示下标
  const slots = payload ? assetVersionSlots(payload) : []
  const slotIndex = payload ? assetCurrentSlotIndex(payload) : 0
  const currentSlot = slots[slotIndex] ?? null
  const canPrev = payload !== null && slotIndex > 0
  const canNext = payload !== null && slotIndex < slots.length - 1

  /** 版本切换/回退：纯函数算出目标 url，直接改 meta.url（versions 数组不动） */
  const switchVersion = (dir: -1 | 1) => {
    if (!payload) return
    const nextUrl = switchAssetVersion(payload, dir)
    if (!nextUrl) return
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      props: { meta: { ...shape.props.meta, url: nextUrl } as JsonObject },
    })
  }

  useEffect(() => {
    if (missingUrl || !payload?.url) return
    let cancelled = false
    let revoked: string | null = null
    // IndexedDB 异步 hydrate：所有 setState 均在 await 之后，不同步触发重渲染
    void (async () => {
      if (isIdbRef(payload.url)) {
        const u = await getAssetObjectUrl(idbRefToId(payload.url))
        if (cancelled) return
        if (u) {
          revoked = u
          setSrc(u)
        } else {
          setErr('IndexedDB 资产读取失败，请重新生成该镜')
        }
      } else {
        setSrc(payload.url)
      }
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [missingUrl, payload?.url])

  if (!payload) {
    // 空态（2026-09-11 校正）：编排/手动摆放的产物卡在出片前 meta 为空，
    // 此前直接显示「产物数据不合法（契约校验未通过）」——把正常的「还没出片」
    // 说成契约错误，用户会以为画布坏了。改为如实空态（真·非法载荷仍由此提示兜底）。
    return (
      <div className="wls-asset-empty" data-testid="asset-empty">
        {t('node.asset.empty')}
      </div>
    )
  }
  if (missingUrl) {
    return <div className="wls-asset-error">⚠️ 产物引用缺失</div>
  }

  return (
    <div className="wls-asset">
      {err ? (
        <div className="wls-asset-error">⚠️ {err}</div>
      ) : src ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- 播放控制走自定义按钮（控件级阻断可测）
        <video ref={videoRef} className="wls-asset-video" src={src} playsInline loop muted />
      ) : (
        <div className="wls-asset-loading">产物加载中…</div>
      )}
      {/* 控件级 stopPropagation（B2 标准）：播放按钮阻断，视频画面区域放行 */}
      <div className="wls-asset-controls">
        <button
          type="button"
          className="wls-asset-play"
          disabled={!src}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            const v = videoRef.current
            if (!v) return
            if (v.paused) {
              void v.play()
              setPlaying(true)
            } else {
              v.pause()
              setPlaying(false)
            }
          }}
        >
          {playing ? '⏸ 暂停' : '▶️ 播放'}
        </button>
      </div>
      {/* A2：版本堆叠卡（‹ k/N ›，当前版本高亮；演示重绘版本如实标注） */}
      {slots.length > 1 && currentSlot && (
        <div className="wls-asset-versions" data-testid="wls-asset-versions">
          <button
            type="button"
            className="wls-asset-ver-btn"
            disabled={!canPrev}
            aria-label="上一版本"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => switchVersion(-1)}
          >
            ‹
          </button>
          <span
            className={`wls-asset-ver-pos${currentSlot.demo ? ' wls-asset-ver-demo' : ''}`}
            title={currentSlot.instruction ?? '原始素材'}
          >
            v{slotIndex + 1}/{slots.length}
            {currentSlot.demo && ' 🧪'}
          </span>
          <button
            type="button"
            className="wls-asset-ver-btn"
            disabled={!canNext}
            aria-label="下一版本"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => switchVersion(1)}
          >
            ›
          </button>
        </div>
      )}
      <div className="wls-asset-meta">
        <span className="wls-asset-shot">{payload.shotId.split('-s').pop()?.toUpperCase() ?? 'S'} 镜</span>
        {payload.title && <span className="wls-asset-title">{payload.title}</span>}
      </div>
    </div>
  )
}
