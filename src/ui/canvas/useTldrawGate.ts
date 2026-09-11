import { useEffect, useState } from 'react'
import {
  TLDRAW_LICENSE_MARKER_TESTID,
  currentTldrawLicenseMode,
  type TldrawLicenseMode,
} from '../../canvas/tldrawLicense.ts'

export type TldrawGateState = {
  /** 事前判定：dev-exempt / unlicensed-production / licensed */
  mode: TldrawLicenseMode
  /** 事后兜底：tldraw 自己渲染的闸门标记是否真的出现 */
  gateFired: boolean
  /** 综合结论：当前画布是否处于「被许可限制」状态 */
  gated: boolean
}

/**
 * tldraw 许可闸门状态（**单一来源**）。
 *
 * 为什么要抽成 hook：此前有两处各自判断，口径必然漂移——
 *   · `TldrawLicenseNotice`（弹窗提示）读 mode + 观察标记；
 *   · `CanvasEmptyHint`（顶部说明条）却把「5 秒停渲染」写死在静态文案里，
 *     于是 2026-09-11 配置 license key 后仍固定展示，成为「过期文案」。
 *
 * 事后兜底用 tldraw 自己渲染的 `[data-testid=tl-license-expired]` 判定——
 * 内部许可状态不可读，且**已配置但过期/域名不匹配**的 key 也会命中闸门，
 * 只靠「有没有配 key」判断会漏报。
 */
export function useTldrawGate(): TldrawGateState {
  const [mode] = useState<TldrawLicenseMode>(() => currentTldrawLicenseMode())
  const [gateFired, setGateFired] = useState(false)

  useEffect(() => {
    const check = (): void => {
      setGateFired(Boolean(document.querySelector(`[data-testid="${TLDRAW_LICENSE_MARKER_TESTID}"]`)))
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return { mode, gateFired, gated: mode === 'unlicensed-production' || gateFired }
}
