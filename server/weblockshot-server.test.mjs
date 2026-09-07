import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import http from 'node:http'
import { startServer, parseWlsKeys } from './weblockshot-server.mjs'
import { createStorage } from './storage.mjs'
import { extractZip } from './zip-extract.mjs'

function tmpDist() {
  const dir = mkdtempSync(join(tmpdir(), 'wls-server-test-'))
  return dir
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

/**
 * 构造 deflate(8) 压缩 zip（零依赖，用于 zip bomb 配额测试）。
 * uncompressedSize 由调用方指定（可与真实数据不符，模拟伪造声明）。
 */
function buildDeflateZip(name, raw, declaredUncompressedSize = raw.length) {
  const compressed = deflateRawSync(raw)
  const nameBuf = Buffer.from(name, 'utf8')

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version
  local.writeUInt16LE(0, 6) // flags
  local.writeUInt16LE(8, 8) // method = deflate
  local.writeUInt16LE(0, 10) // time
  local.writeUInt16LE(0, 12) // date
  local.writeUInt32LE(0, 14) // crc（extractZip 不校验）
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(declaredUncompressedSize, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28) // extra len

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4) // version made by
  central.writeUInt16LE(20, 6) // version needed
  central.writeUInt16LE(0, 8) // flags
  central.writeUInt16LE(8, 10) // method = deflate
  central.writeUInt16LE(0, 12) // time
  central.writeUInt16LE(0, 14) // date
  central.writeUInt32LE(0, 16) // crc
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(declaredUncompressedSize, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt16LE(0, 30) // extra len
  central.writeUInt16LE(0, 32) // comment len
  central.writeUInt16LE(0, 34) // disk start
  central.writeUInt16LE(0, 36) // internal attrs
  central.writeUInt32LE(0, 38) // external attrs
  central.writeUInt32LE(0, 42) // local header offset

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8) // entries this disk
  eocd.writeUInt16LE(1, 10) // total entries
  eocd.writeUInt32LE(46 + nameBuf.length, 12) // cd size
  eocd.writeUInt32LE(30 + nameBuf.length + compressed.length, 16) // cd offset

  return Buffer.concat([local, nameBuf, compressed, central, nameBuf, eocd])
}

test('parseWlsKeys：合法 JSON → 密钥表；非法输入 → null（透传）', () => {
  const logger = { warn: () => {} }
  assert.deepEqual(parseWlsKeys('{"kling":"Bearer k1","llm":"sk-abc"}', logger), {
    kling: 'Bearer k1',
    llm: 'sk-abc',
  })
  assert.equal(parseWlsKeys(undefined, logger), null)
  assert.equal(parseWlsKeys('', logger), null)
  assert.equal(parseWlsKeys('not-json', logger), null)
  assert.equal(parseWlsKeys('["a"]', logger), null)
  assert.deepEqual(parseWlsKeys('{"kling":"  ","jimeng":"Bearer j"}', logger), { jimeng: 'Bearer j' })
})

