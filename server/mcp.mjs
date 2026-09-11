/**
 * D8 MCP 桥接（CANVAS_PLAN.md §9 D8）：**可选依赖** + 反向驱动画布
 *
 * 设计原则（用户拍板「可选依赖」）：
 * - **默认零依赖不变**：伴生服务不静态 import `@modelcontextprotocol/sdk`，只在启动时
 *   try/catch 动态探测；未安装 = 现状（能力位 `connectors:'interface'`，全部 501 + 安装指引）；
 * - 装了 = 能力位切 `'ready'`，本模块的桥接端点全部启用；
 * - 无论是否装 SDK，服务器都**零报错**（动态 import 失败优雅降级）。
 *
 * 双向：
 * - **正向（第三方 → 画布）**：连接器 run（见 connectors.mjs，GitHub REST）；
 * - **反向（本地 Agent → 画布）**：本模块暴露画布拓扑镜像 + 操作队列——
 *   本地 Agent（Codex / Claude Code 等）经 MCP 工具读取画布拓扑、提交建节点/连线操作，
 *   画布端轮询拉取并实时反映。
 *
 * 端点：
 * - GET  /api/mcp/status        → { ready, sdkInstalled, tools, guidance }
 * - GET  /api/mcp/canvas        → { version, topology }（Agent 读取画布拓扑）
 * - PUT  /api/mcp/canvas        → 画布端推送拓扑镜像（服务端不校验业务语义，只做形状防线）
 * - POST /api/mcp/ops           → Agent 提交操作批（等价于 MCP 工具 canvas_apply_ops）
 * - GET  /api/mcp/ops?since=N   → 画布端拉取 seq > N 的操作批
 */

/** 反向驱动可用工具（MCP 工具名，供 /api/mcp/status 与文档展示） */
export const MCP_TOOL_NAMES = ['canvas_read_topology', 'canvas_apply_ops']

/** 节点类型白名单（与前端 CANVAS_NODE_KINDS 保持一致，两侧单测钉住） */
export const MCP_NODE_KINDS = [
  'brief',
  'product',
  'image',
  'script',
  'storyboard',
  'generate',
  'asset',
  'edit',
  'stage3d',
  'deliver',
]

export const MCP_MAX_OPS = 50
export const MCP_MAX_NODES = 200

/**
 * 动态探测可选依赖 `@modelcontextprotocol/sdk`（永不抛异常）。
 * @param {() => Promise<unknown>} [importFn] 可注入（单测模拟已装/未装）
 * @returns {Promise<boolean>}
 */
export async function detectMcpSdk(importFn) {
  const doImport =
    importFn ||
    (() => import('@modelcontextprotocol/sdk/server/mcp.js'))
  try {
    const mod = await doImport()
    return Boolean(mod)
  } catch {
    return false
  }
}

/** 未安装 SDK 时的统一诚实指引 */
export const MCP_INSTALL_GUIDANCE =
  '未安装可选依赖 @modelcontextprotocol/sdk：反向驱动画布不可用。安装：npm i @modelcontextprotocol/sdk 后重启伴生服务（默认零依赖行为不变）。'

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 操作批校验 + 应用（纯函数，整体拒绝不半应用）。
 * @param {{nodes: object[], edges: object[]}} topology
 * @param {Array<object>} ops
 * @returns {{ ok: true, topology: object, applied: number } | { ok: false, reason: string }}
 */
export function applyCanvasOps(topology, ops) {
  if (!Array.isArray(ops)) return { ok: false, reason: 'ops 必须是数组' }
  if (ops.length === 0) return { ok: false, reason: 'ops 不能为空' }
  if (ops.length > MCP_MAX_OPS) return { ok: false, reason: `单批操作数超过 ${MCP_MAX_OPS} 上限` }
  const base = isPlainObject(topology) ? topology : { nodes: [], edges: [] }
  const nodes = Array.isArray(base.nodes) ? base.nodes.map((n) => ({ ...n })) : []
  const edges = Array.isArray(base.edges) ? base.edges.map((e) => ({ ...e })) : []
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edgeIds = new Set(edges.map((e) => e.id))

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    if (!isPlainObject(op)) return { ok: false, reason: `第 ${i + 1} 个操作不是对象` }
    if (op.type === 'create-node') {
      if (typeof op.id !== 'string' || !op.id.trim()) {
        return { ok: false, reason: `第 ${i + 1} 个操作缺少 id` }
      }
      if (nodeIds.has(op.id)) return { ok: false, reason: `节点 id 重复：${op.id}` }
      if (!MCP_NODE_KINDS.includes(op.kind)) {
        return { ok: false, reason: `节点类型不合法：${op.kind}（允许：${MCP_NODE_KINDS.join('/')}）` }
      }
      if (nodes.length >= MCP_MAX_NODES) {
        return { ok: false, reason: `节点数超过 ${MCP_MAX_NODES} 上限` }
      }
      const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
      nodes.push({
        id: op.id,
        kind: op.kind,
        x: num(op.x, 0),
        y: num(op.y, 0),
        w: num(op.w, 260),
        h: num(op.h, 200),
        meta: isPlainObject(op.meta) ? op.meta : {},
      })
      nodeIds.add(op.id)
    } else if (op.type === 'create-edge') {
      if (typeof op.id !== 'string' || !op.id.trim()) {
        return { ok: false, reason: `第 ${i + 1} 个操作缺少 id` }
      }
      if (edgeIds.has(op.id)) return { ok: false, reason: `边 id 重复：${op.id}` }
      if (op.from === op.to) return { ok: false, reason: `不允许自环：${op.from}` }
      if (!nodeIds.has(op.from) || !nodeIds.has(op.to)) {
        return { ok: false, reason: `边两端节点不存在：${op.from} → ${op.to}` }
      }
      edges.push({ id: op.id, from: op.from, to: op.to })
      edgeIds.add(op.id)
    } else {
      return { ok: false, reason: `不支持的操作类型：${String(op.type)}` }
    }
  }
  return { ok: true, topology: { nodes, edges }, applied: ops.length }
}

