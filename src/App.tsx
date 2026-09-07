import { useState } from 'react'
import { SellWorkbench } from './ui/SellWorkbench.tsx'
import { DramaEditor } from './DramaEditor.tsx'
import { PwaUpdatePrompt } from './ui/components/PwaUpdatePrompt.tsx'

export default function App() {
  // 顶层模式：'sell' 为多 Agent 带货工作台（P0 核心），'drama' 为原剧情短剧粗剪台（无回归兼容）
  const [mode, setMode] = useState<'sell' | 'drama'>('sell')

  if (mode === 'drama') {
    return (
      <>
        <DramaEditor onSwitchToSell={() => setMode('sell')} />
        <PwaUpdatePrompt />
      </>
    )
  }

  return (
    <>
      <SellWorkbench onSwitchToDrama={() => setMode('drama')} />
      <PwaUpdatePrompt />
    </>
  )
}
