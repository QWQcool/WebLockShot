/**
 * React 绑定层（CANVAS_PLAN.md §9 I1）。
 *
 * 用 `useSyncExternalStore` 订阅模块级语言 store：任何组件调用 `useSetLanguage()` 切换后，
 * 所有使用 `useT()` 的组件同步重渲染——不需要 Context Provider 层层包裹。
 */
import { useCallback, useSyncExternalStore } from 'react'
import { getLanguageSnapshot, setLanguage, subscribeLanguage } from './language.ts'
import { t as translate, type Language, type MessageKey } from './strings.ts'

export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguageSnapshot, getLanguageSnapshot)
}

export function useSetLanguage(): (lang: Language) => void {
  return useCallback((lang: Language) => setLanguage(lang), [])
}

/** 返回当前语言的取词函数（语言变化时函数引用变化，组件随之重渲染） */
export function useT(): (key: MessageKey, params?: Record<string, string | number>) => string {
  const lang = useLanguage()
  return useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(lang, key, params),
    [lang]
  )
}
