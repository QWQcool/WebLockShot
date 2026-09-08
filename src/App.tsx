import { lazy, Suspense, useState } from 'react'
import { SellWorkbench } from './ui/SellWorkbench.tsx'
import { DramaEditor } from './DramaEditor.tsx'
import { PwaUpdatePrompt } from './ui/components/PwaUpdatePrompt.tsx'

// 画布模式懒加载：tldraw 体积较大，代码分割保证 sell/drama 主包体积与加载行为零变化
const CanvasWorkbench = lazy(() =>
  import('./ui/canvas/CanvasWorkbench.tsx').then((m) => ({ default: m.CanvasWorkbench }))
)

export default function App() {
  // 顶层模式：'sell' 多 Agent 带货工作台（P0 核心）/'drama' 原剧情短剧粗剪台（兼容）/'canvas' Agent 创意画布（CANVAS_PLAN.md 一期 A）
  // 支持 ?view=canvas 深链直达（与 sell 模式 ?mode=&step= 的 URL 参数惯例一致）
  const [mode, setMode] = useState<'sell' | 'drama' | 'canvas'>(() => {
    try {
      return new URLSearchParams(window.location.search).get('view') === 'canvas'
        ? 'canvas'
        : 'sell'
    } catch {
      return 'sell'
    }
  })

  if (mode === 'drama') {
    return (
      <>
        <DramaEditor
          onSwitchToSell={() => setMode('sell')}
          onSwitchToCanvas={() => setMode('canvas')}
        />
        <PwaUpdatePrompt />
      </>
    )
  }

  if (mode === 'canvas') {
    return (
      <>
        <Suspense
          fallback={
            <div className="wls-canvas-loading" aria-live="polite">
              🎨 正在打开 Agent 画布…
            </div>
          }
        >
          <CanvasWorkbench
            onSwitchToSell={() => setMode('sell')}
            onSwitchToDrama={() => setMode('drama')}
          />
        </Suspense>
        <PwaUpdatePrompt />
      </>
    )
  }

  return (
    <>
      <SellWorkbench
        onSwitchToDrama={() => setMode('drama')}
        onSwitchToCanvas={() => setMode('canvas')}
      />
      <PwaUpdatePrompt />
    </>
  )
}
