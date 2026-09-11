import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from './weblockshot-server.mjs'
import {
  MCP_INSTALL_GUIDANCE,
  MCP_NODE_KINDS,
  MCP_TOOL_NAMES,
  applyCanvasOps,
  createMcpHandler,
  detectMcpSdk,
} from './mcp.mjs'

function tmpDist() {
  return mkdtempSync(join(tmpdir(), 'wls-mcp-test-'))
}
async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

/** 内存 store stub（对齐 storage.mjs kv 接口） */
function memStore() {
  const map = new Map()
  return {
    mode: 'memory',
    get: (id) => map.get(id) ?? null,
    set: (id, data) => map.set(id, data),
    delete: (id) => map.delete(id),
    close() {},
  }
}

function mockRes() {
  return {
    status: null,
    payload: null,
    headersSent: false,
    writeHead(s) {
      this.status = s
      this.headersSent = true
    },
    end(txt) {
      this.payload = txt ? JSON.parse(txt) : null
    },
    destroy() {},
  }
}

async function callHandler(handler, method, urlPath, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    headers: {},
    on(ev, cb) {
      if (ev === 'data') chunks.forEach((c) => cb(c))
      if (ev === 'end') cb()
      if (ev === 'error') return
    },
  }
  const res = mockRes()
  await handler(req, res, urlPath)
  return res
}

/* ---------------- 可选依赖探测 ---------------- */

test('detectMcpSdk：注入 import 成功 = true / 失败 = false（永不抛异常）', async () => {
  assert.equal(await detectMcpSdk(async () => ({ default: {} })), true)
  assert.equal(
    await detectMcpSdk(async () => {
      throw new Error('module not found')
    }),
    false
  )
  // 真实环境（本仓库未装该可选依赖）应优雅返回 false，不抛
  assert.equal(await detectMcpSdk(), false)
})

test('MCP 常量：工具名与节点白名单', () => {
  assert.deepEqual(MCP_TOOL_NAMES, ['canvas_read_topology', 'canvas_apply_ops'])
  assert.ok(MCP_NODE_KINDS.includes('brief'))
  assert.ok(MCP_NODE_KINDS.includes('stage3d'))
  assert.equal(MCP_NODE_KINDS.length, 10)
})

/* ---------------- applyCanvasOps 纯函数 ---------------- */

test('applyCanvasOps：建节点 + 连线整体应用；非法整体拒绝', () => {
  const base = { nodes: [], edges: [] }
  const ok = applyCanvasOps(base, [
    { type: 'create-node', id: 'n1', kind: 'brief', x: 10, y: 20, meta: { text: '需求' } },
    { type: 'create-node', id: 'n2', kind: 'script' },
    { type: 'create-edge', id: 'e1', from: 'n1', to: 'n2' },
  ])
  assert.equal(ok.ok, true)
  if (!ok.ok) return
  assert.equal(ok.topology.nodes.length, 2)
  assert.equal(ok.topology.edges.length, 1)
  assert.equal(ok.topology.nodes[0].w, 260, '尺寸缺省兜底')
  assert.equal(ok.topology.nodes[1].meta && Object.keys(ok.topology.nodes[1].meta).length, 0)

  const bad = [
    ['非数组', 'x', /数组/],
    ['空数组', [], /不能为空/],
    ['缺 id', [{ type: 'create-node', kind: 'brief' }], /缺少 id/],
    ['id 重复', [
      { type: 'create-node', id: 'a', kind: 'brief' },
      { type: 'create-node', id: 'a', kind: 'script' },
    ], /重复/],
    ['类型非法', [{ type: 'create-node', id: 'a', kind: 'not-a-kind' }], /类型不合法/],
    ['自环', [
      { type: 'create-node', id: 'a', kind: 'brief' },
      { type: 'create-edge', id: 'e', from: 'a', to: 'a' },
    ], /自环/],
    ['端点不存在', [{ type: 'create-edge', id: 'e', from: 'a', to: 'b' }], /不存在/],
    ['未知操作', [{ type: 'delete-node', id: 'a' }], /不支持/],
  ]
  for (const [label, ops, re] of bad) {
    const r = applyCanvasOps(base, ops)
    assert.equal(r.ok, false, `${label} 应拒绝`)
    if (!r.ok) assert.match(r.reason, re, label)
  }

  // 超批上限
  const many = Array.from({ length: 51 }, (_, i) => ({ type: 'create-node', id: `n${i}`, kind: 'brief' }))
  assert.equal(applyCanvasOps(base, many).ok, false)
})

/* ---------------- handler：未就绪 = 501 + 安装指引 ---------------- */

