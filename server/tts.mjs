/**
 * Edge-TTS 文件化引擎（P1-1）
 *
 * 能力：
 * - POST /api/tts { text, voice?, rate? } → 调用 Edge TTS（msedge-tts，纯 JS WebSocket 实现，
 *   无需 Python / API Key）合成 mp3 → 落盘 data/tts/<sha1前12位>-<ts>.mp3
 *   → 返回 { url: "/files/tts/xxx.mp3", path, bytes, voice }
 * - GET /files/tts/<file>.mp3：静态提供音频（Content-Type: audio/mpeg）
 * - 开关：WLS_TTS=off 时返回 501；/healthz 能力位 tts: on|off
 * - 限长：text ≤ 5000 字符（400 拒绝）
 *
 * 合成失败的优雅降级：502 + 明确错误信息，不拖垮主进程。
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TTS_TEXT_MAX = 5000
export const TTS_DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'
/** O6：单次合成整体超时默认 60s（WLS_TTS_TIMEOUT_SEC 可调），防止 WS 半开挂起 */
export const TTS_DEFAULT_TIMEOUT_SEC = 60

/** 合法音频文件名（防止路径穿越：仅允许 [A-Za-z0-9_-]+.mp3） */
export function isSafeTtsFileName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-]+\.mp3$/.test(name)
}

/**
 * 校验 /api/tts 请求体。
 * @returns {{ ok: true, text: string, voice: string, rate?: string } | { ok: false, error: string }}
 */
export function validateTtsBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' }
  }
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) {
    return { ok: false, error: 'text 不能为空' }
  }
  if (text.length > TTS_TEXT_MAX) {
    return { ok: false, error: `text 超过 ${TTS_TEXT_MAX} 字符上限（当前 ${text.length}）` }
  }
  if (typeof body.voice !== 'undefined' && typeof body.voice !== 'string') {
    return { ok: false, error: 'voice 必须是字符串' }
  }
  if (typeof body.rate !== 'undefined' && typeof body.rate !== 'string') {
    return { ok: false, error: 'rate 必须是字符串（如 "+20%" 或 "-10%"）' }
  }
  const rate = typeof body.rate === 'string' && body.rate.trim() ? body.rate.trim() : undefined
  if (rate && !/^[+-]\d+%$/.test(rate)) {
    return { ok: false, error: 'rate 格式非法，应为相对百分比（如 "+20%"）' }
  }
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : TTS_DEFAULT_VOICE
  if (!/^[A-Za-z]{2,}-[A-Za-z]{2,}-[A-Za-z]+/.test(voice)) {
    return { ok: false, error: 'voice 格式非法，应为 Edge TTS ShortName（如 zh-CN-XiaoxiaoNeural）' }
  }
  return { ok: true, text, voice, rate }
}

/**
 * 调用 Edge-TTS 合成 mp3 并落盘。
 * @param {object} opts
 * @param {string} opts.text 待合成文本
 * @param {string} [opts.voice] Edge TTS ShortName
 * @param {string} [opts.rate] 相对语速（如 "+20%"）
 * @param {string} opts.ttsDir mp3 落盘目录
 * @returns {Promise<{ fileName: string, filePath: string, bytes: number, voice: string }>}
 */
export async function synthesizeTtsToFile({
  text,
  voice = TTS_DEFAULT_VOICE,
  rate,
  ttsDir,
  timeoutMs = TTS_DEFAULT_TIMEOUT_SEC * 1000,
  ttsFactory = () => new MsEdgeTTS({ enableLogger: false }),
}) {
  const tts = ttsFactory()
  let timer
  try {
    // O6 修复：setMetadata 纳入 try/finally（此前它在 try 外，setMetadata 抛错时 tts.close()
    // 永不执行 → WebSocket 泄漏）；setMetadata / toStream / 流收集全链路受整体超时保护，
    // 半开 WS 永挂不再拖死请求。
    const work = (async () => {
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      const { audioStream } = tts.toStream(text, rate ? { rate } : undefined)

      // 流式收集音频字节（24kHz 48kbps 单声道 mp3，5000 字符上限下体量可控）
      const chunks = []
      for await (const chunk of audioStream) chunks.push(Buffer.from(chunk))

      const sha1 = createHash('sha1').update(text).update(voice).digest('hex').slice(0, 12)
      const stamp = Date.now().toString(36)
      const fileName = `${sha1}-${stamp}.mp3`
      mkdirSync(ttsDir, { recursive: true })
      const filePath = join(ttsDir, fileName)
      const audio = Buffer.concat(chunks)
      writeFileSync(filePath, audio)

      return { fileName, filePath, bytes: audio.length, voice }
    })()

    const guard = new Promise((_, rejectTimeout) => {
      timer = setTimeout(() => {
        rejectTimeout(
          Object.assign(new Error(`Edge-TTS 合成超时（>${Math.round(timeoutMs / 1000)}s），已终止`), { status: 504 })
        )
      }, timeoutMs)
    })

    return await Promise.race([work, guard])
  } finally {
    clearTimeout(timer)
    try {
      tts.close()
    } catch {}
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/**
 * 读取 JSON 请求体（R2 修复：超限 / 中途断开均不再挂起）。
 * 超限先回写 413 再 destroy 并 reject；'close'/'aborted' 未正常 end → reject。
 */
function readJsonBody(req, maxBytes, res) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    let overflow = false
    let settled = false
    let drained = 0
    const drainHardCap = maxBytes * 8
    const finish = (err, data) => {
      if (settled) return
      settled = true
      if (err) rejectBody(err)
      else resolveBody(data)
    }
    const tooLargeErr = () => Object.assign(new Error('body too large'), { code: 'WLS_BODY_TOO_LARGE' })

    req.on('data', (chunk) => {
      if (settled) {
        // 413 已回写：继续排空（绝不能拆连接，详见 render.mjs readJsonBody 注释）
        drained += chunk.length
        if (drained > drainHardCap) req.destroy()
        return
      }
      size += chunk.length
      if (size > maxBytes) {
        overflow = true
        if (res && !res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: '请求体超过上限' }))
        }
        req.resume()
        finish(tooLargeErr())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(overflow ? tooLargeErr() : null, Buffer.concat(chunks)))
    req.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))))
    const onAborted = () => {
      if (!overflow) finish(new Error('request aborted before body completed'))
    }
    req.on('aborted', onAborted)
    req.on('close', () => {
      if (!settled && !req.readableEnded) onAborted()
    })
  })
}

