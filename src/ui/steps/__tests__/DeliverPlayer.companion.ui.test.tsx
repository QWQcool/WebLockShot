import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DeliverPlayer } from '../DeliverPlayer.tsx'
import type { Story } from '../../../types.ts'
import type { ShotJob } from '../../../domain/shotJob.ts'
import type { VisualPlan } from '../../../domain/sellVisual.ts'

/**
 * P1-3 剪映落盘接线冒烟测试：
 * - /healthz 不可达（纯前端模式）→ 落盘按钮不显示
 * - /healthz 可达 → 落盘按钮显示；点击调用 POST /api/jianying/draft-zip 并展示落盘路径
 * - 落盘失败 → 错误横幅
 */

const story = {
  id: 'story-1',
  title: '测试工程',
  input: {},
  characters: [],
  setting: {},
  shots: [
    {
      id: 's1',
      order: 1,
      purpose: '钩子',
      shotSize: 'close_up',
      motionId: 'static',
      durationSec: 3,
      cast: [],
      line: '第一句台词',
    },
  ],
} as unknown as Story

const jobs = [
  {
    shotId: 's1',
    taskKey: 'k1',
    provider: 'kling',
    status: 'done',
    attempt: 0,
    progress: 100,
    asset: { url: 'blob:http://localhost/fake-video' },
  },
] as unknown as ShotJob[]

const plans = [{ shotId: 's1', order: 1, positive: 'p', durationSec: 3, caption: '字幕' }] as unknown as VisualPlan[]

function setupProps() {
  return {
    jobs,
    story,
    visualPlans: plans,
    onRegenerateSingleShot: vi.fn(),
    onRestartPipeline: vi.fn(),
  }
}

describe('DeliverPlayer 伴生服务落盘接线（P1-3）', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    // 默认：zip 抓取 blob 素材的 fetch 需可用（jsdom blob: fetch 会失败走 missingAssets 分支，无碍）
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 404 })))
  })

  it('healthz 不可达（纯前端模式）→ 不显示落盘按钮', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/healthz')) throw new TypeError('Failed to fetch')
        return new Response('{}', { status: 404 })
      })
    )
    render(<DeliverPlayer {...setupProps()} />)
    await waitFor(() => {
      // 探测完成后按钮始终不存在
      expect(screen.queryByTestId('companion-draft-zip-btn')).toBeNull()
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('companion-draft-zip-btn')).toBeNull()
  })

  it('healthz 可达 → 显示落盘按钮；点击调用 draft-zip 并展示落盘路径', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/healthz')) {
        return new Response(JSON.stringify({ ok: true, version: '0.1.0', tts: 'on' }), { status: 200 })
      }
      if (url.includes('/api/jianying/draft-zip')) {
        expect(init?.method).toBe('POST')
        expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/zip')
        return new Response(JSON.stringify({ ok: true, savedPath: '/app/jianying-drafts/draft_2026', files: ['draft_content.json'] }), {
          status: 200,
        })
      }
      // 素材抓取（blob:）失败走 missing 分支
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<DeliverPlayer {...setupProps()} />)

    // 按钮出现
    const btn = await screen.findByTestId('companion-draft-zip-btn')
    expect(btn).toBeTruthy()

    // 点击 → 成功消息含落盘路径
    btn.click()
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('/app/jianying-drafts/draft_2026')
    })
    // draft-zip 恰好被调用一次
    const draftCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/jianying/draft-zip'))
    expect(draftCalls.length).toBe(1)
  })

  it('draft-zip 失败（500）→ 显示错误横幅，不打断界面', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/healthz')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        if (url.includes('/api/jianying/draft-zip')) {
          void init
          return new Response(JSON.stringify({ error: 'zip 解压失败: 测试错误' }), { status: 500 })
        }
        return new Response('{}', { status: 404 })
      })
    )
    render(<DeliverPlayer {...setupProps()} />)

    const btn = await screen.findByTestId('companion-draft-zip-btn')
    btn.click()
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('落盘失败')
    })
  })
})