/**
 * 构造 MCP 桥接处理器。
 * @param {{ ready: boolean, store: { get, set }, logger?: object }} opts
 *   ready = SDK 已安装（未安装时全部端点 501 + 安装指引）
 */
export function createMcpHandler({ ready, store, logger } = {}) {
  const TOPOLOGY_KEY = 'mcp-canvas-topology'
  const OPS_KEY = 'mcp-canvas-ops'

  const readJson = (key, fallback) => {
    const raw = store?.get?.(key)
    if (!raw) return fallback
    try {
      const parsed = JSON.parse(raw)
      return parsed ?? fallback
    } catch {
      return fallback
    }
  }
  const writeJson = (key, value) => store?.set?.(key, JSON.stringify(value))

  const readState = () => readJson(TOPOLOGY_KEY, { version: 0, topology: { nodes: [], edges: [] } })
  const readOps = () => readJson(OPS_KEY, { seq: 0, batches: [] })

  const notReady = (res) => {
    sendJson(res, 501, { ok: false, ready: false, error: MCP_INSTALL_GUIDANCE })
  }

  return async function handleMcp(req, res, urlPath) {
    const url = new URL(urlPath, 'http://localhost')

    if (url.pathname === '/api/mcp/status') {
      sendJson(res, 200, {
        ready: Boolean(ready),
        sdkInstalled: Boolean(ready),
        tools: MCP_TOOL_NAMES,
        ...(ready ? {} : { guidance: MCP_INSTALL_GUIDANCE }),
      })
      return
    }

    if (!ready) {
      notReady(res)
      return
    }

    try {
      // 画布端推送拓扑镜像 / Agent 读取拓扑
      if (url.pathname === '/api/mcp/canvas') {
        if (req.method === 'GET') {
          const state = readState()
          sendJson(res, 200, { version: state.version, topology: state.topology })
          return
        }
        if (req.method === 'PUT') {
          let body
          try {
            body = JSON.parse((await readBody(req)).toString('utf8'))
          } catch {
            sendJson(res, 400, { error: '请求体必须是合法 JSON' })
            return
          }
          if (!isPlainObject(body) || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
            sendJson(res, 400, { error: 'topology 必须形如 { nodes: [], edges: [] }' })
            return
          }
          if (body.nodes.length > MCP_MAX_NODES) {
            sendJson(res, 400, { error: `节点数超过 ${MCP_MAX_NODES} 上限` })
            return
          }
          const prev = readState()
          const next = { version: prev.version + 1, topology: { nodes: body.nodes, edges: body.edges } }
          writeJson(TOPOLOGY_KEY, next)
          sendJson(res, 200, { ok: true, version: next.version })
          return
        }
        sendJson(res, 405, { error: '仅支持 GET/PUT' })
        return
      }

      // Agent 提交操作批（等价 MCP 工具 canvas_apply_ops）
      if (url.pathname === '/api/mcp/ops' && req.method === 'POST') {
        let body
        try {
          body = JSON.parse((await readBody(req)).toString('utf8'))
        } catch {
          sendJson(res, 400, { error: '请求体必须是合法 JSON' })
          return
        }
        const ops = isPlainObject(body) ? body.ops : body
        const state = readState()
        const result = applyCanvasOps(state.topology, ops)
        if (!result.ok) {
          sendJson(res, 400, { ok: false, error: result.reason })
          return
        }
        const next = { version: state.version + 1, topology: result.topology }
        writeJson(TOPOLOGY_KEY, next)
        const opsState = readOps()
        const seq = opsState.seq + 1
        const batches = [...opsState.batches, { seq, ops, at: Date.now() }].slice(-100)
        writeJson(OPS_KEY, { seq, batches })
        logger?.info?.({ seq, applied: result.applied }, '[mcp] 已受理 Agent 操作批')
        sendJson(res, 200, { ok: true, seq, version: next.version, applied: result.applied })
        return
      }

      // 画布端拉取未消费的操作批
      if (url.pathname === '/api/mcp/ops' && req.method === 'GET') {
        const since = Number(url.searchParams.get('since') ?? 0) || 0
        const opsState = readOps()
        const pending = opsState.batches.filter((b) => b.seq > since)
        sendJson(res, 200, { seq: opsState.seq, batches: pending })
        return
      }

      sendJson(res, 404, { error: '未知 MCP 路由' })
    } catch (err) {
      logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, '[mcp] 处理异常')
      if (!res.headersSent) sendJson(res, 500, { error: 'MCP 桥接内部错误' })
      else res.end()
    }
  }
}

/** 读取请求体（上限 512KB：拓扑可能较大） */
function readBody(req, maxBytes = 512 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (err, data) => {
      if (settled) return
      settled = true
      if (err) rejectBody(err)
      else resolveBody(data)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        finish(Object.assign(new Error('body too large'), { status: 413 }))
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(null, Buffer.concat(chunks)))
    req.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))))
  })
}

function sendJson(res, status, payload) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}
