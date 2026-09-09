import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from './weblockshot-server.mjs'
import { validateMemoryRecord, createMemoryHandler, MEMORY_RECORDS_KEY } from './memory.mjs'

function tmpDist() {
  return mkdtempSync(join(tmpdir(), 'wls-memory-test-'))
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

/** 内存 storage stub（对齐 storage.mjs kv 接口；mode 可模拟 sqlite/memory） */
function memoryStorage(mode = 'sqlite') {
  const map = new Map()
  return {
    mode,
    get: (id) => map.get(id) ?? null,
    set: (id, data) => map.set(id, data),
    delete: (id) => map.delete(id),
    close() {},
  }
}

/** 合法记录样例（FeedbackRecordSchema 形状） */
function validRecord(overrides = {}) {
  return {
    videoTitle: '冰博克鲜奶茶带货实测',
    templateId: 't1_pain_opening',
    hookIndex: 0,
    view3sRate: 0.42,
    completionRate: 0.31,
    category: '饮品',
    ...overrides,
  }
}

/* ---------------- 协议层：validateMemoryRecord ---------------- */

test('validateMemoryRecord：合法记录 / 最小结构防线全覆盖', () => {
  const ok = validateMemoryRecord(validRecord())
  assert.equal(ok.ok, true)
  assert.equal(ok.record.templateId, 't1_pain_opening')
  assert.equal(ok.record.category, '饮品')

  // 非对象 / 数组
  assert.equal(validateMemoryRecord(null).ok, false)
  assert.equal(validateMemoryRecord('str').ok, false)
  assert.equal(validateMemoryRecord([1]).ok, false)

  // 必填缺失 / 空白 / 类型
  assert.ok(!validateMemoryRecord(validRecord({ videoTitle: '  ' })).ok)
  assert.ok(!validateMemoryRecord(validRecord({ videoTitle: 123 })).ok)
  assert.ok(!validateMemoryRecord(validRecord({ templateId: '' })).ok)
  assert.ok(!validateMemoryRecord(validRecord({ hookIndex: 6 })).ok)
  assert.ok(!validateMemoryRecord(validRecord({ hookIndex: -1 })).ok)
  assert.ok(!validateMemoryRecord(validRecord({ hookIndex: 1.5 })).ok)

  // 比率越界 / 类型
  assert.ok(!validateMemoryRecord(validRecord({ view3sRate: 1.2 })).ok)
  assert.ok(!validateMemoryRecord(validRecord({ view3sRate: -0.1 })).ok)
  assert.ok(!validateMemoryRecord(validRecord({ view3sRate: '0.5' })).ok)
  assert.ok(!validateMemoryRecord(validRecord({ completionRate: 2 })).ok)

  // 可选字段类型防线
  assert.ok(!validateMemoryRecord(validRecord({ conversions: -1 })).ok)
  assert.ok(!validateMemoryRecord(validRecord({ conversions: 3.5 })).ok)

  // 边界值通过：hookIndex 0/5、rate 0/1、conversions 0
  assert.equal(validateMemoryRecord(validRecord({ hookIndex: 0, view3sRate: 0, completionRate: 1, conversions: 0 })).ok, true)
  assert.equal(validateMemoryRecord(validRecord({ hookIndex: 5 })).ok, true)
})

/* ---------------- 协议层：createMemoryHandler（存储注入） ---------------- */

test('createMemoryHandler：POST 增 / GET 查 / DELETE 清（sqlite 存储注入往返）', async () => {
  const storage = memoryStorage('sqlite')
  const handler = createMemoryHandler({ enabled: true, storage })

  const call = (method, body) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = { method, on(ev, cb) { if (ev === 'data') chunks.forEach((c) => cb(c)); if (ev === 'end') cb() }, ...{} }
    const res = { headers: null, status: null, payload: null, _ended: false, writeHead(s) { this.status = s }, end(txt) { this._ended = true; this.payload = txt ? JSON.parse(txt) : null } }
    return { req, res, run: () => handler(req, res, '/api/memory/records') }
  }

  // GET 初始为空
  let c = call('GET')
  await c.run()
  assert.equal(c.res.status, 200)
  assert.deepEqual(c.res.payload.records, [])

  // POST 单条：补 id/createdAt
  c = call('POST', validRecord())
  await c.run()
  assert.equal(c.res.status, 200)
  assert.equal(c.res.payload.ok, true)
  assert.ok(c.res.payload.id.startsWith('fb_'))
  assert.equal(c.res.payload.total, 1)

  // 再录一条不同 hook
  c = call('POST', validRecord({ hookIndex: 1, view3sRate: 0.1, videoTitle: '第二条' }))
  await c.run()
  assert.equal(c.res.payload.total, 2)

  // GET 全量回读：字段与服务端补齐字段都在
  c = call('GET')
  await c.run()
  assert.equal(c.res.payload.records.length, 2)
  assert.ok(c.res.payload.records.every((r) => typeof r.id === 'string' && typeof r.createdAt === 'number'))
  assert.equal(c.res.payload.records[0].view3sRate, 0.42)

  // POST 非法记录 400
  c = call('POST', validRecord({ view3sRate: 9 }))
  await c.run()
  assert.equal(c.res.status, 400)
  assert.ok(c.res.payload.error.includes('view3sRate'))

  // DELETE 清空
  c = call('DELETE')
  await c.run()
  assert.equal(c.res.status, 200)
  assert.equal(c.res.payload.cleared, 2)

  // 清空后 GET 为空
  c = call('GET')
  await c.run()
  assert.deepEqual(c.res.payload.records, [])

  // 非 GET/POST/DELETE 405
  c = call('PUT')
  await c.run()
  assert.equal(c.res.status, 405)
})

