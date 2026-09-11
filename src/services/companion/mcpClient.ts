/**
 * D8 MCP 反向驱动 · 前端客户端（CANVAS_PLAN.md §9 D8-②）
 *
 * 对齐既有 companionClient / memoryClient 模式：
 * - /healthz 读 mcp 能力位（'ready' | 'off'）；不可达或未装 SDK = off（纯前端模式，零行为变化）
 * - 所有调用失败优雅降级：返回 Result 对象，不抛异常打断画布主流程
 */
import type { McpOp } from '../../canvas/mcpOps.ts'

export type McpCapability = {
  /** 伴生服务可达且已装可选依赖 @modelcontextprotocol/sdk */
  ready: boolean
  /** 未就绪时的安装指引（来自服务端，诚实原文） */
  guidance?: string
}

/** 探测 MCP 能力位（相对路径 fetch，同源部署） */
export async function probeMcpCapability(): Promise<McpCapability> {
  try {
    const res = await fetch('/healthz', { method: 'GET' })
    if (!res.ok) return { ready: false }
    const body = (await res.json()) as Record<string, unknown>
    return { ready: body.mcp === 'ready' }
  } catch {
    return { ready: false }
  }
}

export type PushTopologyResult = { ok: true; version: number } | { ok: false; error: string }

/** 画布拓扑推送到伴生服务（供本地 Agent 读取） */
export async function pushTopology(topology: {
  nodes: unknown[]
  edges: unknown[]
}): Promise<PushTopologyResult> {
  try {
    const res = await fetch('/api/mcp/canvas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(topology),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { ok: false, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` }
    }
    const body = (await res.json()) as { version?: number }
    return { ok: true, version: typeof body.version === 'number' ? body.version : 0 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络失败' }
  }
}

export type PullOpsResult =
  | { ok: true; seq: number; batches: { seq: number; ops: McpOp[] }[] }
  | { ok: false; error: string }

/** 拉取 seq > since 的 Agent 操作批（画布端轮询） */
export async function pullMcpOps(since: number): Promise<PullOpsResult> {
  try {
    const res = await fetch(`/api/mcp/ops?since=${encodeURIComponent(String(since))}`, {
      method: 'GET',
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { ok: false, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` }
    }
    const body = (await res.json()) as { seq?: number; batches?: unknown }
    const seq = typeof body.seq === 'number' ? body.seq : 0
    const batches = Array.isArray(body.batches)
      ? (body.batches as { seq?: number; ops?: unknown }[]).map((b) => ({
          seq: typeof b.seq === 'number' ? b.seq : 0,
          ops: (Array.isArray(b.ops) ? b.ops : []) as McpOp[],
        }))
      : []
    return { ok: true, seq, batches }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络失败' }
  }
}

/** 提交操作批（等价 MCP 工具 canvas_apply_ops；供页面内自测/文档演示） */
export async function submitMcpOps(ops: unknown[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/mcp/ops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { ok: false, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络失败' }
  }
}
