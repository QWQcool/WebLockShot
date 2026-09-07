import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from './weblockshot-server.mjs'
import {
  validateTtsBody,
  isSafeTtsFileName,
  TTS_TEXT_MAX,
  TTS_DEFAULT_VOICE,
} from './tts.mjs'

function tmpDist() {
  return mkdtempSync(join(tmpdir(), 'wls-tts-test-'))
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

/** 注入的 mock 合成器：不依赖网络，直接写伪 mp3 字节落盘 */
function mockSynth() {
  return async ({ text, voice, rate, ttsDir }) => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const fileName = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.mp3`
    mkdirSync(ttsDir, { recursive: true })
    const filePath = join(ttsDir, fileName)
    writeFileSync(filePath, Buffer.from(`fake-mp3:${text.slice(0, 8)}:${voice}:${rate ?? ''}`))
    return { fileName, filePath, bytes: 128, voice }
  }
}

test('validateTtsBody：合法/默认 voice/非法输入全覆盖', () => {
  // 合法 + 默认 voice
  const ok = validateTtsBody({ text: '你好世界' })
  assert.equal(ok.ok, true)
  assert.equal(ok.voice, TTS_DEFAULT_VOICE)
  assert.equal(ok.text, '你好世界')

  // 合法 + 自定义 voice/rate
  const ok2 = validateTtsBody({ text: 'hi', voice: 'en-US-AriaNeural', rate: '+20%' })
  assert.equal(ok2.ok, true)
  assert.equal(ok2.voice, 'en-US-AriaNeural')
  assert.equal(ok2.rate, '+20%')

  // 非对象
  assert.equal(validateTtsBody(null).ok, false)
  assert.equal(validateTtsBody('str').ok, false)
  assert.equal(validateTtsBody([1]).ok, false)

  // 空 text
  assert.equal(validateTtsBody({ text: '   ' }).ok, false)
  assert.equal(validateTtsBody({}).ok, false)

  // 超限
  const long = 'a'.repeat(TTS_TEXT_MAX + 1)
  const over = validateTtsBody({ text: long })
  assert.equal(over.ok, false)
  assert.ok(over.error.includes('5000'))

  // 边界内通过
  assert.equal(validateTtsBody({ text: 'a'.repeat(TTS_TEXT_MAX) }).ok, true)

  // 非法 rate
  assert.ok(!validateTtsBody({ text: 'x', rate: '20%' }).ok)
  assert.ok(!validateTtsBody({ text: 'x', rate: '+20' }).ok)
  assert.ok(!validateTtsBody({ text: 'x', rate: 20 }).ok)

  // 非法 voice
  assert.ok(!validateTtsBody({ text: 'x', voice: 'bad name!' }).ok)
  assert.ok(!validateTtsBody({ text: 'x', voice: 123 }).ok)
})

test('isSafeTtsFileName：白名单防路径穿越', () => {
  assert.equal(isSafeTtsFileName('abc123-xyz.mp3'), true)
  assert.equal(isSafeTtsFileName('../etc/passwd.mp3'), false)
  assert.equal(isSafeTtsFileName('a/b.mp3'), false)
  assert.equal(isSafeTtsFileName('..\\win.mp3'), false)
  assert.equal(isSafeTtsFileName('x.txt'), false)
  assert.equal(isSafeTtsFileName('中文.mp3'), false)
  assert.equal(isSafeTtsFileName(''), false)
  assert.equal(isSafeTtsFileName(null), false)
})

test('POST /api/tts：mock 合成 → 200 + 落盘 + /files/tts 回读', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: {},
      ttsSynth: mockSynth(),
      ttsDir: join(dir, 'tts-out'),
    })
    const base = `http://127.0.0.1:${port}`
    try {
      const res = await fetch(`${base}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '你好，WebLockShot', voice: 'zh-CN-XiaoxiaoNeural' }),
      })
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.voice, 'zh-CN-XiaoxiaoNeural')
      assert.equal(body.bytes, 128)
      assert.match(body.url, /^\/files\/tts\/[A-Za-z0-9_-]+\.mp3$/)
      assert.ok(body.path.length > 0)
      assert.ok(existsSync(body.path))

      // /files/tts 静态回读：Content-Type audio/mpeg + 字节一致
      const audio = await fetch(`${base}${body.url}`)
      assert.equal(audio.status, 200)
      assert.equal(audio.headers.get('content-type'), 'audio/mpeg')
      const buf = Buffer.from(await audio.arrayBuffer())
      assert.ok(buf.toString().startsWith('fake-mp3:你好，Web'))

      // healthz 能力位
      const health = await (await fetch(`${base}/healthz`)).json()
      assert.equal(health.tts, 'on')
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/tts：text 超限 400；空 text 400；非法 body 400', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: {},
      ttsSynth: mockSynth(),
    })
    const base = `http://127.0.0.1:${port}`
    try {
      // 超限 400
      const over = await fetch(`${base}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'a'.repeat(TTS_TEXT_MAX + 1) }),
      })
      assert.equal(over.status, 400)
      assert.ok((await over.json()).error.includes('5000'))

      // 空 text 400
      const empty = await fetch(`${base}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      })
      assert.equal(empty.status, 400)

      // 非法 JSON 400（sendJson 语义：请求体必须是合法 JSON → 实现为 413/400 由 readJsonBody 分支决定）
      const bad = await fetch(`${base}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      })
      assert.ok([400, 413].includes(bad.status))

      // 非 JSON 对象 400
      const arr = await fetch(`${base}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([1, 2]),
      })
      assert.equal(arr.status, 400)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WLS_TTS=off：/api/tts 返回 501 + healthz 能力位 off；未设置默认 on', async () => {
  const dir = tmpDist()
  try {
    {
      const { server, port } = await startServer({
        port: 0,
        dist: dir,
        env: { WLS_TTS: 'off' },
        ttsSynth: mockSynth(),
      })
      const base = `http://127.0.0.1:${port}`
      try {
        const res = await fetch(`${base}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: '你好' }),
        })
        assert.equal(res.status, 501)
        assert.ok((await res.json()).error.includes('WLS_TTS'))
        assert.equal((await (await fetch(`${base}/healthz`)).json()).tts, 'off')
      } finally {
        await close(server)
      }
    }
    {
      const { server, port } = await startServer({
        port: 0,
        dist: dir,
        env: {},
        ttsSynth: mockSynth(),
      })
      try {
        const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()
        assert.equal(health.tts, 'on')
      } finally {
        await close(server)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('/files/tts：路径穿越 400；不存在 404；方法限制 405', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: {},
      ttsSynth: mockSynth(),
      ttsDir: join(dir, 'tts-out'),
    })
    const base = `http://127.0.0.1:${port}`
    try {
      // 路径穿越 → 400
      const trav = await fetch(`${base}/files/tts/${encodeURIComponent('../../etc/passwd.mp3')}`)
      assert.equal(trav.status, 400)

      // 非法扩展名 → 400
      const txt = await fetch(`${base}/files/tts/hello.txt`)
      assert.equal(txt.status, 400)

      // 不存在 → 404
      const miss = await fetch(`${base}/files/tts/no-such-file-000.mp3`)
      assert.equal(miss.status, 404)

      // 方法限制 → 405
      const del = await fetch(`${base}/files/tts/no-such-file-000.mp3`, { method: 'DELETE' })
      assert.equal(del.status, 405)

      // 正常文件：HEAD 请求返回头不返回体
      const synth = await (
        await fetch(`${base}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'HEAD 测试' }),
        })
      ).json()
      const head = await fetch(`${base}${synth.url}`, { method: 'HEAD' })
      assert.equal(head.status, 200)
      assert.equal(head.headers.get('content-type'), 'audio/mpeg')
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /api/tts：合成异常 → 502 优雅降级，server 不崩', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: {},
      ttsSynth: async () => {
        throw new Error('simulated network down')
      },
    })
    const base = `http://127.0.0.1:${port}`
    try {
      const res = await fetch(`${base}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
      })
      assert.equal(res.status, 502)
      assert.ok((await res.json()).error.includes('simulated network down'))

      // server 仍存活
      assert.equal((await fetch(`${base}/healthz`)).status, 200)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('GET /api/tts：方法限制 405；WLS_AUTH_TOKEN 对 /api/tts 生效', async () => {
  const dir = tmpDist()
  try {
    const { server, port } = await startServer({
      port: 0,
      dist: dir,
      env: { WLS_AUTH_TOKEN: 'tok-1' },
      ttsSynth: mockSynth(),
    })
    const base = `http://127.0.0.1:${port}`
    try {
      // 无 token → 401（鉴权层先于方法检查）
      const noAuth = await fetch(`${base}/api/tts`, { method: 'GET' })
      assert.equal(noAuth.status, 401)

      // 有 token + GET → 405
      const withAuth = await fetch(`${base}/api/tts`, {
        method: 'GET',
        headers: { 'x-wls-token': 'tok-1' },
      })
      assert.equal(withAuth.status, 405)
    } finally {
      await close(server)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
