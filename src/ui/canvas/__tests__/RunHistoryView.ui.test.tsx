/**
 * 运行历史抽屉 UI 单测（P1 · S4）
 *
 * 用共享的 IndexedDB 内存替身驱动真实 runStore 读写（不 mock 组件内部），验证：
 * 列表/汇总/字段完整、**已退款徽章**、**0 币失败不显示已退款**、**持久输出引用回查**、清空、空态。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RunHistoryView } from '../RunHistoryView.tsx'
import { __resetRunStoreCacheForTest, appendRunRecord } from '../../../persist/runStore.ts'
import { installFakeIndexedDb, restoreIndexedDb } from '../../../persist/__tests__/fakeIndexedDb.ts'

/** 三条真实形态的记录：演示成功（0 币）/ 真实引擎失败（8 币已退款）/ 0 币失败（不应显示已退款） */
async function seed() {
  await appendRunRecord({
    kind: 'generate',
    status: 'succeeded',
    startedAt: 1000,
    endedAt: 1250,
    cost: 0,
    refunded: false,
    demo: true,
    provider: 'mock',
    shotId: 'story-s1',
    nodeId: 'shape:wls-1',
    outputRef: 'blob:http://127.0.0.1/dead-ref',
  })
  await appendRunRecord({
    kind: 'generate',
    status: 'failed',
    startedAt: 2000,
    endedAt: 3000,
    cost: 8,
    refunded: true,
    demo: false,
    provider: 'jimeng',
    shotId: 'story-s2',
    nodeId: 'shape:wls-1',
    error: '上游 4xx：额度不足',
  })
  await appendRunRecord({
    kind: 'generate',
    status: 'failed',
    startedAt: 4000,
    endedAt: 4100,
    cost: 0,
    refunded: true, // 数据层对 0 币也会「退款成功」，UI 不得据此显示已退款
    demo: true,
    provider: 'mock',
    shotId: 'story-s3',
    nodeId: 'shape:wls-1',
    error: '模拟上游 4xx（演示引擎）',
  })
}

const rowByText = (text: string) => {
  const row = screen.getAllByTestId('rh-row').find((r) => (r.textContent || '').includes(text))
  if (!row) throw new Error(`未找到包含「${text}」的记录行`)
  return row
}

beforeEach(() => {
  __resetRunStoreCacheForTest()
  installFakeIndexedDb()
})

afterEach(() => {
  __resetRunStoreCacheForTest()
  restoreIndexedDb()
})

describe('RunHistoryView 运行历史抽屉', () => {
  it('无记录：诚实空态（不摆样例数据）', () => {
    render(<RunHistoryView onClose={() => {}} />)
    expect(screen.getByTestId('rh-empty')).toBeTruthy()
    expect(screen.queryAllByTestId('rh-row').length).toBe(0)
  })

  it('列表 + 汇总：状态/耗时/费用字段完整，演示记录标注「演示 · 非真实生成」', async () => {
    await seed()
    render(<RunHistoryView onClose={() => {}} />)

    const summary = screen.getByTestId('rh-summary').textContent || ''
    expect(summary).toContain('总 3 次')
    expect(summary).toContain('成功 1')
    expect(summary).toContain('失败 2')
    expect(summary).toContain('净消耗 0 币')
    expect(summary).toContain('已退回 8 币')

    expect(screen.getAllByTestId('rh-row').length).toBe(3)

    const okRow = rowByText('成功')
    expect(okRow.textContent).toContain('耗时 250 ms')
    expect(okRow.textContent).toContain('0 灵感币（未扣费）')
    expect(okRow.textContent).toContain('演示 · 非真实生成')
  })

  it('钱包打通：展开失败记录能看到失败原因，且真实扣费+退款显示「已退款」', async () => {
    await seed()
    render(<RunHistoryView onClose={() => {}} />)

    // 失败原因只在展开详情里，故按费用定位行（8 币 = 真实引擎那次）
    const failRow = rowByText('8 灵感币')
    expect(failRow.textContent).toContain('已退款')

    fireEvent.click(failRow.querySelector('button') as HTMLButtonElement)
    const detail = await screen.findByTestId('rh-detail')
    expect(detail.textContent).toContain('上游 4xx：额度不足')
    expect(detail.textContent).toContain('已发生退款（原路退回）')
  })

  it('0 币失败不得显示「已退款」（S3 观察项）', async () => {
    await seed()
    render(<RunHistoryView onClose={() => {}} />)

    // 只有「8 币且已退款」那条显示徽章；0 币失败那条即使 refunded=true 也不显示
    expect(screen.getAllByTestId('rh-refund-badge').length).toBe(1)

    const zeroRow = screen
      .getAllByTestId('rh-row')
      .find((r) => (r.textContent || '').includes('失败') && (r.textContent || '').includes('0 灵感币'))!
    expect(zeroRow.textContent).not.toContain('已退款')
    fireEvent.click(zeroRow.querySelector('button') as HTMLButtonElement)
    const detail = await screen.findByTestId('rh-detail')
    expect(detail.textContent).toContain('无款项可退')
    expect(detail.textContent).toContain('模拟上游 4xx（演示引擎）')
  })

  it('持久输出引用：blob: 记录回查节点 meta 的 idbref（查不到则如实显示已失效）', async () => {
    await seed()
    render(
      <RunHistoryView
        onClose={() => {}}
        resolveDurableRef={(_nodeId, shotId) => (shotId === 'story-s1' ? 'idbref://video_ok' : undefined)}
      />
    )

    fireEvent.click(rowByText('成功').querySelector('button') as HTMLButtonElement)
    const out = await screen.findByTestId('rh-output')
    expect(out.textContent).toContain('idbref://video_ok')
    expect(out.textContent).toContain('取自节点 meta')
  })

  it('持久输出引用：无回查（或回查失败）时如实显示「已失效」，不伪造引用', async () => {
    await seed()
    render(<RunHistoryView onClose={() => {}} />)
    fireEvent.click(rowByText('成功').querySelector('button') as HTMLButtonElement)
    const out = await screen.findByTestId('rh-output')
    expect(out.textContent).toContain('产物引用已失效')
  })

  it('清空：点击后记录清空并回到空态', async () => {
    await seed()
    render(<RunHistoryView onClose={() => {}} />)
    expect(screen.getAllByTestId('rh-row').length).toBe(3)

    fireEvent.click(screen.getByTestId('rh-clear'))
    await waitFor(() => expect(screen.getByTestId('rh-empty')).toBeTruthy())
    expect(screen.queryAllByTestId('rh-row').length).toBe(0)
  })

  it('关闭按钮触发 onClose', () => {
    let closed = 0
    render(<RunHistoryView onClose={() => { closed++ }} />)
    fireEvent.click(screen.getByTestId('rh-close'))
    expect(closed).toBe(1)
  })
})
