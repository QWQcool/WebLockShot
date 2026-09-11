/**
 * 幂等锁 · 页身份（pageId）单测 —— S4 收口
 *
 * 背景（缺陷）：锁元数据原先只存 localStorage、没有页身份。用户在**出片中途刷新页面**后，
 * 未完成镜次的锁会残留 TTL（≈11 分钟），再次点出片时被误报「相同任务似乎正在其它标签页
 * 执行中（检测到跨页任务锁）」——既无法重试、提示又具有误导性。
 *
 * 修法：锁元数据带 `pageId`（sessionStorage：同标签页跨刷新保持、跨标签页不同）。
 * 本文件覆盖：① 刷新后本页可覆盖自己的陈旧锁；② 跨标签页仍互斥；③ releaseLock 无残留；
 * ④/⑤/⑥ 保守降级（不可判定归属时不阻断，避免误锁）。
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { IdempotencyManager } from '../idempotency.ts'

const LOCK_PREFIX = 'weblockshot.idempotency.lock.'
const PAGE_ID_KEY = 'weblockshot.page_instance_id'

/** 最小 Storage 桩（同时充当 localStorage / sessionStorage） */
class FakeStorage {
  map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.map.delete(k)
  }
  get length(): number {
    return this.map.size
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null
  }
  clear(): void {
    this.map.clear()
  }
}

const originalLocal = (globalThis as { localStorage?: unknown }).localStorage
const originalSession = (globalThis as { sessionStorage?: unknown }).sessionStorage

/** 安装存储：local 为「跨标签页共享」，session 为「本标签页私有」（传 undefined 模拟不可用） */
function installStorages(session: FakeStorage | undefined, local: FakeStorage): void {
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = session
  ;(globalThis as { localStorage?: unknown }).localStorage = local
}

afterEach(() => {
  if (originalLocal === undefined) delete (globalThis as { localStorage?: unknown }).localStorage
  else (globalThis as { localStorage?: unknown }).localStorage = originalLocal
  if (originalSession === undefined) delete (globalThis as { sessionStorage?: unknown }).sessionStorage
  else (globalThis as { sessionStorage?: unknown }).sessionStorage = originalSession
})

describe('幂等锁 · 页身份（刷新后不再误报「跨标签页」）', () => {
  it('① 刷新后本页可覆盖自己的陈旧锁（不再被拒）', () => {
    const local = new FakeStorage()
    const session = new FakeStorage() // 同一标签页：sessionStorage 跨「刷新」保持
    installStorages(session, local)

    const pageBefore = new IdempotencyManager()
    assert.equal(pageBefore.acquireLock('k1').success, true)
    assert.ok(local.getItem(LOCK_PREFIX + 'k1'), '获取锁后应写入锁元数据')
    const pageIdBefore = session.getItem(PAGE_ID_KEY)
    assert.ok(pageIdBefore, '应生成页实例 id')

    // 模拟刷新：内存锁随页面销毁（换新实例），但 sessionStorage 保持 → pageId 不变
    const pageAfterReload = new IdempotencyManager()
    assert.equal(session.getItem(PAGE_ID_KEY), pageIdBefore, '刷新后 pageId 应保持不变')
    const res = pageAfterReload.acquireLock('k1')
    assert.equal(res.success, true, `刷新后应可立即重试（实测：${res.reason ?? 'ok'}）`)
    assert.equal(res.reason, undefined)
  })

  it('② 跨标签页仍互斥（pageId 不同 → 仍拒绝）', () => {
    const local = new FakeStorage() // localStorage 跨标签页共享
    installStorages(new FakeStorage(), local)
    const pageA = new IdempotencyManager()
    assert.equal(pageA.acquireLock('k2').success, true)

    installStorages(new FakeStorage(), local) // 另一标签页：sessionStorage 独立 → 另一 pageId
    const pageB = new IdempotencyManager()
    const res = pageB.acquireLock('k2')
    assert.equal(res.success, false, '另一标签页持有新鲜锁时应拒绝')
    assert.match(res.reason ?? '', /其它标签页/)
  })

  it('③ 正常 releaseLock 后无残留（且可再次获取）', () => {
    const local = new FakeStorage()
    installStorages(new FakeStorage(), local)
    const page = new IdempotencyManager()
    assert.equal(page.acquireLock('k3').success, true)
    assert.ok(local.getItem(LOCK_PREFIX + 'k3'))

    page.releaseLock('k3')
    assert.equal(local.getItem(LOCK_PREFIX + 'k3'), null, '释放后不应残留锁元数据')
    assert.equal(page.acquireLock('k3').success, true, '释放后应可再次获取')
  })
})

describe('幂等锁 · 保守降级（不可判定归属时不阻断，避免误锁）', () => {
  it('④ sessionStorage 不可用（隐私模式）→ 未知 = 不阻断', () => {
    const local = new FakeStorage()
    installStorages(undefined, local)
    const a = new IdempotencyManager()
    assert.equal(a.acquireLock('k4').success, true)

    // 另一实例同样拿不到 pageId → 无法判定归属 → 不阻断。
    // ⚠️ 代价（如实标注）：该场景下跨标签页同任务防重退化为「不拦截」；本仓库内**无法证实**
    // 存在更强的兜底（详见 idempotency.ts 中 acquireLock 的诚实边界注释），故不要当成「有兜底」。
    const b = new IdempotencyManager()
    assert.equal(b.acquireLock('k4').success, true)
  })

  it('⑤ 过期的他人锁不阻断（TTL 之外视为陈旧）', () => {
    const local = new FakeStorage()
    installStorages(new FakeStorage(), local)
    local.setItem(
      LOCK_PREFIX + 'k5',
      JSON.stringify({ token: 't', at: Date.now() - 60 * 60_000, pageId: 'pg_other' })
    )
    const page = new IdempotencyManager()
    assert.equal(page.acquireLock('k5').success, true)
  })

  it('⑥ 旧版本写入的无 pageId 锁元数据 → 不阻断（不误锁）', () => {
    const local = new FakeStorage()
    installStorages(new FakeStorage(), local)
    local.setItem(LOCK_PREFIX + 'k6', JSON.stringify({ token: 't', at: Date.now() }))
    const page = new IdempotencyManager()
    assert.equal(page.acquireLock('k6').success, true)
  })
})
