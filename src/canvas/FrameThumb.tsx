import { useEffect, useState } from 'react'
import { getAssetObjectUrl, idbRefToId, isIdbRef } from '../persist/assetStore.ts'

/**
 * D3：机位渲染帧缩略图（generate 参考底图 / storyboard 分镜帧共用）。
 *
 * - 大资产只存 idbref://（IndexedDB）或 http(s)；本组件按需 hydrate 为 blob objectURL 并 revoke；
 * - 无引用 / hydrate 失败如实显示占位（不白屏、不伪造）。
 */
export function FrameThumb({
  frameRef,
  alt,
  className,
}: {
  frameRef: string
  alt: string
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!isIdbRef(frameRef)) {
      // oxlint-disable-next-line set-state-in-effect -- http(s) 直链无异步水合，同步赋值即终值
      setSrc(frameRef)
      return
    }
    let revoked: string | null = null
    let cancelled = false
    void (async () => {
      const u = await getAssetObjectUrl(idbRefToId(frameRef))
      if (cancelled) return
      if (u) {
        revoked = u
        setSrc(u)
      } else {
        setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [frameRef])

  if (failed) {
    return (
      <span className={`wls-frame-thumb wls-frame-thumb-missing${className ? ` ${className}` : ''}`} role="img" aria-label={`${alt}（帧图读取失败）`}>
        🚫
      </span>
    )
  }
  if (!src) {
    return (
      <span className={`wls-frame-thumb wls-frame-thumb-loading${className ? ` ${className}` : ''}`} aria-label={`${alt}（加载中）`}>
        …
      </span>
    )
  }
  return (
    // oxlint-disable-next-line jsx-a11y/img-redundant-alt -- alt 为机位名，非冗余
    <img className={`wls-frame-thumb${className ? ` ${className}` : ''}`} src={src} alt={alt} draggable={false} />
  )
}
