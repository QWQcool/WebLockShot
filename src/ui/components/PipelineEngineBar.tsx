import React, { useState } from 'react'
import type { VideoProviderId } from '../../domain/shotJob.ts'

/**
 * 全链路引擎条（从 SellWorkbench 拆出，M1d 手机适配）：
 * - <768px 默认折叠为单行（状态持久化到 sessionStorage，手动展开后记住）；
 * - 折叠/展开按钮 44px 触控目标；
 * - provider 选择逻辑仍在宿主（SellWorkbench / 设置弹窗双向同步不变）。
 */

const ENGINE_BAR_COLLAPSED_KEY = 'weblockshot.engine_bar_collapsed'

function readInitialCollapsed(): boolean {
  try {
    const stored = sessionStorage.getItem(ENGINE_BAR_COLLAPSED_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
  } catch {}
  // 手机首访默认折叠，节省纵向空间；桌面默认展开（现状不变）
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches) {
      return true
    }
  } catch {}
  return false
}

export const ENGINE_OPTIONS: Array<{ id: VideoProviderId; label: string; title?: string }> = [
  { id: 'mock', label: 'Mock 实验画布 (免费)' },
  { id: 'kling', label: '快手可灵 (Kling)' },
  { id: 'jimeng', label: '字节即梦 (Jimeng)' },
  { id: 'comfyui', label: '🔥 ComfyUI 私有算力' },
  // M1 海外引擎：契约先行（请求/响应形状已按官方文档实现并锁定 fixtures），
  // 但尚未在真实账号下跑通出片 —— 悬停提示如实标注，不假装已验证
  {
    id: 'runway',
    label: 'Runway (Gen-4)',
    title: '海外引擎 · 契约已实现（官方 v1 形状），尚未在真实 Runway 账号下跑通出片（待真实环境验证）',
  },
  {
    id: 'luma',
    label: 'Luma (Dream Machine)',
    title: '海外引擎 · 契约已实现（官方 dream-machine v1 形状），尚未在真实 Luma 账号下跑通出片（待真实环境验证）',
  },
]

type Props = {
  providerId: VideoProviderId
  onSelectProvider: (id: VideoProviderId) => void
}

export const PipelineEngineBar: React.FC<Props> = ({ providerId, onSelectProvider }) => {
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed)

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        sessionStorage.setItem(ENGINE_BAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {}
      return next
    })
  }

  return (
    <section className={`pipeline-engine-bar ${collapsed ? 'collapsed' : ''}`} aria-label="模型引擎选择">
      <button
        type="button"
        className="engine-bar-toggle"
        aria-expanded={!collapsed}
        aria-controls="engine-bar-options"
        onClick={toggle}
        title={collapsed ? '展开模型引擎选择' : '收起模型引擎选择'}
      >
        <span aria-hidden="true">{collapsed ? '⚙️' : '▾'}</span>
        <span className="engine-bar-toggle-text">模型引擎</span>
      </button>

      <div className="control-pill-group" id="engine-bar-options" hidden={collapsed}>
        <span className="pill-label">模型引擎:</span>
        {ENGINE_OPTIONS.map(({ id, label, title }) => (
          <button
            key={id}
            type="button"
            title={title}
            className={`pill-btn ${id === 'comfyui' ? 'comfyui-btn' : ''} ${providerId === id ? 'active' : ''}`}
            onClick={() => onSelectProvider(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  )
}
