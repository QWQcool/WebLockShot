import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { startServer, parseWlsKeys } from './weblockshot-server.mjs'
import { createStorage } from './storage.mjs'
import { extractZip } from './zip-extract.mjs'

/** 测试根目录（供 CLI 子进程 cwd 使用） */
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

/**
 * fake ffmpeg 子进程（与 render.test.mjs 同款）：模拟 exit 0 并写出伪 mp4。
 */
function fakeRenderFfmpegChild() {
  const spawnImpl = (cmd, args) => {
    const outPath = args[args.length - 1]
    return {
      stderr: { on() {} },
      kill() {},
      on(event, cb) {
        if (event === 'close') {
          setTimeout(() => {
            writeFileSync(outPath, Buffer.from('fake-mp4-bytes'))
            cb(0)
          }, 30)
        }
      },
    }
  }
  return { spawnImpl }
}

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

// ---------------- R1：CLI 启动崩溃（ttsEnabled ReferenceError） ----------------

test('R1 CLI 路径冒烟：node server/weblockshot-server.mjs 进程不退出、healthz 200、无 ReferenceError', async () => {
  // 随机高位端口，避免与其它测试冲突
  const port = 20000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.execPath, ['server/weblockshot-server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), WLS_STORAGE: 'memory', WLS_LOG_LEVEL: 'info' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => (stdout += String(d)))
  child.stderr.on('data', (d) => (stderr += String(d)))

  let exited = null
  child.on('exit', (code) => (exited = code))

  try {
    // 轮询 /healthz 最多 3 秒
    let healthy = false
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      if (exited !== null) break
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) })
        if (res.status === 200) {
          const body = await res.json()
          assert.equal(body.ok, true)
          healthy = true
          break
        }
      } catch {
        // 尚未监听，继续等待
      }
      await new Promise((r) => setTimeout(r, 100))
    }

    assert.equal(exited, null, `CLI 进程不应退出（exit code: ${exited}）——此前 ttsEnabled ReferenceError 会导致 exit(1)。stderr: ${stderr.slice(0, 400)}`)
    assert.equal(healthy, true, '3 秒内 /healthz 应可达')
    assert.ok(!stderr.includes('ReferenceError'), `stderr 不应包含 ReferenceError: ${stderr.slice(0, 400)}`)
    assert.ok(!stdout.includes('ReferenceError'), 'stdout 不应包含 ReferenceError')
    // 启动日志应正常打印（包含 tts 能力位 → 证明日志回调完整执行）
    assert.ok(stdout.includes('已启动'), `应有启动日志，实际 stdout: ${stdout.slice(0, 400)}`)
  } finally {
    child.kill()
    await new Promise((r) => setTimeout(r, 100))
  }
})

// ---------------- R2：超限 body 不再挂起（413 直接回应，互斥锁不被饿死） ----------------

test('R2 POST /api/render：超限 body → 413 JSON 响应（非连接重置）；随后正常任务成功（锁未被饿死）', async () => {
  const dir = tmpDist()
  try {
    const ttsDir = join(dir, 'tts-out')
    mkdirSync(ttsDir, { recursive: true })
    writeFileSync(join(ttsDir, 'v.mp4'), Buffer.from('v'))
    const fake = fakeRenderFfmpegChild()
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: {},
      ffmpegPath: '/fake/ffmpeg',
      renderDir: join(dir, 'render-out'),
      ttsDir,
      renderSpawnImpl: fake.spawnImpl,
    })
    const base = `http://127.0.0.1:${port}`
    try {
      // 超限 body（> 1MB）：必须得到 413 JSON 响应而非 ECONNRESET / 永挂
      // duplex:'half'：服务端提前回写 413 后停止发送请求体，避免「客户端仍在写 → 连接被重置」
      // 的竞态把断言打成 ECONNRESET（实测全量并发跑时约 1/3 概率抖动）
      const big = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: '/files/tts/v.mp4', pad: 'x'.repeat(2 * 1024 * 1024) }),
        duplex: 'half',
      })
      assert.equal(big.status, 413)
      assert.ok((await big.json()).error.includes('上限'))

      // 关键：互斥锁未被饿死 —— 随后正常 render 请求应成功（200），而非 429
      const ok = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: '/files/tts/v.mp4' }),
      })
      assert.equal(ok.status, 200, `正常 render 应成功（锁未被饿死），实际 ${ok.status}`)

      assert.equal((await fetch(`${base}/healthz`)).status, 200)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('R2 PUT /api/sessions/:id：超限 body → 413（readBody 同族修复）', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({ port: 0, dist: dir, env: {} })
    const base = `http://127.0.0.1:${port}`
    try {
      const res = await fetch(`${base}/api/sessions/big`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { blob: 'x'.repeat(9 * 1024 * 1024) } }),
        // 同 R2 render 用例：9MB 请求体 + 服务端提前 413 → 必须半关闭发送，否则偶发 ECONNRESET
        duplex: 'half',
      })
      assert.equal(res.status, 413)
      // 413 由 readBody 直接回写，错误文案为通用「请求体超过上限」
      assert.ok((await res.json()).error.includes('上限'))

      // server 存活 + 正常写入不受影响
      const put = await fetch(`${base}/api/sessions/ok`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { version: 2 } }),
      })
      assert.equal(put.status, 200)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------- R3：反代上游中途断流 → 进程不死 ----------------

