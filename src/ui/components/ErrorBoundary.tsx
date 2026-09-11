import React from 'react'
import { t as translate, type MessageKey } from '../../i18n/strings.ts'
import { useLanguage } from '../../i18n/useLanguage.ts'
import type { Language } from '../../i18n/strings.ts'

/**
 * 渲染异常兜底（**永不整页白屏**）。
 *
 * 背景（2026-09-11 线上实测）：GitHub Pages 子路径部署下 3D 素体模型 URL 404，
 * drei `useGLTF` 在 render 期抛错，而项目当时没有任何 ErrorBoundary，
 * React 19 直接把整棵树卸载 → **用户看到纯白页**，且无任何提示（最难排查的失败模式）。
 *
 * 设计：
 * - 缺省降级 = 整页友好面板（含「重试」与「重新加载」），文案中英双语（I1 字典）；
 * - `fallback` 可自定义降级 UI（如 3D 视口内降级为占位体，必须返回 three 元素）；
 * - `onError` 供上层如实提示（如 3D 台 notice 条），不做静默吞错；
 * - `resetKey` 变化时自动清除错误（换模型 / 换资源后允许重试）。
 */
export type ErrorBoundaryProps = {
  children: React.ReactNode
  /** 降级区域名（控制台定位 + 默认面板副标题） */
  label?: string
  /** 自定义降级 UI；缺省 = 整页友好提示面板 */
  fallback?: (error: Error, reset: () => void) => React.ReactNode
  /** 捕获回调（如实上报，不吞错） */
  onError?: (error: Error) => void
  /** 该值变化时自动清除错误状态（如资源 URL 变更后重试） */
  resetKey?: string | number | null
}

type InnerProps = ErrorBoundaryProps & { lang: Language }
type State = { error: Error | null; resetKey: ErrorBoundaryProps['resetKey'] }

class ErrorBoundaryInner extends React.Component<InnerProps, State> {
  constructor(props: InnerProps) {
    super(props)
    this.state = { error: null, resetKey: props.resetKey ?? null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  /** resetKey 变化 → 清除错误（换了资源允许重试）。用派生 state，避免 componentDidUpdate+setState 的二次渲染 */
  static getDerivedStateFromProps(props: InnerProps, state: State): Partial<State> | null {
    if (state.error && state.resetKey !== props.resetKey) return { error: null, resetKey: props.resetKey ?? null }
    return null
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 不静默：控制台留全量细节，便于线上复现定位
    console.error(`[WLS] 渲染异常（${this.props.label ?? '未命名区域'}）：`, error, info.componentStack)
    this.props.onError?.(error)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    const tt = (key: MessageKey, params?: Record<string, string | number>) =>
      translate(this.props.lang, key, params)
    return (
      <div className="wls-error-boundary" role="alert" data-testid="error-boundary">
        <div className="wls-eb-card">
          <span className="wls-eb-icon" aria-hidden>
            ⚠️
          </span>
          <h1>{tt('error.title')}</h1>
          <p>{tt('error.body')}</p>
          {this.props.label && <p className="wls-eb-where">{tt('error.where', { area: this.props.label })}</p>}
          <pre className="wls-eb-detail">{tt('error.detail', { msg: error.message })}</pre>
          <div className="wls-eb-actions">
            <button type="button" className="wls-eb-btn primary" onClick={this.reset}>
              {tt('error.retry')}
            </button>
            <button type="button" className="wls-eb-btn" onClick={() => window.location.reload()}>
              {tt('error.reload')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}

/** 函数外壳：订阅语言 store（切换语言时错误面板文案同步），内部为类组件（错误边界只能是类） */
export const ErrorBoundary: React.FC<ErrorBoundaryProps> = (props) => {
  const lang = useLanguage()
  return <ErrorBoundaryInner {...props} lang={lang} />
}