test('GET /healthz：返回版本/存储模式/uptime，默认 memory + passthrough', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({ port: 0, dist: dir, env: {} })
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`)
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.ok, true)
      assert.equal(typeof body.version, 'string')
      assert.ok(body.version.length > 0)
      assert.equal(body.storage, 'memory')
      assert.ok(body.uptimeSec >= 0)
      assert.equal(body.keyMode, 'passthrough')
      assert.equal(body.llmProxy, 'off')
      assert.equal(body.sentry, 'off')
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('会话 API（预留）：PUT/GET/DELETE /api/sessions/:id 全流程', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({ port: 0, dist: dir, env: {} })
    const base = `http://127.0.0.1:${port}`
    try {
      // 未保存 → 404
      const miss = await fetch(`${base}/api/sessions/abc`)
      assert.equal(miss.status, 404)

      // 保存
      const session = { version: 2, id: 'abc', activeStep: 0, updatedAt: 1 }
      const put = await fetch(`${base}/api/sessions/abc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: session }),
      })
      assert.equal(put.status, 200)

      // 读取
      const get = await fetch(`${base}/api/sessions/abc`)
      assert.equal(get.status, 200)
      const body = await get.json()
      assert.deepEqual(body.data, session)

      // 覆盖更新
      await fetch(`${base}/api/sessions/abc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...session, activeStep: 5 } }),
      })
      const updated = await (await fetch(`${base}/api/sessions/abc`)).json()
      assert.equal(updated.data.activeStep, 5)

      // 删除 → 404
      const del = await fetch(`${base}/api/sessions/abc`, { method: 'DELETE' })
      assert.equal(del.status, 200)
      assert.equal((await fetch(`${base}/api/sessions/abc`)).status, 404)

      // 非法 body → 400
      const bad = await fetch(`${base}/api/sessions/bad`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      })
      assert.equal(bad.status, 400)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WLS_STORAGE=sqlite：存储模式生效且 healthz 上报 sqlite', async () => {
  const dir = tmpDist()
  try {
    const storage = await createStorage({ mode: 'sqlite', sqlitePath: ':memory:' })
    assert.equal(storage.mode.startsWith('sqlite'), true)
    storage.set('k', '{"v":1}')
    assert.equal(storage.get('k'), '{"v":1}')

    const { server, port } = await startServer({ port: 0, dist: dir, env: {}, storage })
    try {
      const body = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()
      assert.equal(body.storage.startsWith('sqlite'), true)

      // 会话 API 落 sqlite
      await fetch(`http://127.0.0.1:${port}/api/sessions/s1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { version: 2, id: 's1' } }),
      })
      const roundtrip = await (await fetch(`http://127.0.0.1:${port}/api/sessions/s1`)).json()
      assert.equal(roundtrip.data.id, 's1')
    } finally {
      await close(server)
      storage.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('/api/llm：未配置 WLS_LLM_TARGET → 501（预留接口明确语义）', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({ port: 0, dist: dir, env: {} })
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/llm/v1/chat/completions`, { method: 'POST' })
      assert.equal(res.status, 501)
      const body = await res.json()
      assert.ok(body.error.includes('WLS_LLM_TARGET'))
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WLS_KEYS + WLS_LLM_TARGET：反代注入密钥头；未设置 keys 时透传', async () => {
  const dir = tmpDist()
  // 本地 echo 目标：返回收到的 Authorization
  const echo = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ auth: req.headers.authorization || null }))
  })
  await new Promise((r) => echo.listen(0, r))
  const echoPort = echo.address().port

  try {
    // 1. 注入模式
    {
      const { server, port } = await startServer({
        port: 0,
        dist: dir,
        env: {},
        llmTarget: `http://127.0.0.1:${echoPort}`,
        keys: { llm: 'Bearer server-real-key' },
      })
      try {
        const body = await (
          await fetch(`http://127.0.0.1:${port}/api/llm/v1/models`, {
            headers: { Authorization: 'Bearer client-forged' },
          })
        ).json()
        assert.equal(body.auth, 'Bearer server-real-key', '注入密钥应覆盖客户端伪造头')
      } finally {
        await close(server)
      }
    }

    // 2. 透传模式（未设置 WLS_KEYS）
    {
      const { server, port } = await startServer({
        port: 0,
        dist: dir,
        env: {},
        llmTarget: `http://127.0.0.1:${echoPort}`,
      })
      try {
        const body = await (
          await fetch(`http://127.0.0.1:${port}/api/llm/v1/models`, {
            headers: { Authorization: 'Bearer client-key' },
          })
        ).json()
        assert.equal(body.auth, 'Bearer client-key', '透传模式应原样转发客户端头')
      } finally {
        await close(server)
      }
    }
  } finally {
    await new Promise((r) => echo.close(r))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('畸形 URL：GET /%zz 与 GET /api/sessions/%zz 不再崩溃，server 仍存活', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({ port: 0, dist: dir, env: {} })
    const base = `http://127.0.0.1:${port}`
    try {
      // 静态路径：畸形转义 → 不抛 URIError（404 或 SPA 回退均可，只要不崩）
      const badStatic = await fetch(`${base}/%zz`)
      assert.ok(badStatic.status < 500, `畸形静态路径应正常响应，实际 ${badStatic.status}`)

      // 会话 API：畸形转义 id → 明确 400
      const badSession = await fetch(`${base}/api/sessions/%zz`)
      assert.equal(badSession.status, 400)
      const body = await badSession.json()
      assert.ok(body.error.includes('无效'))

      // 关键：server 进程仍存活，继续响应正常请求
      const health = await fetch(`${base}/healthz`)
      assert.equal(health.status, 200)

      // 会话 API 正常路径不受影响
      const put = await fetch(`${base}/api/sessions/ok`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { version: 2, id: 'ok' } }),
      })
      assert.equal(put.status, 200)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WLS_AUTH_TOKEN：设置后 /api/* 无头 401 / 对头 200 系；未设置行为不变', async () => {
  const dir = tmpDist()
  try {
    // 1. 设置 token：鉴权生效
    {
      const { server, port } = await startServer({
        port: 0,
        dist: dir,
        env: { WLS_AUTH_TOKEN: 'secret-token-123' },
      })
      const base = `http://127.0.0.1:${port}`
      try {
        // 无头 → 401
        const noHeader = await fetch(`${base}/api/sessions/x`)
        assert.equal(noHeader.status, 401)

        // 错误 token → 401
        const wrongToken = await fetch(`${base}/api/sessions/x`, {
          headers: { 'x-wls-token': 'wrong' },
        })
        assert.equal(wrongToken.status, 401)

        // x-wls-token 对头 → 通过鉴权（404 = 会话不存在，而非 401）
        const okHeader = await fetch(`${base}/api/sessions/x`, {
          headers: { 'x-wls-token': 'secret-token-123' },
        })
        assert.equal(okHeader.status, 404)

        // Authorization Bearer 对头 → 通过鉴权
        const okBearer = await fetch(`${base}/api/sessions/x`, {
          headers: { Authorization: 'Bearer secret-token-123' },
        })
        assert.equal(okBearer.status, 404)

        // healthz 保持开放（非 /api/*，便于存活探测）
        const health = await fetch(`${base}/healthz`)
        assert.equal(health.status, 200)
        assert.equal((await health.json()).authMode, 'token')

        // 对头正常读写
        const put = await fetch(`${base}/api/sessions/ok`, {
          method: 'PUT',
          headers: { 'x-wls-token': 'secret-token-123', 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { version: 2, id: 'ok' } }),
        })
        assert.equal(put.status, 200)
      } finally {
        await close(server)
      }
    }

    // 2. 未设置 token：行为与现状完全一致（不鉴权）
    {
      const { server, port } = await startServer({ port: 0, dist: dir, env: {} })
      const base = `http://127.0.0.1:${port}`
      try {
        const noHeader = await fetch(`${base}/api/sessions/x`)
        assert.equal(noHeader.status, 404, '未配置 token 时无头请求应照常通过')
        assert.equal((await (await fetch(`${base}/healthz`)).json()).authMode, 'off')
      } finally {
        await close(server)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('默认监听地址：WLS_HOST 未设置时绑定 127.0.0.1；设置后可覆盖', async () => {
  const dir = tmpDist()
  try {
    const { server, port, args } = await startServer({ port: 0, dist: dir, env: {} })
    try {
      assert.equal(args.host, '127.0.0.1')
      assert.equal(server.address().address, '127.0.0.1')
    } finally {
      await close(server)
    }

    const { server: server2, args: args2 } = await startServer({
      port: 0,
      dist: dir,
      env: { WLS_HOST: '0.0.0.0' },
    })
    try {
      assert.equal(args2.host, '0.0.0.0')
      assert.equal(server2.address().address, '0.0.0.0')
    } finally {
      await close(server2)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extractZip：高压缩比 zip bomb 触发配额拒绝（声明超限在 inflate 前中止）', () => {
  // 8MB 全零 → deflate 后约 8KB（高压缩比），声明解压后 8MB
  const bombRaw = Buffer.alloc(8 * 1024 * 1024, 0)
  const bombZip = buildDeflateZip('bomb.bin', bombRaw)
  assert.ok(bombZip.length < 100 * 1024, `zip 应远小于原数据（实际 ${bombZip.length} 字节）`)

  // 配额 1MB < 声明 8MB → 解压前直接拒绝，不进入 inflate
  assert.throws(
    () => extractZip(bombZip, { maxBytes: 1024 * 1024 }),
    (err) => {
      assert.equal(err.code, 'WLS_UNZIP_QUOTA')
      assert.ok(err.message.includes('配额'))
      return true
    }
  )

  // 配额充足（16MB）→ 正常解压还原
  const ok = extractZip(bombZip, { maxBytes: 16 * 1024 * 1024 })
  assert.equal(ok.length, 1)
  assert.equal(ok[0].data.length, 8 * 1024 * 1024)
})

test('extractZip：伪造小声明但实际解压超限 → maxOutputLength 兜底中止', () => {
  // 实际解压 8MB，但头部声明 uncompressedSize=100（伪造）
  const raw = Buffer.alloc(8 * 1024 * 1024, 0)
  const forged = buildDeflateZip('forged.bin', raw, 100)

  // 声明 100 < 配额 1KB 通过前置检查；实际 inflate 输出 8MB 超限 → zlib 中止
  assert.throws(() => extractZip(forged, { maxBytes: 1024 }), /too large|too big|ERR_BUFFER_TOO_LARGE/i)
})

test('POST /api/jianying/draft-zip：zip bomb 触发 413，server 不 OOM 不崩溃', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: { WLS_MAX_UNZIP_MB: '1' },
    })
    const base = `http://127.0.0.1:${port}`
    try {
      const bombZip = buildDeflateZip('bomb.bin', Buffer.alloc(8 * 1024 * 1024, 0))
      const res = await fetch(`${base}/api/jianying/draft-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: bombZip,
      })
      assert.equal(res.status, 413)
      const body = await res.json()
      assert.ok(body.error.includes('zip 解压失败'))

      // 关键：server 仍存活
      assert.equal((await fetch(`${base}/healthz`)).status, 200)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
