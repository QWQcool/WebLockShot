import { lazy, Suspense, useState } from 'react'
import { SellWorkbench } from './ui/SellWorkbench.tsx'
import { DramaEditor } from './DramaEditor.tsx'
import { PwaUpdatePrompt } from './ui/components/PwaUpdatePrompt.tsx'

// 画布模式懒加载：tldraw 体积较大，代码分割保证 sell/drama 主包体积与加载行为零变化
const CanvasWorkbench = lazy(() =>
  import('./ui/canvas/CanvasWorkbench.tsx').then((m) => ({ default: m.CanvasWorkbench }))
)

export default function App() {
  // 顶层模式：'canvas' Agent 创意画布（默认入口，画布优先）/'sell' 多 Agent 带货工作台 /'drama' 剧情短剧粗剪台
  // 深链：?view=sell | drama | canvas（与 sell 模式 ?mode=&step= 的 URL 参数惯例一致）；
  // 无参数或参数非法时默认进入 Agent 画布（用户拍板：画布优先，带货次之）
  const [mode, setMode] = useState<'sell' | 'drama' | 'canvas'>(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('view')
      if (v === 'sell' || v === 'drama' || v === 'canvas') return v
      return 'canvas'
    } catch {
      return 'canvas'
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