test('createMemoryHandler：enabled=false 全路由 501（非 sqlite 模式语义）', async () => {
  const handler = createMemoryHandler({ enabled: false, storage: memoryStorage('memory') })
  for (const method of ['GET', 'POST', 'DELETE']) {
    const req = { method, on(ev, cb) { if (ev === 'end') cb() } }
    const res = { status: null, payload: null, writeHead(s) { this.status = s }, end(txt) { this.payload = txt ? JSON.parse(txt) : null } }
    await handler(req, res, '/api/memory/records')
    assert.equal(res.status, 501, `${method} 应 501`)
    assert.ok(res.payload.error.includes('sqlite'))
  }
})

test('createMemoryHandler：未知路由 404', async () => {
  const handler = createMemoryHandler({ enabled: true, storage: memoryStorage('sqlite') })
  const req = { method: 'GET' }
  const res = { status: null, payload: null, writeHead(s) { this.status = s }, end(txt) { this.payload = txt ? JSON.parse(txt) : null } }
  await handler(req, res, '/api/memory/other')
  assert.equal(res.status, 404)
})

/* ---------------- 集成：startServer 挂载 + healthz 能力位 ---------------- */

test('POST /api/memory/records：startServer sqlite 存储模式挂载（增/查/清 + healthz memory:sqlite）', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: { WLS_STORAGE: 'sqlite', WLS_SQLITE_PATH: ':memory:' },
    })
    const base = `http://127.0.0.1:${port}`
    try {
      // healthz 能力位：sqlite → memory: 'sqlite'
      const health = await (await fetch(`${base}/healthz`)).json()
      assert.equal(health.memory, 'sqlite')
      assert.equal(health.storage, 'sqlite')

      // POST 录入
      const post = await fetch(`${base}/api/memory/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validRecord()),
      })
      assert.equal(post.status, 200)
      const postBody = await post.json()
      assert.equal(postBody.ok, true)
      assert.ok(postBody.id.startsWith('fb_'))

      // GET 全量
      const get = await fetch(`${base}/api/memory/records`)
      assert.equal(get.status, 200)
      const getBody = await get.json()
      assert.equal(getBody.records.length, 1)
      assert.equal(getBody.records[0].templateId, 't1_pain_opening')

      // DELETE 清空
      const del = await fetch(`${base}/api/memory/records`, { method: 'DELETE' })
      assert.equal(del.status, 200)
      assert.equal((await del.json()).cleared, 1)

      // 清空后 GET 空
      const after = await (await fetch(`${base}/api/memory/records`)).json()
      assert.deepEqual(after.records, [])
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('非 sqlite 存储模式：/api/memory/records 501 + healthz memory:off', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({ port: 0, dist: dir, env: {} })
    const base = `http://127.0.0.1:${port}`
    try {
      const health = await (await fetch(`${base}/healthz`)).json()
      assert.equal(health.memory, 'off')

      for (const method of ['GET', 'POST', 'DELETE']) {
        const res = await fetch(`${base}/api/memory/records`, {
          method,
          headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
          body: method === 'POST' ? JSON.stringify(validRecord()) : undefined,
        })
        assert.equal(res.status, 501, `${method} 应 501`)
        assert.ok((await res.json()).error.includes('sqlite'))
      }
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
