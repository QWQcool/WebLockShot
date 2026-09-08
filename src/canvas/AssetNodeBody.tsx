import { useEffect, useRef, useState } from 'react'
import {
  getAssetObjectUrl,
  idbRefToId,
  isIdbRef,
} from '../persist/assetStore.ts'
import { readAssetMetaPayload } from './contract.ts'
import type { WlsNodeShape } from './WlsNodeUtil.tsx'

/**
 * B4 产物卡（kind='asset'）：单镜出片视频卡。
 *
 * - 大资产只存引用（meta.url = idbref:// 或 http 直链），本组件按需 hydrate 为
 *   blob objectURL 播放（卸载时回收）；
 * - blob: URL 不持久化（跨刷新失效），契约层已拒写；
 * - 控件级 stopPropagation（B2 标准）：video 播放控件阻断，卡片其余区域放行拖拽/画线；
 * - 双击全屏播放留 B5。
 */
export function AssetNodeBody({ shape }: { shape: WlsNodeShape }) {
  // hooks 必须在所有 early return 之前（P1：条件调用会触发 rules-of-hooks 白屏崩溃）
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)

  const payload = readAssetMetaPayload(shape.props.meta)
  const missingUrl = !payload?.url

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
    return <div className="wls-asset-empty">产物数据不合法（契约校验未通过）</div>
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
      <div className="wls-asset-meta">
        <span className="wls-asset-shot">{payload.shotId.split('-s').pop()?.toUpperCase() ?? 'S'} 镜</span>
        {payload.title && <span className="wls-asset-title">{payload.title}</span>}
      </div>
    </div>
  )
}
