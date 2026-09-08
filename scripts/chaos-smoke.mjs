#!/usr/bin/env node
/**
 * Chaos 冒烟脚本（边缘情况专项验收）
 *
 * 顺序执行一组「事故级」恶意/异常请求并断言：全程 CLI 进程存活、/healthz 持续 200。
 * 覆盖场景：
 *   1. CLI 直接启动（R1：启动日志不再 ReferenceError 崩溃）
 *   2. 畸形 URL（GET /%zz）
 *   3. 超限 body 打 4 个入口（render / tts / sessions / draft-zip，R2：413 而非挂起/重置）
 *   4. 反代上游中途断流（R3：进程不死）
 *   5. 不存在的静态文件 / 音频（O7：流错误不崩进程）
 *
 * 用法：npm run test:chaos
 * 退出码：0 = 全部通过；1 = 任一步骤失败（打印 ❌ 详情）
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const PORT = 21000 + Math.floor(Math.random() * 10000)
const BASE = `http://127.0.0.1:${PORT}`
let failures = 0

function ok(step, cond, detail = '') {
  if (cond) {
    console.log(`  ✔ ${step}`)
  } else {
    failures++
    console.error(`  ❌ ${step}${detail ? ` —— ${detail}` : ''}`)
  }
}

async function healthz(timeoutMs = 2000) {
  try {
    const res = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.status === 200
  } catch {
    return false
  }
}

async function waitHealthy(deadlineMs = 5000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    if (await healthz(500)) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

/** 上游：发送响应头与部分 body 后中途暴力断开（R3 场景） */
async function startFlakyUpstream() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '10000' })
    res.write('partial')
    setTimeout(() => req.socket.destroy(), 50)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { server, port: server.address().port }
}

async function main() {
  console.log('=== WebLockShot chaos 冒烟 ===')

  // 上游与 CLI 启动
  const flaky = await startFlakyUpstream()
  const child = spawn(process.execPath, ['server/weblockshot-server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      WLS_STORAGE: 'memory',
      WLS_LOG_LEVEL: 'info',
      WLS_LLM_TARGET: `http://127.0.0.1:${flaky.port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => (stdout += String(d)))
  child.stderr.on('data', (d) => (stderr += String(d)))
  let exitedCode = null
  child.on('exit', (code) => (exitedCode = code))

  const alive = async (step) => {
    const healthy = await healthz()
    ok(`${step} → /healthz 200（进程存活）`, healthy && exitedCode === null, `exited=${exitedCode}`)
  }

  try {
    // ---- 步骤 0：启动（R1）----
    const healthy = await waitHealthy()
    ok('CLI 启动 → /healthz 200（R1：无 ttsEnabled ReferenceError 崩溃）', healthy)
    ok('启动日志正常打印', stdout.includes('已启动'), `stdout: ${stdout.slice(0, 200)}`)
    ok('stdout/stderr 无 ReferenceError', !stdout.includes('ReferenceError') && !stderr.includes('ReferenceError'))

    // ---- 步骤 1：畸形 URL ----
    {
      const res = await fetch(`${BASE}/%zz`).catch(() => null)
      ok('GET /%zz → 正常响应（不崩）', res !== null && res.status < 500, `status=${res?.status}`)
      await alive('畸形 URL 后')
    }

    // ---- 步骤 2：超限 body 打 4 个入口（R2）----
    // 2a. /api/render（上限 1MB）
    {
      const res = await fetch(`${BASE}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: '/files/tts/x.mp4', pad: 'x'.repeat(2 * 1024 * 1024) }),
      }).catch((err) => ({ status: 0, error: err.message }))
      // chaos 环境未装 ffmpeg 时能力检查先于 body 读取 → 501 亦属正常（非挂起即可）
      ok('POST /api/render 超限 body → 413（或未启用 ffmpeg 时 501）', [413, 501].includes(res.status), `status=${res.status}`)
      await alive('render 超限后')
    }
    // 2b. /api/tts（上限约 41KB）
    {
      const res = await fetch(`${BASE}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(60 * 1024) }),
      }).catch((err) => ({ status: 0, error: err.message }))
      ok('POST /api/tts 超限 body → 413', res.status === 413, `status=${res.status}`)
      await alive('tts 超限后')
    }
    // 2c. /api/sessions（上限 8MB）
    {
      const res = await fetch(`${BASE}/api/sessions/chaos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { blob: 'x'.repeat(9 * 1024 * 1024) } }),
      }).catch((err) => ({ status: 0, error: err.message }))
      ok('PUT /api/sessions 超限 body → 413', res.status === 413, `status=${res.status}`)
      await alive('sessions 超限后')
    }
    // 2d. /api/jianying/draft-zip（上限 200MB，流式发送 201MB 零块，避免一次性占内存）
    {
      const status = await new Promise((resolveStatus) => {
        const req = http.request(
          { host: '127.0.0.1', port: PORT, path: '/api/jianying/draft-zip', method: 'POST', headers: { 'Content-Type': 'application/zip' } },
          (res) => {
            res.resume()
            res.on('end', () => resolveStatus(res.statusCode))
            res.on('error', () => resolveStatus(-1))
          }
        )
        req.on('error', () => resolveStatus(-1))
        const chunk = Buffer.alloc(1024 * 1024)
        let sent = 0
        req.on('drain', () => writeMore())
        function writeMore() {
          while (sent < 201 * 1024 * 1024) {
            sent += chunk.length
            if (!req.write(chunk)) return
          }
          req.end()
        }
        writeMore()
      })
      ok('POST /api/jianying/draft-zip 超限 body → 413', status === 413, `status=${status}`)
      await alive('draft-zip 超限后')
    }

    // ---- 步骤 3：反代上游中途断流（R3）----
    {
      let outcome = 'no-response'
      await new Promise((resolveReq) => {
        const req = http.get(`${BASE}/api/llm/partial`, (res) => {
          outcome = 'headers'
          res.on('data', () => {})
          res.on('end', () => resolveReq())
          res.on('error', () => resolveReq())
        })
        req.on('error', () => {
          outcome = 'connection-terminated'
          resolveReq()
        })
      })
      ok(
        '反代上游中途断流 → 客户端得到响应头/连接终止（进程不死）',
        outcome === 'headers' || outcome === 'connection-terminated',
        `outcome=${outcome}`
      )
      await alive('上游断流后')
    }

    // ---- 步骤 4：不存在的静态文件 / 音频 ----
    {
      const res = await fetch(`${BASE}/no-such-${Date.now()}.png`)
      ok('GET 不存在的静态文件 → 404', res.status === 404, `status=${res.status}`)
      const mp3 = await fetch(`${BASE}/files/tts/missing-${Date.now()}.mp3`)
      ok('GET /files/tts/missing.mp3 → 404', mp3.status === 404, `status=${mp3.status}`)
      await alive('静态 404 后')
    }

    // ---- 终检：日志与退出 ----
    ok('全程 stderr 无 ReferenceError / 未捕获异常', !stderr.includes('ReferenceError') && !stderr.includes('Unhandled'), stderr.slice(0, 300))
  } finally {
    child.kill()
    await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => flaky.server.close(r))
  }

  if (failures > 0) {
    console.error(`\n=== chaos 冒烟失败：${failures} 项 ===`)
    process.exit(1)
  }
  console.log('\n=== chaos 冒烟全部通过（进程全程存活） ===')
  process.exit(0)
}

main().catch((err) => {
  console.error('chaos 冒烟脚本异常:', err)
  process.exit(1)
})
