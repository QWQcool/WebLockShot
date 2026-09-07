import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PipelineEngineBar } from '../PipelineEngineBar.tsx'
import type { VideoProviderId } from '../../../domain/shotJob.ts'

describe('PipelineEngineBar 引擎条（M1d 移动适配）冒烟测试', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('渲染 4 个引擎选项，当前引擎高亮 active', () => {
    render(<PipelineEngineBar providerId="kling" onSelectProvider={() => {}} />)
    expect(screen.getByText(/Mock 实验画布/)).toBeTruthy()
    expect(screen.getByText(/快手可灵/)).toBeTruthy()
    expect(screen.getByText(/字节即梦/)).toBeTruthy()
    expect(screen.getByText(/ComfyUI 私有算力/)).toBeTruthy()

    const active = screen.getByText(/快手可灵/).closest('button')
    expect(active?.className).toContain('active')
  })

  it('点击引擎按钮触发 onSelectProvider 回调', () => {
    const selected: VideoProviderId[] = []
    render(<PipelineEngineBar providerId="mock" onSelectProvider={(id) => selected.push(id)} />)
    fireEvent.click(screen.getByText(/字节即梦/))
    expect(selected).toEqual(['jimeng'])
  })

  it('折叠开关：点击后选项隐藏、aria-expanded 翻转，状态写入 sessionStorage', () => {
    render(<PipelineEngineBar providerId="mock" onSelectProvider={() => {}} />)
    const toggle = screen.getByRole('button', { name: /模型引擎/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(sessionStorage.getItem('weblockshot.engine_bar_collapsed')).toBe('1')
    // 折叠后选项容器 hidden
    const options = document.getElementById('engine-bar-options')
    expect(options?.getAttribute('hidden')).not.toBeNull()

    // 再展开恢复
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(sessionStorage.getItem('weblockshot.engine_bar_collapsed')).toBe('0')
  })

  it('响应式关键类：容器含 pipeline-engine-bar 与折叠态 collapsed 类', () => {
    const { container } = render(<PipelineEngineBar providerId="mock" onSelectProvider={() => {}} />)
    const bar = container.querySelector('.pipeline-engine-bar')
    expect(bar).toBeTruthy()
    expect(bar?.className).not.toContain('collapsed')

    const toggle = screen.getByRole('button', { name: /模型引擎/ })
    fireEvent.click(toggle)
    expect(bar?.className).toContain('collapsed')
  })
})