test('R3 反代上游中途断流：客户端得到终止连接而非进程崩溃，server 存活', async () => {
  const dir = tmpDist()
  // 上游：先写 headers + 部分响应体，随后暴力销毁 socket（模拟中途断流）
  const flaky = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '1000' })
    res.write('partial')
    setTimeout(() => {
      req.socket.destroy()
    }, 50)
  })
  await new Promise((r) => flaky.listen(0, '127.0.0.1', r))
  const flakyPort = flaky.address().port

  try {
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: {},
      llmTarget: `http://127.0.0.1:${flakyPort}`,
    })
    const base = `http://127.0.0.1:${port}`
    try {
      // 发起代理请求：上游中途 destroy —— 旧实现在 proxyRes error 未监听 + 错误回调
      // writeHead 抛 ERR_HTTP_HEADERS_SENT 时会崩溃全进程
      let clientErr = null
      let gotHeaders = false
      await new Promise((resolveReq) => {
        const req = http.get(`${base}/api/llm/v1/models`, (res) => {
          gotHeaders = true
          res.on('data', () => {})
          res.on('end', resolveReq)
          res.on('error', () => resolveReq())
        })
        req.on('error', (err) => {
          clientErr = err
          resolveReq()
        })
      })
      assert.ok(gotHeaders || clientErr, '客户端应收到响应头或连接终止')

      // 关键断言：server 进程仍存活（若崩溃，node:test 进程会随之退出导致本测试失败）
      const health = await fetch(`${base}/healthz`)
      assert.equal(health.status, 200)
      const ok = await fetch(`${base}/api/sessions/alive`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { v: 1 } }),
      })
      assert.equal(ok.status, 200)
    } finally {
      await close(server)
    }
  } finally {
    await new Promise((r) => flaky.close(r))
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------- O5：反代剥离敏感头 + 上游超时 504 ----------------

test('O5 反代剥离 x-wls-token/cookie；Authorization 透传；上游超时 → 504', async () => {
  const dir = tmpDist()
  // echo 上游：返回实际收到的敏感头
  const echo = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        wlsToken: req.headers['x-wls-token'] ?? null,
        cookie: req.headers.cookie ?? null,
        authorization: req.headers.authorization ?? null,
      })
    )
  })
  await new Promise((r) => echo.listen(0, '127.0.0.1', r))
  const echoPort = echo.address().port

  // 永挂上游：收到请求不响应（配合 0.2s 超时 → 504）
  const hanging = http.createServer(() => {})
  await new Promise((r) => hanging.listen(0, '127.0.0.1', r))
  const hangingPort = hanging.address().port

  try {
    // 1. 头剥离断言（echo 上游）
    {
      const { server, port } = await startServer({
        port: 0,
        dist: dir,
        env: { WLS_AUTH_TOKEN: 'secret-tok' },
        llmTarget: `http://127.0.0.1:${echoPort}`,
      })
      const base = `http://127.0.0.1:${port}`
      try {
        // 携带 token 通过鉴权；上游不应收到 x-wls-token 与 cookie；Authorization Bearer 透传保留
        const body = await (
          await fetch(`${base}/api/llm/v1/models`, {
            headers: {
              'x-wls-token': 'secret-tok',
              cookie: 'session=should-not-leak',
              authorization: 'Bearer user-own-key',
            },
          })
        ).json()
        assert.equal(body.wlsToken, null, 'x-wls-token 不应转发给上游')
        assert.equal(body.cookie, null, 'cookie 不应转发给上游')
        assert.equal(body.authorization, 'Bearer user-own-key', '用户自己的 Authorization 应保留透传')
      } finally {
        await close(server)
      }
    }

    // 2. 上游挂起 → 0.2s 内 504（独立实例，llmTarget 指向永挂上游）
    {
      const { server, port } = await startServer({
        port: 0,
        dist: dir,
        env: { WLS_AUTH_TOKEN: 'secret-tok' },
        llmTarget: `http://127.0.0.1:${hangingPort}`,
        proxyTimeoutSec: 0.2,
      })
      const base = `http://127.0.0.1:${port}`
      try {
        const t0 = Date.now()
        const res2 = await fetch(`${base}/api/llm/hang`, {
          headers: { 'x-wls-token': 'secret-tok' },
          signal: AbortSignal.timeout(10000),
        })
        const elapsed = Date.now() - t0
        assert.equal(res2.status, 504)
        assert.match((await res2.json()).error, /超时/)
        assert.ok(elapsed < 5000, `超时应约 0.2s，实际 ${elapsed}ms`)
      } finally {
        await close(server)
      }
    }
  } finally {
    await new Promise((r) => echo.close(r))
    await new Promise((r) => hanging.close(r))
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------- O12：serveStatic 前缀缺 sep 绕过 ----------------

test('O12 静态托管：同前缀兄弟目录（dist-evil）不得越界读取', async () => {
  const dir = tmpDist()
  try {
    // 兄弟目录与文件：/tmp/xxx/dist-evil/secret.txt（distDir = /tmp/xxx/dist）
    const distDir = join(dir, 'dist')
    const evilDir = join(dir, 'dist-evil')
    mkdirSync(distDir, { recursive: true })
    mkdirSync(evilDir, { recursive: true })
    writeFileSync(join(distDir, 'index.html'), '<html>ok</html>')
    writeFileSync(join(evilDir, 'secret.txt'), 'top-secret')

    const { server, port } = await startServer({ port: 0, dist: distDir, env: {} })
    const base = `http://127.0.0.1:${port}`
    try {
      // URL 编码穿越到兄弟目录：../dist-evil/secret.txt
      const res = await fetch(`${base}/%2e%2e/dist-evil/secret.txt`)
      assert.equal(res.status, 404, '兄弟目录穿越应 404')
      const text = await res.text()
      assert.ok(!text.includes('top-secret'), '响应体不得包含兄弟目录文件内容')

      // server 存活
      assert.equal((await fetch(`${base}/healthz`)).status, 200)
      // 正常静态请求不受影响：必须命中「注入的 dist」（内容断言锁定，
      // 防止 opts.dist 被静默忽略后因仓库恰好存在已构建 dist 而侥幸通过——CI 即因此失败）
      const ok = await fetch(`${base}/index.html`)
      assert.equal(ok.status, 200)
      assert.equal(await ok.text(), '<html>ok</html>', '应服务注入 dist 的 index.html，而非仓库 dist')
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------- O7：静态文件流 error 监听（stat 与 open 竞态不崩进程） ----------------

test('O7 静态文件流打开失败：tts/render 文件为目录时流 error 被消费，进程存活', async () => {
  const dir = tmpDist()
  try {
    const ttsDir = join(dir, 'tts-out')
    const renderDir = join(dir, 'render-out')
    mkdirSync(ttsDir, { recursive: true })
    mkdirSync(renderDir, { recursive: true })
    // 同名目录：statSync 成功（size > 0 语义），但 createReadStream 打开目录必然报错
    // → 旧实现（无 error 监听）未捕获 error 事件会崩溃全进程
    mkdirSync(join(ttsDir, 'broken.mp3'), { recursive: true })
    mkdirSync(join(renderDir, 'render_2099-01-01T00-00-00.mp4'), { recursive: true })

    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: {},
      ffmpegPath: '/fake/ffmpeg',
      ttsDir,
      renderDir,
    })
    const base = `http://127.0.0.1:${port}`
    try {
      // headers 已发出后流中断 → 客户端表现为响应截断 / 连接终止，两种均可接受
      for (const url of ['/files/tts/broken.mp3', '/files/render/render_2099-01-01T00-00-00.mp4']) {
        try {
          await fetch(`${base}${url}`)
        } catch {
          // 连接被终止 = 预期行为之一（关键是不崩进程）
        }
      }

      // 关键：进程存活
      assert.equal((await fetch(`${base}/healthz`)).status, 200)
      const ok = await fetch(`${base}/api/sessions/after-crash`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { v: 1 } }),
      })
      assert.equal(ok.status, 200)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
