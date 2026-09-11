import React, { useState } from 'react'
import { useT } from '../../i18n/useLanguage.ts'
import type { MessageKey } from '../../i18n/strings.ts'

/**
 * 画布左下角「操作提示」面板（R5）。
 *
 * 定位在 tldraw 缩放控件上方（bottom 与对话栏同一基线），默认收起为一个小胶囊，
 * 避免长期占用画布；展开后列出**实机实测过**的快捷键与项目自身操作。
 *
 * 诚实边界：这里的每一条都在真实浏览器里验证过（`scripts/` 内的临时实测脚本 + DOM 的
 * aria-label 读取）。**没有**凭印象写「Ctrl + 0 复位」「Shift + 1 适应」这类未生效的键——
 * 实测这两条在 tldraw v5 上无效果，故不写入。
 */
const ROWS: readonly MessageKey[] = [
  'shortcuts.pan',
  'shortcuts.zoom',
  'shortcuts.tools',
  'shortcuts.history',
  'shortcuts.delete',
  'shortcuts.addNode',
  'shortcuts.connect',
  'shortcuts.stage3d',
]

export const CanvasShortcutsHint: React.FC = () => {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <div className="wls-shortcuts" data-testid="canvas-shortcuts">
      {open && (
        <div className="wls-shortcuts-panel" role="dialog" aria-label={t('shortcuts.title')}>
          <div className="wls-shortcuts-title">{t('shortcuts.title')}</div>
          <ul className="wls-shortcuts-list">
            {ROWS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          <p className="wls-shortcuts-note">{t('shortcuts.collapseHint')}</p>
        </div>
      )}
      <button
        type="button"
        className="wls-shortcuts-toggle"
        data-testid="canvas-shortcuts-toggle"
        aria-expanded={open}
        title={t('shortcuts.title')}
        onClick={() => setOpen((v) => !v)}
      >
        {t('shortcuts.toggle')}
      </button>
    </div>
  )
}