test('createMcpHandler（未装 SDK）：全部端点 501 + 安装指引，status 仍可用', async () => {
  const handler = createMcpHandler({ ready: false, store: memStore() })
  const status = await callHandler(handler, 'GET', '/api/mcp/status')
  assert.equal(status.status, 200)
  assert.equal(status.payload.ready, false)
  assert.equal(status.payload.sdkInstalled, false)
  assert.deepEqual(status.payload.tools, MCP_TOOL_NAMES)
  assert.equal(status.payload.guidance, MCP_INSTALL_GUIDANCE)

  for (const [method, path] of [
    ['GET', '/api/mcp/canvas'],
    ['PUT', '/api/mcp/canvas'],
    ['POST', '/api/mcp/ops'],
    ['GET', '/api/mcp/ops?since=0'],
  ]) {
    const r = await callHandler(handler, method, path, method === 'GET' ? undefined : {})
    assert.equal(r.status, 501, `${method} ${path} 应 501`)
    assert.equal(r.payload.error, MCP_INSTALL_GUIDANCE)
  }
})

/* ---------------- handler：就绪 = 双向闭环 ---------------- */

test('createMcpHandler（已装 SDK）：拓扑镜像 + Agent 操作批 + 画布拉取闭环', async () => {
  const handler = createMcpHandler({ ready: true, store: memStore() })

  // 画布端推送拓扑镜像
  const push = await callHandler(handler, 'PUT', '/api/mcp/canvas', {
    nodes: [{ id: 'n1', kind: 'brief' }],
    edges: [],
  })
  assert.equal(push.status, 200)
  assert.equal(push.payload.version, 1)

  // Agent 读取拓扑
  const read = await callHandler(handler, 'GET', '/api/mcp/canvas')
  assert.equal(read.payload.version, 1)
  assert.equal(read.payload.topology.nodes.length, 1)

  // Agent 提交操作批（建节点 + 连线）
  const submit = await callHandler(handler, 'POST', '/api/mcp/ops', {
    ops: [
      { type: 'create-node', id: 'a1', kind: 'script', x: 100, y: 100 },
      { type: 'create-node', id: 'a2', kind: 'storyboard', x: 400, y: 100 },
      { type: 'create-edge', id: 'ae1', from: 'a1', to: 'a2' },
    ],
  })
  assert.equal(submit.status, 200)
  assert.equal(submit.payload.applied, 3)
  assert.equal(submit.payload.seq, 1)

  // 画布端拉取
  const pull = await callHandler(handler, 'GET', '/api/mcp/ops?since=0')
  assert.equal(pull.payload.seq, 1)
  assert.equal(pull.payload.batches.length, 1)
  assert.equal(pull.payload.batches[0].ops.length, 3)

  // 拉取后拓扑已含 Agent 新建内容（供再次读取）
  const after = await callHandler(handler, 'GET', '/api/mcp/canvas')
  assert.equal(after.payload.topology.nodes.length, 3)

  // since 已消费 → 无新批次
  const none = await callHandler(handler, 'GET', '/api/mcp/ops?since=1')
  assert.equal(none.payload.batches.length, 0)

  // 非法操作批 400 且不改拓扑
  const badOps = await callHandler(handler, 'POST', '/api/mcp/ops', {
    ops: [{ type: 'create-edge', id: 'x', from: 'nope', to: 'nope2' }],
  })
  assert.equal(badOps.status, 400)
  assert.match(badOps.payload.error, /不存在/)

  // 未知路由 404；canvas 非 GET/PUT 405
  assert.equal((await callHandler(handler, 'GET', '/api/mcp/other')).status, 404)
  assert.equal((await callHandler(handler, 'DELETE', '/api/mcp/canvas')).status, 405)
})

/* ---------------- 集成：startServer ---------------- */

test('startServer：默认未装 SDK → healthz mcp:off + /api/mcp/status 可读 + 桥接 501', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({ port: 0, dist: dir, env: {} })
    const base = `http://127.0.0.1:${port}`
    try {
      const health = await (await fetch(`${base}/healthz`)).json()
      assert.equal(health.mcp, 'off')
      assert.equal(health.connectors, 'interface')

      const status = await (await fetch(`${base}/api/mcp/status`)).json()
      assert.equal(status.ready, false)
      assert.ok(String(status.guidance).includes('@modelcontextprotocol/sdk'))

      const canvas = await fetch(`${base}/api/mcp/canvas`)
      assert.equal(canvas.status, 501)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('startServer：mcpSdkInstalled=true → healthz mcp:ready + connectors:ready + 反向驱动可用', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({ port: 0, dist: dir, env: {}, mcpSdkInstalled: true })
    const base = `http://127.0.0.1:${port}`
    try {
      const health = await (await fetch(`${base}/healthz`)).json()
      assert.equal(health.mcp, 'ready')
      assert.equal(health.connectors, 'ready')

      const put = await fetch(`${base}/api/mcp/canvas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: [], edges: [] }),
      })
      assert.equal(put.status, 200)

      const ops = await fetch(`${base}/api/mcp/ops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops: [{ type: 'create-node', id: 'z1', kind: 'brief' }] }),
      })
      assert.equal(ops.status, 200)
      assert.equal((await ops.json()).applied, 1)

      const pull = await (await fetch(`${base}/api/mcp/ops?since=0`)).json()
      assert.equal(pull.batches.length, 1)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
