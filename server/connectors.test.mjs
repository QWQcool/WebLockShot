import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from './weblockshot-server.mjs'
import {
  CONNECTOR_CATALOG,
  CONNECTOR_IDS,
  CONNECTOR_INTERFACE_DETAIL,
  createConnectorsHandler,
} from './connectors.mjs'

function tmpDist() {
  return mkdtempSync(join(tmpdir(), 'wls-connectors-test-'))
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

/** 轻量 res stub（对齐 memory.test.mjs 口径） */
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

/* ---------------- 目录：与前端 RECOMMENDED_CONNECTORS 同 7 个 id ---------------- */

test('CONNECTOR_CATALOG：7 卡片位 + id 集合固定（与前端一致）', () => {
  assert.equal(CONNECTOR_CATALOG.length, 7)
  assert.deepEqual(CONNECTOR_IDS, [
    'notion',
    'tencent-docs',
    'airtable',
    'linear',
    'github',
    'resend',
    'brevo',
  ])
  for (const c of CONNECTOR_CATALOG) {
    assert.ok(c.name.length > 0)
    assert.ok(c.category.length > 0)
    assert.ok(c.description.length > 0)
  }
})

/* ---------------- GET /api/connectors ---------------- */

test('GET /api/connectors：interface 模式返回目录 + 未接入诚实标注（零伪造已连接）', async () => {
  const handler = createConnectorsHandler({ mode: 'interface' })
  const res = await callHandler(handler, 'GET', '/api/connectors')
  assert.equal(res.status, 200)
  assert.equal(res.payload.mode, 'interface')
  assert.equal(res.payload.connectors.length, 7)
  for (const c of res.payload.connectors) {
    assert.equal(c.status, 'interface')
    assert.equal(c.configured, false, '绝不伪造已配置')
    assert.equal(c.detail, CONNECTOR_INTERFACE_DETAIL)
  }
})

test('GET /api/connectors：ready 模式状态切 ready 且不带未接入 detail（D8 预留）', async () => {
  const handler = createConnectorsHandler({ mode: 'ready' })
  const res = await callHandler(handler, 'GET', '/api/connectors')
  assert.equal(res.status, 200)
  assert.equal(res.payload.mode, 'ready')
  for (const c of res.payload.connectors) {
    assert.equal(c.status, 'ready')
    assert.equal(c.detail, undefined)
  }
})

test('GET /api/connectors：非 GET 405', async () => {
  const handler = createConnectorsHandler()
  const res = await callHandler(handler, 'POST', '/api/connectors')
  assert.equal(res.status, 405)
})

/* ---------------- auth / run 占位路由 ---------------- */

test('POST /api/connectors/:id/auth：未接入如实 501（中文说明含连接器名）', async () => {
  const handler = createConnectorsHandler()
  const res = await callHandler(handler, 'POST', '/api/connectors/notion/auth')
  assert.equal(res.status, 501)
  assert.equal(res.payload.ok, false)
  assert.equal(res.payload.connectorId, 'notion')
  assert.equal(res.payload.action, 'auth')
  assert.ok(res.payload.error.includes('Notion'))
  assert.ok(res.payload.error.includes('未接入'))
})

test('POST /api/connectors/:id/run：未接入如实 501', async () => {
  const handler = createConnectorsHandler()
  const res = await callHandler(handler, 'POST', '/api/connectors/github/run')
  assert.equal(res.status, 501)
  assert.equal(res.payload.action, 'run')
  assert.ok(res.payload.error.includes('GitHub'))
})

test('POST /api/connectors/:id/auth：未知 id 404；GET 占位路由 405', async () => {
  const handler = createConnectorsHandler()
  const notFound = await callHandler(handler, 'POST', '/api/connectors/unknown/auth')
  assert.equal(notFound.status, 404)
  assert.ok(notFound.payload.error.includes('unknown'))

  const wrongMethod = await callHandler(handler, 'GET', '/api/connectors/notion/run')
  assert.equal(wrongMethod.status, 405)
})

test('createConnectorsHandler：未知路由 404', async () => {
  const handler = createConnectorsHandler()
  const res = await callHandler(handler, 'GET', '/api/connectors/notion/other')
  assert.equal(res.status, 404)
})

/* ---------------- 集成：startServer 挂载 + healthz 能力位 ---------------- */

test('startServer：GET /api/connectors 挂载 + healthz connectors:interface', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({ port: 0, dist: dir, env: {} })
    const base = `http://127.0.0.1:${port}`
    try {
      const health = await (await fetch(`${base}/healthz`)).json()
      assert.equal(health.connectors, 'interface')

      const list = await (await fetch(`${base}/api/connectors`)).json()
      assert.equal(list.mode, 'interface')
      assert.equal(list.connectors.length, 7)
      assert.equal(list.connectors[0].status, 'interface')

      // 占位路由经真实 HTTP 也如实 501
      const auth = await fetch(`${base}/api/connectors/linear/auth`, { method: 'POST' })
      assert.equal(auth.status, 501)
      assert.equal((await auth.json()).action, 'auth')
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ---------------- D8 正向标杆连接器：GitHub ---------------- */

test('GitHub run：未配置 PAT → 401 诚实说明（凭据只存服务端）', async () => {
  const handler = createConnectorsHandler({ mode: 'ready' })
  const res = await callHandler(handler, 'POST', '/api/connectors/github/run', { op: 'list-issues', repo: 'a/b' })
  assert.equal(res.status, 401)
  assert.ok(res.payload.error.includes('WLS_GITHUB_TOKEN'))
})

test('GitHub run：配置 PAT + 注入 fetch → 200 返回 Issue 列表（正向取需求闭环）', async () => {
  let calledUrl = ''
  const fakeFetch = async (url) => {
    calledUrl = String(url)
    return {
      ok: true,
      status: 200,
      json: async () => [
        { number: 7, title: '补齐画布导出', html_url: 'https://github.com/a/b/issues/7' },
        { number: 8, title: '优化 3D 台', html_url: 'https://github.com/a/b/issues/8' },
      ],
    }
  }
  const handler = createConnectorsHandler({ mode: 'ready', githubToken: 'ghp_test', fetchImpl: fakeFetch })
  const res = await callHandler(handler, 'POST', '/api/connectors/github/run', { op: 'list-issues', repo: 'a/b' })
  assert.equal(res.status, 200)
  assert.equal(res.payload.items.length, 2)
  assert.equal(res.payload.items[0].number, 7)
  assert.match(calledUrl, /api\.github\.com\/repos\/a\/b\/issues/)

  // 非法 repo
  const badRepo = await callHandler(handler, 'POST', '/api/connectors/github/run', { repo: 'not-a-repo' })
  assert.equal(badRepo.status, 400)

  // 不支持的操作
  const badOp = await callHandler(handler, 'POST', '/api/connectors/github/run', { op: 'delete-repo', repo: 'a/b' })
  assert.equal(badOp.status, 400)
})

test('GitHub run：上游非 2xx → 502 如实说明（不伪造结果）', async () => {
  const fakeFetch = async () => ({ ok: false, status: 403, json: async () => ({}) })
  const handler = createConnectorsHandler({ mode: 'ready', githubToken: 'ghp_x', fetchImpl: fakeFetch })
  const res = await callHandler(handler, 'POST', '/api/connectors/github/run', { repo: 'a/b' })
  assert.equal(res.status, 502)
  assert.match(res.payload.error, /403/)
})

test('GitHub run：interface 态（未装 SDK）→ 仍为占位 501（能力位门控）', async () => {
  const handler = createConnectorsHandler({ mode: 'interface', githubToken: 'ghp_test' })
  const res = await callHandler(handler, 'POST', '/api/connectors/github/run', { repo: 'a/b' })
  assert.equal(res.status, 501)
})

test('GET /api/connectors：ready 态下 GitHub 卡如实标注已配置凭据', async () => {
  const handler = createConnectorsHandler({ mode: 'ready', githubToken: 'ghp_test' })
  const res = await callHandler(handler, 'GET', '/api/connectors')
  const github = res.payload.connectors.find((c) => c.id === 'github')
  const notion = res.payload.connectors.find((c) => c.id === 'notion')
  assert.equal(github.configured, true)
  assert.equal(notion.configured, false)
})

test('startServer：connectorsMode=ready 注入（D8 能力位切换）', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({ port: 0, dist: dir, env: {}, connectorsMode: 'ready' })
    const base = `http://127.0.0.1:${port}`
    try {
      const health = await (await fetch(`${base}/healthz`)).json()
      assert.equal(health.connectors, 'ready')
      const list = await (await fetch(`${base}/api/connectors`)).json()
      assert.equal(list.mode, 'ready')
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