/**
 * 构造 POST /api/tts 处理器（协议层与实现解耦：synth 可注入 mock 供单测使用，不依赖网络）
 */
export function createTtsHandler({ enabled, ttsDir, logger, synth = synthesizeTtsToFile, timeoutSec = TTS_DEFAULT_TIMEOUT_SEC }) {
  return async function handleTts(req, res, urlPath) {
    if (urlPath !== '/api/tts') {
      sendJson(res, 404, { error: '未知 TTS 路由' })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: '仅支持 POST' })
      return
    }
    if (!enabled) {
      sendJson(res, 501, { error: 'TTS 未启用。设置 WLS_TTS=on（或删除 off 配置）后启用 Edge-TTS 语音合成。' })
      return
    }

    let body
    try {
      const buf = await readJsonBody(req, TTS_TEXT_MAX * 8 + 1024, res)
      body = JSON.parse(buf.toString('utf8'))
    } catch (err) {
      // R2：超限 413 已由 readJsonBody 直接回写（headersSent = true），不再二次响应
      if (res.headersSent) return
      const tooLarge = err instanceof Error && err.message === 'body too large'
      sendJson(res, 413, { error: tooLarge ? '请求体超过上限' : '请求体必须是合法 JSON' })
      return
    }

    const check = validateTtsBody(body)
    if (!check.ok) {
      sendJson(res, 400, { error: check.error })
      return
    }

    try {
      const { fileName, filePath, bytes, voice } = await synth({
        text: check.text,
        voice: check.voice,
        rate: check.rate,
        ttsDir,
        timeoutMs: timeoutSec * 1000,
      })
      logger?.info?.({ file: fileName, bytes, voice }, '[tts] 合成完成')
      sendJson(res, 200, {
        url: `/files/tts/${fileName}`,
        path: filePath,
        bytes,
        voice,
      })
    } catch (err) {
      logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, '[tts] 合成失败')
      // O6：合成整体超时 → 504；其余失败 → 502（错误对象可带 status）
      sendJson(res, err?.status || 502, {
        error: `Edge-TTS 合成失败：${err instanceof Error ? err.message : String(err)}（请检查网络连通性，Edge TTS 需可访问 speech.platform.bing.com）`,
      })
    }
  }
}

/** GET /files/tts/<name>.mp3 静态音频服务（防路径穿越：文件名白名单） */
export function createTtsFileHandler({ ttsDir }) {
  return function serveTtsFile(req, res, urlPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: '仅支持 GET/HEAD' })
      return
    }
    let name
    try {
      name = decodeURIComponent(urlPath.slice('/files/tts/'.length))
    } catch {
      sendJson(res, 400, { error: '非法音频文件名' })
      return
    }
    if (!isSafeTtsFileName(name)) {
      sendJson(res, 400, { error: '非法音频文件名' })
      return
    }
    const filePath = join(ttsDir, name)
    let size
    try {
      size = statSync(filePath).size
    } catch {
      sendJson(res, 404, { error: '音频文件不存在' })
      return
    }
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': size,
      'Cache-Control': 'public, max-age=86400',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    // O7：stat 与 open 之间存在竞态（文件被删/损坏），流 error 必须被消费
    createReadStream(filePath).on('error', () => {
      res.destroy()
    }).pipe(res)
  }
}
