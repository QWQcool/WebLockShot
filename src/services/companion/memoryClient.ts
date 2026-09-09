/**
 * 记忆系统伴生服务客户端（CANVAS_PLAN.md §9 S3）
 *
 * 对齐 companionClient.ts 既有模式：
 * - /healthz 读 memory 能力位（'sqlite' | 'off'）；不可达 = 'off'（纯前端模式）
 * - 所有调用失败优雅降级：返回 Result 对象，不抛异常打断主流程
 */

export type MemoryCapability = {
  /** 伴生服务可达且 memory 能力位 = 'sqlite' */
  serverMode: boolean
}

/**
 * 探测记忆系统能力位（相对路径 fetch，同源部署；开发模式走 Vite 反代同源）。
 * 任何网络异常/非 200/能力位非 sqlite → 'off'（纯前端模式）。
 */
export async function probeMemoryCapability(): Promise<MemoryCapability> {
  try {
    const res = await fetch('/healthz', { method: 'GET' })
    if (!res.ok) return { serverMode: false }
    const body = (await res.json()) as Record<string, unknown>
    return { serverMode: body.memory === 'sqlite' }
  } catch {
    return { serverMode: false }
  }
}

export type MemoryFetchResult =
  | { ok: true; records: unknown[] }
  | { ok: false; error: string }

/** GET /api/memory/records 全量回流记录（服务端模式） */
export async function fetchMemoryRecords(): Promise<MemoryFetchResult> {
  try {
    const res = await fetch('/api/memory/records', { method: 'GET' })
    const body = (await res.json().catch(() => null)) as { records?: unknown[]; error?: string } | null
    if (!res.ok || !body) {
      return { ok: false, error: body?.error || `伴生服务返回 HTTP ${res.status}` }
    }
    return { ok: true, records: Array.isArray(body.records) ? body.records : [] }
  } catch (err) {
    return { ok: false, error: `伴生服务不可达：${err instanceof Error ? err.message : String(err)}` }
  }
}

export type MemoryPostResult =
  | { ok: true; id: string; total: number }
  | { ok: false; error: string }

/** POST /api/memory/records 单条录入（服务端模式） */
export async function postMemoryRecord(record: Record<string, unknown>): Promise<MemoryPostResult> {
  try {
    const res = await fetch('/api/memory/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; total?: number; error?: string } | null
    if (!res.ok || !body) {
      return { ok: false, error: body?.error || `伴生服务返回 HTTP ${res.status}` }
    }
    return { ok: true, id: body.id ?? '', total: body.total ?? 0 }
  } catch (err) {
    return { ok: false, error: `伴生服务不可达：${err instanceof Error ? err.message : String(err)}` }
  }
}

export type MemoryClearResult =
  | { ok: true; cleared: number }
  | { ok: false; error: string }

/** DELETE /api/memory/records 清空（服务端模式） */
export async function clearMemoryRecords(): Promise<MemoryClearResult> {
  try {
    const res = await fetch('/api/memory/records', { method: 'DELETE' })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; cleared?: number; error?: string } | null
    if (!res.ok || !body) {
      return { ok: false, error: body?.error || `伴生服务返回 HTTP ${res.status}` }
    }
    return { ok: true, cleared: body.cleared ?? 0 }
  } catch (err) {
    return { ok: false, error: `伴生服务不可达：${err instanceof Error ? err.message : String(err)}` }
  }
}
