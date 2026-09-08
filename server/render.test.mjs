import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { startServer } from './weblockshot-server.mjs'
import {
  validateRenderUrl,
  validateRenderBody,
  detectFfmpeg,
  createRenderMutex,
  resolveLocalAsset,
} from './render.mjs'

function tmpDist() {
  return mkdtempSync(join(tmpdir(), 'wls-render-test-'))
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

/**
 * fake ffmpeg 子进程：模拟 exit 0 并写出伪 mp4（outPath 为 args 最后一项）。
 * 不依赖真实 ffmpeg 二进制，跨平台可用。
 */
function fakeFfmpegChild({ exitCode = 0, delayMs = 0, stderrText = '' } = {}) {
  const spawnCalls = []
  const spawnImpl = (cmd, args) => {
    spawnCalls.push({ cmd, args })
    const outPath = args[args.length - 1]
    return {
      stderr: { on: (_ev, cb) => stderrText && cb(stderrText) },
      kill() {},
      on(event, cb) {
        if (event === 'close') {
          setTimeout(() => {
            if (exitCode === 0) writeFileSync(outPath, Buffer.from('fake-mp4-bytes'))
            cb(exitCode)
          }, delayMs)
        }
      },
    }
  }
  return { spawnImpl, spawnCalls }
}

test('validateRenderUrl：协议白名单 + SSRF 内网防护', () => {
  // 允许：http/https
  assert.equal(validateRenderUrl('https://cdn.example.com/v.mp4').ok, true)
  assert.equal(validateRenderUrl('http://cdn.example.com/v.webm').ok, true)
  // 允许：本站相对路径
  const local = validateRenderUrl('/files/render/x.mp4')
  assert.equal(local.ok, true)
  assert.equal(local.kind, 'local')

  // 禁止：协议相对 //evil.com
  assert.ok(!validateRenderUrl('//evil.com/v.mp4').ok)
  // 禁止：file:// / ftp / data:
  assert.ok(!validateRenderUrl('file:///C:/windows/system32/config').ok)
  assert.ok(!validateRenderUrl('ftp://evil.com/v.mp4').ok)
  assert.ok(!validateRenderUrl('data:text/html;base64,AAAA').ok)
  // 禁止：内网地址（SSRF）
  assert.ok(!validateRenderUrl('http://localhost:8188/x').ok)
  assert.ok(!validateRenderUrl('http://127.0.0.1:5174/x').ok)
  assert.ok(!validateRenderUrl('http://10.0.0.1/x').ok)
  assert.ok(!validateRenderUrl('http://192.168.1.1/x').ok)
  assert.ok(!validateRenderUrl('http://172.16.0.1/x').ok)
  assert.ok(!validateRenderUrl('http://172.31.255.255/x').ok)
  assert.ok(!validateRenderUrl('http://169.254.169.254/latest/meta-data').ok)
  assert.ok(!validateRenderUrl('http://[::1]:8080/x').ok)
  // 禁止：172.15 / 172.32（边界外放行）
  assert.equal(validateRenderUrl('http://172.15.0.1/x').ok, true)
  assert.equal(validateRenderUrl('http://172.32.0.1/x').ok, true)
  // 非法字符串
  assert.ok(!validateRenderUrl('').ok)
  assert.ok(!validateRenderUrl('not a url').ok)
  assert.ok(!validateRenderUrl(null).ok)
})

test('validateRenderBody：必填/类型/上限', () => {
  assert.ok(!validateRenderBody(null).ok)
  assert.ok(!validateRenderBody([]).ok)
  assert.ok(!validateRenderBody({}).ok, '缺 videoUrl')

  const ok = validateRenderBody({ videoUrl: '/files/render/in.mp4', title: '测试' })
  assert.equal(ok.ok, true)
  assert.equal(ok.title, '测试')
  assert.equal(ok.subtitleSrt, null)

  // audioUrl 非法传染
  assert.ok(!validateRenderBody({ videoUrl: 'https://a.com/v.mp4', audioUrl: 'file:///x' }).ok)
  // subtitleSrt 类型
  assert.ok(!validateRenderBody({ videoUrl: 'https://a.com/v.mp4', subtitleSrt: 123 }).ok)
  // subtitleSrt 200KB 上限
  assert.ok(!validateRenderBody({ videoUrl: 'https://a.com/v.mp4', subtitleSrt: 'a'.repeat(200 * 1024 + 1) }).ok)
  // title 类型
  assert.ok(!validateRenderBody({ videoUrl: 'https://a.com/v.mp4', title: 42 }).ok)
  // audioUrl 为空串/省略 → 无音轨
  assert.equal(validateRenderBody({ videoUrl: 'https://a.com/v.mp4', audioUrl: '' }).audioUrl, null)
})

test('createRenderMutex：互斥 + 队列按序释放', async () => {
  const m = createRenderMutex()
  assert.equal(m.isBusy, false)
  await m.acquire()
  assert.equal(m.isBusy, true)

  let secondAcquired = false
  const p = m.acquire().then(() => {
    secondAcquired = true
  })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(secondAcquired, false, '第二个 acquire 应排队等待')
  m.release()
  assert.equal(m.isBusy, false)
  await p
  assert.equal(secondAcquired, true, 'release 后队列中的 acquire 应被放行')
  m.release()
})

test('detectFfmpeg：返回 string 或 null（不抛异常）', () => {
  const result = detectFfmpeg()
  assert.ok(result === null || typeof result === 'string')
})

test('POST /api/render：fake ffmpeg 全链路 200 + /files/render 回读（本地视频 + 远程音频 mock 下载）', async () => {
  const dir = tmpDist()
  try {
    const ttsDir = join(dir, 'tts-out')
    mkdirSync(ttsDir, { recursive: true })
    // 本地视频：放置在 ttsDir，经 /files/tts/ 相对路径引用
    writeFileSync(join(ttsDir, 'fake-video.mp4'), Buffer.from('fake-video-bytes'))
    // 本地音轨
    writeFileSync(join(ttsDir, 'fake-audio.mp3'), Buffer.from('fake-audio-bytes'))

    const fake = fakeFfmpegChild()
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
      const res = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: '/files/tts/fake-video.mp4',
          audioUrl: '/files/tts/fake-audio.mp3',
          title: '全链路测试',
        }),
      })
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.match(body.url, /^\/files\/render\/render_[\w-]+\.mp4$/)
      assert.ok(existsSync(body.path))
      assert.equal(readFileSync(body.path).toString(), 'fake-mp4-bytes')

      // fake ffmpeg 收到了正确的双输入 + copy 参数
      const call = fake.spawnCalls[0]
      assert.equal(call.args.filter((a) => a === '-c:v').length, 1)
      assert.ok(call.args.includes('copy'))
      assert.ok(call.args.includes('-shortest'))

      // 成片静态回读
      const mp4 = await fetch(`${base}${body.url}`)
      assert.equal(mp4.status, 200)
      assert.equal(mp4.headers.get('content-type'), 'video/mp4')

      // healthz 能力位
      assert.equal((await (await fetch(`${base}/healthz`)).json()).ffmpeg, 'on')
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/render：远程视频 mock 下载 → 合成成功；下载失败 502；超声明 413', async () => {
  const dir = tmpDist()
  try {
    const videoBytes = Buffer.from('remote-video-bytes')
    const fake = fakeFfmpegChild()
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: {},
      ffmpegPath: '/fake/ffmpeg',
      renderDir: join(dir, 'render-out'),
      renderSpawnImpl: fake.spawnImpl,
      renderFetchImpl: async (url) => {
        if (url.includes('fail')) return new Response('boom', { status: 404 })
        if (url.includes('huge')) {
          return new Response(videoBytes, { status: 200, headers: { 'Content-Length': String(600 * 1024 * 1024) } })
        }
        return new Response(videoBytes, { status: 200, headers: { 'Content-Type': 'video/mp4' } })
      },
    })
    const base = `http://127.0.0.1:${port}`
    try {
      // 成功：远程视频下载 → fake ffmpeg
      const ok = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: 'https://cdn.example.com/video.mp4' }),
      })
      assert.equal(ok.status, 200)

      // 下载失败 → 502
      const fail = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: 'https://cdn.example.com/fail.mp4' }),
      })
      assert.equal(fail.status, 502)

      // 超声明上限 → 413
      const huge = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: 'https://cdn.example.com/huge.mp4' }),
      })
      assert.equal(huge.status, 413)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/render：互斥锁——任务进行中第二个请求 429', async () => {
  const dir = tmpDist()
  try {
    const ttsDir = join(dir, 'tts-out')
    mkdirSync(ttsDir, { recursive: true })
    writeFileSync(join(ttsDir, 'v.mp4'), Buffer.from('v'))

    const fake = fakeFfmpegChild({ delayMs: 400 })
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
      const req1 = fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: '/files/tts/v.mp4' }),
      })
      // 稍等让第一个任务进入 ffmpeg 阶段
      await new Promise((r) => setTimeout(r, 120))
      const res2 = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: '/files/tts/v.mp4' }),
      })
      assert.equal(res2.status, 429)
      assert.ok((await res2.json()).error.includes('1 个'))

      const res1 = await req1
      assert.equal(res1.status, 200)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/render：超时 kill → 504', async () => {
  const dir = tmpDist()
  try {
    const ttsDir = join(dir, 'tts-out')
    mkdirSync(ttsDir, { recursive: true })
    writeFileSync(join(ttsDir, 'v.mp4'), Buffer.from('v'))

    // 永不结束的 fake ffmpeg
    const spawnImpl = () => ({
      stderr: { on() {} },
      kill() {},
      on() {},
    })
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: { WLS_RENDER_TIMEOUT_SEC: '0.3' },
      ffmpegPath: '/fake/ffmpeg',
      renderDir: join(dir, 'render-out'),
      ttsDir,
      renderSpawnImpl: spawnImpl,
    })
    const base = `http://127.0.0.1:${port}`
    try {
      const res = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: '/files/tts/v.mp4' }),
      })
      assert.equal(res.status, 504)
      assert.ok((await res.json()).error.includes('超时'))

      // 超时释放锁后可再次接受任务（不再 429；此请求同样超时 504 证明锁已释放并重新处理）
      const res2 = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: '/files/tts/v.mp4' }),
      })
      assert.equal(res2.status, 504)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/render：WLS_FFMPEG=off → 501；二进制缺失 → 501 + healthz ffmpeg=off；URL 非法 400', async () => {
  const dir = tmpDist()
  try {
    {
      const { server, port } = await startServer({
        port: 0,
        dist: dir,
        env: { WLS_FFMPEG: 'off' },
      })
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: 'https://a.com/v.mp4' }),
        })
        assert.equal(res.status, 501)
        assert.ok((await res.json()).error.includes('WLS_FFMPEG'))
        assert.equal((await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).ffmpeg, 'off')
      } finally {
        await close(server)
      }
    }
    {
      // 显式注入 null 模拟未安装 ffmpeg
      const { server, port } = await startServer({
        port: 0,
        dist: dir,
        env: {},
        ffmpegPath: null,
      })
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: 'https://a.com/v.mp4' }),
        })
        assert.equal(res.status, 501)
        assert.ok((await res.json()).error.includes('ffmpeg'))
        assert.equal((await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).ffmpeg, 'off')
      } finally {
        await close(server)
      }
    }
    {
      const { server, port } = await startServer({
        port: 0,
        dist: dir,
        env: {},
        ffmpegPath: '/fake/ffmpeg',
      })
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: 'file:///etc/passwd' }),
        })
        assert.equal(res.status, 400)
        assert.ok((await res.json()).error.includes('协议'))
      } finally {
        await close(server)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('/files/render：路径穿越 400；不存在 404；非法方法 405', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: {},
      ffmpegPath: '/fake/ffmpeg',
      renderDir: join(dir, 'render-out'),
    })
    const base = `http://127.0.0.1:${port}`
    try {
      const trav = await fetch(`${base}/files/render/${encodeURIComponent('../../secret.mp4')}`)
      assert.equal(trav.status, 400)
      const miss = await fetch(`${base}/files/render/render_2099-01-01T00-00-00.mp4`)
      assert.equal(miss.status, 404)
      const del = await fetch(`${base}/files/render/render_2099-01-01T00-00-00.mp4`, { method: 'DELETE' })
      assert.equal(del.status, 405)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/render：本站素材不存在 → 404；ffmpeg 失败 → 502', async () => {
  const dir = tmpDist()
  try {
    const fake = fakeFfmpegChild({ exitCode: 1, stderrText: 'Invalid data found' })
    const ttsDir = join(dir, 'tts-out')
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
      const miss = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: '/files/tts/no-such.mp4' }),
      })
      assert.equal(miss.status, 404)

      // 本站 .mp4 copy 失败（exitCode 1）→ 不触发回退，直接 502
      mkdirSync(ttsDir, { recursive: true })
      writeFileSync(join(ttsDir, 'bad.mp4'), Buffer.from('bad'))
      const fail = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: '/files/tts/bad.mp4' }),
      })
      assert.equal(fail.status, 502)
      assert.ok((await fail.json()).error.includes('ffmpeg'))
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S1 安全：resolveLocalAsset 路径穿越防护（../ 与 %2e%2e 双形态）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wls-s1-test-'))
  try {
    const ttsDir = join(dir, 'tts')
    mkdirSync(ttsDir, { recursive: true })
    // 秘密文件放在白名单目录之外（ttsDir 上一级）
    const secretPath = join(dir, 'secret.mp4')
    writeFileSync(secretPath, Buffer.from('top-secret'))
    const opts = { ttsDir, renderDir: join(dir, 'render') }

    // 正常文件可解析
    assert.equal(resolveLocalAsset('/files/tts/ok.mp4', opts), join(ttsDir, 'ok.mp4'))

    // ../ 穿越 → 拒绝
    assert.equal(resolveLocalAsset('/files/tts/../secret.mp4', opts), null)
    // 嵌套 .. → 拒绝
    assert.equal(resolveLocalAsset('/files/tts/../../secret.mp4', opts), null)
    // URL 编码 %2e%2e → 解码后含 .. → 拒绝
    assert.equal(resolveLocalAsset('/files/tts/%2e%2e/secret.mp4', opts), null)
    assert.equal(resolveLocalAsset('/files/tts/%2e%2e%2fsecret.mp4', opts), null)
    // 双编码 %252e → 解码一次后仍为 %2e%2e 字面量目录名（不构成真实穿越），解析结果仍停留在白名单目录内
    const dbl = resolveLocalAsset('/files/tts/%252e%252e/secret.mp4', opts)
    assert.ok(dbl === null || dbl.startsWith(ttsDir + sep), '双编码形态不得越出白名单目录')

    // 反斜杠与绝对路径 → 拒绝
    assert.equal(resolveLocalAsset('/files/tts/..\\secret.mp4', opts), null)
    assert.equal(resolveLocalAsset('/files/tts//etc/passwd.mp4', opts), null, '绝对路径形态（resolve 替换 base）被前缀兜底拒绝')
    assert.equal(resolveLocalAsset('/files/other/secret.mp4', opts), null, '白名单外前缀')
    // 畸形转义 → 拒绝
    assert.equal(resolveLocalAsset('/files/tts/%zz.mp4', opts), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S1 安全：/api/render live 穿越请求 → 404，白名单外文件不被 ffmpeg 摄取', async () => {
  const dir = tmpDist()
  try {
    const ttsDir = join(dir, 'tts-out')
    mkdirSync(ttsDir, { recursive: true })
    // 秘密文件位于 ttsDir 上一级（白名单目录之外）
    writeFileSync(join(dir, 'secret.mp4'), Buffer.from('top-secret-bytes'))
    const fake = fakeFfmpegChild()
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
      for (const payload of ['/files/tts/../secret.mp4', '/files/tts/%2e%2e/secret.mp4']) {
        const res = await fetch(`${base}/api/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: payload }),
        })
        assert.equal(res.status, 404, `${payload} 应 404`)
      }
      // 关键：fake ffmpeg 从未被调用（穿越路径未进入合成流程）
      assert.equal(fake.spawnCalls.length, 0)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('真实 ffmpeg 链路：testsrc 视频正弦音轨合成 mp4（本机/CI 有 ffmpeg 才跑）', { skip: detectFfmpeg() === null ? '本机无 ffmpeg，跳过（CI ubuntu runner 自带）' : false }, async () => {
  const dir = tmpDist()
  const ffmpegPath = detectFfmpeg()
  try {
    // 1. 用真实 ffmpeg 生成 1s 测试视频（testsrc）与正弦音轨
    const testVideo = join(dir, 'input_test.mp4')
    await new Promise((resolveGen, rejectGen) => {
      const p = spawn(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', '-pix_fmt', 'yuv420p', testVideo])
      p.on('close', (code) => (code === 0 ? resolveGen() : rejectGen(new Error(`testsrc 生成失败 code=${code}`))))
      p.on('error', rejectGen)
    })
    const testAudio = join(dir, 'input_audio.wav')
    await new Promise((resolveGen, rejectGen) => {
      const p = spawn(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', testAudio])
      p.on('close', (code) => (code === 0 ? resolveGen() : rejectGen(new Error(`sine 生成失败 code=${code}`))))
      p.on('error', rejectGen)
    })

    // 2. 音轨放到本站可引用位置（renderDir），视频经相对路径引用
    const renderDir = join(dir, 'render-out')
    mkdirSync(renderDir, { recursive: true })

    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: {},
      renderDir,
    })
    const base = `http://127.0.0.1:${port}`
    try {
      // 视频与音轨都以本站相对路径提供：先把音轨伪装到 tts 目录引用（resolveLocalAsset 白名单）
      const ttsDir = join(dir, 'tts-out')
      mkdirSync(ttsDir, { recursive: true })
      const audioRef = join(ttsDir, 'audio_src.mp3')
      const { copyFileSync } = await import('node:fs')
      copyFileSync(testAudio, audioRef)
      const videoRef = join(ttsDir, 'video_src.mp4')
      copyFileSync(testVideo, videoRef)

      const res = await fetch(`${base}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: '/files/tts/video_src.mp4',
          audioUrl: '/files/tts/audio_src.mp3',
          title: '真实链路',
        }),
      })
      assert.equal(res.status, 200, `真实合成应成功：${await res.text()}`)
      const body = await res.json()
      assert.ok(body.bytes > 0)
      assert.ok(existsSync(body.path))

      // 产物可回读且为合法 mp4（ftyp box）
      const head = readFileSync(body.path).subarray(4, 8).toString()
      assert.equal(head, 'ftyp', '产物应是合法 mp4 容器')
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
