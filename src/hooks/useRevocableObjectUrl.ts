import { useCallback, useEffect, useRef } from 'react'

/**
 * 受管 objectURL Hook (Revocable Object URL)
 *
 * URL.createObjectURL 的统一管理入口：创建即登记，
 * 替换/清除时立即 revoke，组件卸载时兜底全量回收，杜绝内存泄漏。
 */
export function useRevocableObjectUrl() {
  const urlsRef = useRef<Set<string>>(new Set())

  /** 登记并返回该 URL（调用方拿到的 URL 在卸载时会被自动回收） */
  const track = useCallback((url: string): string => {
    urlsRef.current.add(url)
    return url
  }, [])

  /** 立即回收单个 URL（仅回收本 hook 登记过的） */
  const revoke = useCallback((url: string | null | undefined): void => {
    if (!url) return
    if (urlsRef.current.has(url)) {
      URL.revokeObjectURL(url)
      urlsRef.current.delete(url)
    }
  }, [])

  /** 用新 URL 替换旧 URL：旧 URL 立即回收，新 URL 登记 */
  const replace = useCallback(
    (oldUrl: string | null | undefined, create: () => string): string => {
      revoke(oldUrl)
      return track(create())
    },
    [revoke, track]
  )

  // 组件卸载：兜底回收所有登记的 objectURL
  useEffect(() => {
    const urls = urlsRef.current
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u))
      urls.clear()
    }
  }, [])

  return { track, revoke, replace }
}
