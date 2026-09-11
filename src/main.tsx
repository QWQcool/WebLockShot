import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ui/components/ErrorBoundary.tsx'

// 根级兜底：任何渲染异常都降级为友好面板，绝不整页白屏（2026-09-11 线上白屏事故的防线之一）
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="应用根">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
