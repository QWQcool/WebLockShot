/**
 * ffmpeg 服务端成片合成引擎（P1-2）
 *
 * 能力：
 * - POST /api/render { videoUrl, audioUrl?, subtitleSrt?, title? }
 *   1) 解析视频/音频来源：本站相对路径（/files/...）直接读文件；http(s) 下载到临时目录（500MB 上限）
 *   2) ffmpeg 合成：视频 + 音轨（-c:v copy，音频重编码 aac）+ 可选字幕软封（mov_text）→ mp4
 *      copy 失败（容器不兼容，如 webm→mp4）自动回退 libx264 重编码
 *   3) 输出落盘 data/render/<ts>.mp4 → 返回 { url: "/files/render/xxx.mp4", bytes }
 * - 开关：WLS_FFMPEG=auto|off；auto 探测 ffmpeg 二进制，缺失 → 501 + 提示安装
 * - 安全：协议白名单（http/https/本站相对路径），禁止 file:// 与内网地址（SSRF 防护）
 * - 超时：单任务 10 分钟上限（WLS_RENDER_TIMEOUT_SEC 可调），超时 kill → 504
 * - 互斥：同一时间最多 1 个渲染任务，忙时 429
 * - healthz 能力位 ffmpeg: on|off
 */
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const RENDER_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024 // 500MB
export const RENDER_DEFAULT_TIMEOUT_SEC = 600

/** 渲染任务互斥锁：同一时间最多 1 个任务 */
export function createRenderMutex() {
  let busy = false
  const queue = []
  return {
    get isBusy() {
      return busy
    },
    async acquire() {
      if (!busy) {
        busy = true
        return
      }
      await new Promise((release) => queue.push(release))
      busy = true
    },
    release() {
      busy = false
      const next = queue.shift()
      if (next) next()
    },
  }
}

/**
 * ffmpeg 二进制探测：PATH（where/which）+ 常见安装路径。
 * @returns {string|null} 可执行的 ffmpeg 路径；探测不到返回 null
 */
export function detectFfmpeg() {
  // 1. PATH 探测（跨平台：where=win / which=unix）
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    const r = spawnSync(finder, ['ffmpeg'], { encoding: 'utf8', timeout: 5000 })
    if (r.status === 0) {
      const first = String(r.stdout || '').split(/\r?\n/).find((l) => l.trim())
      if (first && existsSync(first.trim())) return first.trim()
    }
  } catch {
    // 探测失败继续走常见路径
  }

  // 2. 常见安装路径兜底
  const common = process.platform === 'win32'
    ? [
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
      ]
    : ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/snap/bin/ffmpeg']
  for (const p of common) {
    if (existsSync(p)) return p
  }
  return null
}

/**
 * O4：将 IPv4 的非标准书写形态（十进制整数 / 八进制段 / 十六进制段 / 省略零段）
 * 规范化为 32 位无符号整数，便于统一判定私网段。
 * 例：'2130706433' / '127.1' / '0x7f.0.0.1' / '0177.0.0.1' 均解析为 127.0.0.1。
 * 非 IPv4 数字形态（普通域名 / IPv6 / 非法段）返回 null。
 * @returns {number|null}
 */
export function parseIpv4Numeric(host) {
  if (!host || !/^[0-9a-fA-FxX.]+$/.test(host)) return null
  const parts = host.split('.')
  if (parts.length > 4) return null
  let value = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) return null
    let n
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
      n = parseInt(part, 16)
    } else if (part.length > 1 && /^0[0-7]+$/.test(part)) {
      n = parseInt(part.slice(1), 8)
    } else if (/^\d+$/.test(part)) {
      n = parseInt(part, 10)
    } else {
      return null
    }
    const isLast = i === parts.length - 1
    if (isLast) {
      // 末段可承载剩余字节（inet_aton 语义）：'2130706433' / '127.1'
      const span = 256 ** (4 - i)
      if (n > span - 1) return null
      value = value * span + n
    } else {
      if (n > 255) return null
      value = value * 256 + n
    }
  }
  return value >>> 0
}

/** O4：32 位 IPv4 整数是否落在私网 / 保留段（loopback / 私网 / link-local / CGNAT / 0.0.0.0） */
export function isPrivateIpv4Value(value) {
  const b = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
  return (
    b[0] === 0 ||
    b[0] === 10 ||
    b[0] === 127 ||
    (b[0] === 100 && b[1] >= 64 && b[1] <= 127) ||
    (b[0] === 169 && b[1] === 254) ||
    (b[0] === 172 && b[1] >= 16 && b[1] <= 31) ||
    (b[0] === 192 && b[1] === 168)
  )
}

/**
 * 校验渲染来源 URL：允许 http(s) 与本站相对路径（/ 开头）；禁止 file://、data: 等协议
 * 与内网地址（SSRF 防护，含十进制/八进制/十六进制 IP 绕过形态）。
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateRenderUrl(raw, { fieldName = 'url' } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: `${fieldName} 不能为空` }
  }
  const url = raw.trim()

  // 本站相对路径：/files/... （不以 // 开头，排除协议相对 //evil.com）
  if (url.startsWith('/') && !url.startsWith('//')) {
    return { ok: true, kind: 'local', value: url }
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: `${fieldName} 非法：必须是 http(s) URL 或本站 /files/ 相对路径` }
  }

  // 协议白名单：仅 http/https（禁止 file://、ftp:、data: 等任意协议）
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `${fieldName} 协议不允许：${parsed.protocol}（仅允许 http/https 或本站相对路径）` }
  }

  // 内网地址防护（SSRF）：loopback / 私网段 / link-local / IPv6 本地环回与 ULA
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isPrivate =
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === 'localhost6' ||
    /^fc[0-9a-f]{2}:/i.test(host) ||
    /^fe80:/i.test(host)
  if (isPrivate) {
    return { ok: false, error: `${fieldName} 禁止指向内网地址（SSRF 防护）：${host}` }
  }

  // O4：非标准 IP 书写形态规范化后复检（http://2130706433/ 与 0x7f.0.0.1 等不再绕过）
  const ipv4Value = parseIpv4Numeric(host)
  if (ipv4Value !== null && isPrivateIpv4Value(ipv4Value)) {
    return { ok: false, error: `${fieldName} 禁止指向内网地址（SSRF 防护）：${host}` }
  }

  return { ok: true, kind: 'remote', value: url }
}

/**
 * 校验 /api/render 请求体。
 * @returns {{ ok: true, videoUrl, audioUrl?, subtitleSrt?, title? } | { ok: false, error: string }}
 */
export function validateRenderBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' }
  }
  const video = validateRenderUrl(body.videoUrl, { fieldName: 'videoUrl' })
  if (!video.ok) return video

  let audio = { ok: true, value: undefined }
  if (body.audioUrl != null && body.audioUrl !== '') {
    audio = validateRenderUrl(body.audioUrl, { fieldName: 'audioUrl' })
    if (!audio.ok) return audio
  }

  if (body.subtitleSrt != null && typeof body.subtitleSrt !== 'string') {
    return { ok: false, error: 'subtitleSrt 必须是字符串（SRT 字幕内容）' }
  }
  if (body.subtitleSrt && body.subtitleSrt.length > 200 * 1024) {
    return { ok: false, error: 'subtitleSrt 超过 200KB 上限' }
  }
  if (body.title != null && typeof body.title !== 'string') {
    return { ok: false, error: 'title 必须是字符串' }
  }

  return {
    ok: true,
    videoUrl: video.value,
    videoKind: video.kind,
    audioUrl: audio.value ?? null,
    audioKind: audio.kind ?? null,
    subtitleSrt: typeof body.subtitleSrt === 'string' && body.subtitleSrt.trim() ? body.subtitleSrt : null,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null,
  }
}

/**
 * 解析本站相对路径到磁盘文件（仅允许 /files/tts/、/files/render/ 白名单前缀）。
 * 安全（S1 修复）：显式拒绝 `..` 穿越（含 URL 编码 %2e%2e 形态，先解码再校验）、
 * 反斜杠与绝对路径，并做 resolve 后前缀兜底校验，确保解析结果不越出白名单目录。
 */
export function resolveLocalAsset(urlPath, { ttsDir, renderDir }) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null // 畸形转义直接拒绝
  }

  let base = null
  let rel = null
  if (decoded.startsWith('/files/tts/')) {
    base = ttsDir
    rel = decoded.slice('/files/tts/'.length)
  } else if (decoded.startsWith('/files/render/')) {
    base = renderDir
    rel = decoded.slice('/files/render/'.length)
  } else {
    return null
  }

  // 防穿越：拒绝 .. 段（覆盖 ../ 与 ..\ 语义）、反斜杠、绝对路径（/x 或 C:\x）
  if (!rel || rel.includes('..') || rel.includes('\\') || resolve(rel) === rel) {
    return null
  }

  // 兜底：resolve 后必须仍落在 base 目录内
  const baseAbs = resolve(base)
  const resolved = resolve(baseAbs, rel)
  if (resolved !== baseAbs && !resolved.startsWith(baseAbs + sep)) {
    return null
  }
  return resolved
}

/**
 * O4：下载前对远程主机做尽力而为的 DNS 落地校验（解析出的所有 IP 不得落私网段）。
 * 注意：这是尽力而为（best-effort）防护——解析与实际连接之间存在 TOCTOU 窗口，
 * DNS rebinding 不强求完全防护（注释即文档）；完整防护需自定义 Agent 固定连接 IP。
 * @param {string} hostname
 * @param {Function} lookupImpl 可注入（单测），默认 dns.promises.lookup(all: true)
 */
export async function assertPublicDnsHost(hostname, lookupImpl) {
  const lookup =
    lookupImpl ||
    ((hn) => import('node:dns').then((dns) => dns.promises.lookup(hn, { all: true })))
  let records
  try {
    records = await lookup(hostname)
  } catch {
    return // DNS 解析失败交由后续 fetch 报错，此处不放大错误
  }
  const addrs = Array.isArray(records) ? records : [records]
  for (const rec of addrs) {
    const address = typeof rec === 'string' ? rec : rec?.address
    if (!address) continue
    const numeric = parseIpv4Numeric(address)
    if (numeric !== null && isPrivateIpv4Value(numeric)) {
      throw Object.assign(
        new Error(`SSRF 防护：${hostname} 解析到内网地址 ${address}，已拒绝下载`),
        { status: 400 }
      )
    }
  }
}

/**
 * 下载远程文件到临时目录（流式 + 500MB 上限）。
 * O4 加固：
 * - redirect: 'manual' 逐跳复检 SSRF（最多 3 跳），302 指向内网不再绕过校验
 * - 下载前 DNS 解析结果私网校验（尽力而为，见 assertPublicDnsHost 注释）
 * @returns {Promise<string>} 临时文件路径
 */
export async function downloadToTemp(
  url,
  destDir,
  { fetchImpl = fetch, maxBytes = RENDER_DOWNLOAD_MAX_BYTES, maxRedirects = 3, dnsLookupImpl } = {}
) {
  let currentUrl = url
  let resp = null
  for (let hop = 0; hop <= maxRedirects; hop++) {
    // 每一跳都重新走完整 URL 校验（协议白名单 + 内网段 + 非标准 IP 形态）
    const check = validateRenderUrl(currentUrl)
    if (!check.ok || check.kind !== 'remote') {
      throw Object.assign(new Error(check.error || `${currentUrl} 非法`), { status: 400 })
    }
    try {
      await assertPublicDnsHost(new URL(currentUrl).hostname, dnsLookupImpl)
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { status: err?.status || 400 })
    }

    resp = await fetchImpl(currentUrl, { redirect: 'manual' })
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location')
      if (!location) {
        throw Object.assign(new Error(`下载失败：重定向响应缺少 Location 头（HTTP ${resp.status}）`), { status: 502 })
      }
      if (hop === maxRedirects) {
        throw Object.assign(new Error(`下载失败：重定向次数超过 ${maxRedirects} 跳上限`), { status: 502 })
      }
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }
    break
  }

  if (!resp.ok || !resp.body) {
    throw Object.assign(new Error(`下载失败：HTTP ${resp.status}`), { status: 502 })
  }
  const declared = Number(resp.headers.get('content-length') || 0)
  if (declared > maxBytes) {
    throw Object.assign(new Error(`下载文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`), { status: 413 })
  }

  // Web ReadableStream → Node 流（Node 18+ 可直接 fromWeb，此处手工桥接保持零额外依赖）
  const nodeStream = Readable.fromWeb(resp.body)
  const ext = guessExt(currentUrl)
  const dest = join(destDir, `dl-${Date.now().toString(36)}${ext}`)

  let received = 0
  nodeStream.on('data', (chunk) => {
    received += chunk.length
    if (received > maxBytes) {
      nodeStream.destroy(Object.assign(new Error(`下载超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`), { status: 413 }))
    }
  })

  await pipeline(nodeStream, createWriteStream(dest))
  return dest
}

function guessExt(url) {
  const clean = url.split('?')[0].split('#')[0].toLowerCase()
  for (const ext of ['.mp4', '.webm', '.mov', '.mp3', '.m4a', '.wav']) {
    if (clean.endsWith(ext)) return ext
  }
  return '.bin'
}

/**
 * 执行 ffmpeg 合成。
 * @param {object} opts
 * @param {string} opts.ffmpegPath ffmpeg 二进制
 * @param {string} opts.videoPath 本地视频文件
 * @param {string|null} opts.audioPath 本地音频文件（可空）
 * @param {string|null} opts.srtPath 本地字幕文件（可空，软封 mov_text）
 * @param {string} opts.outPath 输出 mp4 路径
 * @param {number} [opts.timeoutSec] 超时（秒），超时 kill 子进程
 * @param {Function} [opts.spawnImpl] spawn 注入点（单测用 fake 子进程，默认 node:child_process.spawn）
 * @returns {Promise<{ bytes: number }>}
 */
export function runFfmpeg({ ffmpegPath, videoPath, audioPath, srtPath, outPath, timeoutSec = RENDER_DEFAULT_TIMEOUT_SEC, spawnImpl = spawn }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = ['-y', '-i', videoPath]
    if (audioPath) args.push('-i', audioPath)
    if (srtPath) args.push('-i', srtPath)

    if (audioPath) {
      // 视频流拷贝 + 音频重编码 aac，时长对齐较短一方
      args.push('-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest')
    } else {
      args.push('-c:v', 'copy', '-c:a', 'copy')
    }
    if (srtPath) {
      // 字幕软封：mov_text（mp4 标准字幕轨），不重编码视频
      args.push('-map', srtPath && audioPath ? '2:s:0' : '1:s:0', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=chi')
    }
    args.push('-movflags', '+faststart', outPath)

    let stderrTail = ''
    const child = spawnImpl(ffmpegPath, args, { windowsHide: true })
    child.stderr.on('data', (d) => {
      // 只保留尾部 4KB 诊断信息，防大日志撑爆内存
      stderrTail = (stderrTail + String(d)).slice(-4096)
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectPromise(
        Object.assign(new Error(`ffmpeg 渲染超时（>${timeoutSec}s），已终止`), { code: 'WLS_RENDER_TIMEOUT', status: 504, stderrTail })
      )
    }, timeoutSec * 1000)

    child.on('error', (err) => {
      clearTimeout(timer)
      rejectPromise(Object.assign(new Error(`ffmpeg 启动失败：${err.message}`), { status: 500 }))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolvePromise({ bytes: statSync(outPath).size })
        return
      }
      rejectPromise(
        Object.assign(new Error(`ffmpeg 退出码 ${code}：${stderrTail.split('\n').slice(-6).join(' | ').slice(0, 600)}`), {
          code: 'WLS_FFMPEG_FAIL',
          status: 502,
          exitCode: code,
        })
      )
    })
  })
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/**
 * 读取 JSON 请求体（R2 修复：超限 / 中途断开均不再挂起）。
 * - 超限：先回写 413（Connection: close）再 destroy 并 reject —— 此前只 destroy 不回应，
 *   await 永挂 → /api/render 互斥锁 release 永不执行 → 后续所有请求永久 429。
 * - req 'close'/'aborted'（未正常 end 即断开）→ reject，防止 Promise 永挂。
 * 调用方 catch 中须先判 res.headersSent（413 已直接回写）避免二次响应。
 */
function readJsonBody(req, maxBytes, res) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    let overflow = false
    let settled = false
    const finish = (err, data) => {
      if (settled) return
      settled = true
      if (err) rejectBody(err)
      else resolveBody(data)
    }
    const tooLargeErr = () => Object.assign(new Error('body too large'), { code: 'WLS_BODY_TOO_LARGE' })

    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        overflow = true
        if (res && !res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' })
          res.end(JSON.stringify({ error: '请求体超过上限' }))
        }
        // resume 排空剩余 body（body-parser 同款）：socket 有未读数据时关闭会发 RST，
        // 客户端会丢弃 413 响应只见 ECONNRESET；排空后连接干净关闭，413 可正常送达
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
 * 构造 POST /api/render 处理器。
 * ffmpegPath / fetchImpl 可注入供单测（fake 二进制 / mock 下载），不依赖真实环境。
 */
export function createRenderHandler({
  enabled,
  ffmpegPath,
  renderDir,
  ttsDir,
  timeoutSec = RENDER_DEFAULT_TIMEOUT_SEC,
  logger,
  fetchImpl,
  spawnImpl,
}) {
  const mutex = createRenderMutex()

  return function handleRender(req, res, urlPath) {
    if (urlPath !== '/api/render') {
      sendJson(res, 404, { error: '未知 render 路由' })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: '仅支持 POST' })
      return
    }
    if (!enabled) {
      sendJson(res, 501, { error: '渲染未启用（WLS_FFMPEG=off）。设置 WLS_FFMPEG=auto 并安装 ffmpeg 后启用。' })
      return
    }
    if (!ffmpegPath) {
      sendJson(res, 501, {
        error: '未检测到 ffmpeg。请安装 ffmpeg（Windows: winget install ffmpeg / Docker 镜像已内置）后重启服务。',
      })
      return
    }
    if (mutex.isBusy) {
      sendJson(res, 429, { error: '已有渲染任务进行中（同一时间最多 1 个），请稍后重试' })
      return
    }

    void (async () => {
      await mutex.acquire()
      let tmpCleanup = null
      let outPath = null
      try {
        let body
        try {
          body = JSON.parse((await readJsonBody(req, 1024 * 1024, res)).toString('utf8'))
        } catch (err) {
          // R2：超限 413 已由 readJsonBody 直接回写（headersSent = true），不再二次响应
          if (res.headersSent) return
          const tooLarge = err instanceof Error && err.message === 'body too large'
          sendJson(res, 413, { error: tooLarge ? '请求体超过上限' : '请求体必须是合法 JSON' })
          return
        }

        const check = validateRenderBody(body)
        if (!check.ok) {
          sendJson(res, 400, { error: check.error })
          return
        }

        // 临时工作目录：远程下载 + ffmpeg 中间产物
        const tmpDir = mkdtempSync(join(tmpdir(), 'wls-render-'))
        tmpCleanup = () => rmSync(tmpDir, { recursive: true, force: true })

        // 1. 解析视频来源
        let videoPath
        if (check.videoKind === 'local') {
          const p = resolveLocalAsset(check.videoUrl, { ttsDir, renderDir })
          if (!p || !existsSync(p)) {
            sendJson(res, 404, { error: `本站素材不存在：${check.videoUrl}` })
            return
          }
          videoPath = p
        } else {
          try {
            videoPath = await downloadToTemp(check.videoUrl, tmpDir, { fetchImpl })
          } catch (err) {
            sendJson(res, err?.status || 502, { error: `视频下载失败：${err instanceof Error ? err.message : String(err)}` })
            return
          }
        }

        // 2. 解析音频来源
        let audioPath = null
        if (check.audioUrl) {
          if (check.audioKind === 'local') {
            const p = resolveLocalAsset(check.audioUrl, { ttsDir, renderDir })
            if (!p || !existsSync(p)) {
              sendJson(res, 404, { error: `本站音频不存在：${check.audioUrl}` })
              return
            }
            audioPath = p
          } else {
            try {
              audioPath = await downloadToTemp(check.audioUrl, tmpDir, { fetchImpl })
            } catch (err) {
              sendJson(res, err?.status || 502, { error: `音频下载失败：${err instanceof Error ? err.message : String(err)}` })
              return
            }
          }
        }

        // 3. 字幕落盘（软封）
        let srtPath = null
        if (check.subtitleSrt) {
          srtPath = join(tmpDir, `sub-${Date.now().toString(36)}.srt`)
          writeFileSync(srtPath, check.subtitleSrt, 'utf8')
        }

        // 4. ffmpeg 合成（copy 优先，失败回退重编码）
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        mkdirSync(renderDir, { recursive: true })
        const outName = `render_${stamp}.mp4`
        outPath = join(renderDir, outName)

        let result
        try {
          result = await runFfmpeg({ ffmpegPath, videoPath, audioPath, srtPath, outPath, timeoutSec, spawnImpl })
        } catch (err) {
          if (err?.code === 'WLS_FFMPEG_FAIL' && !videoPath.endsWith('.mp4')) {
            // 容器不兼容（如 webm/vp9 → mp4 copy 失败）：回退 libx264 重编码
            logger?.info?.('[render] -c copy 失败，回退 libx264 重编码')
            try {
              unlinkSync(outPath)
            } catch {}
            const reArgs = { ffmpegPath, videoPath, audioPath, srtPath, outPath, timeoutSec, spawnImpl }
            result = await runFfmpegReencode(reArgs)
          } else {
            throw err
          }
        }

        logger?.info?.({ file: outName, bytes: result.bytes }, '[render] 合成完成')
        sendJson(res, 200, {
          url: `/files/render/${outName}`,
          path: outPath,
          bytes: result.bytes,
        })
      } catch (err) {
        // O3 修复：失败 / 超时 / 重编码失败路径统一清理残留输出。
        // 此前 ffmpeg 中途被 kill 或退出非零时可能留下损坏 mp4，被 /files/render 命中播放坏片。
        if (outPath) {
          try {
            unlinkSync(outPath)
          } catch {}
        }
        logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, '[render] 合成失败')
        if (res.headersSent) {
          res.destroy()
          return
        }
        sendJson(res, err?.status || 500, {
          error: `渲染失败：${err instanceof Error ? err.message : String(err)}`,
        })
      } finally {
        try {
          tmpCleanup?.()
        } catch {}
        mutex.release()
      }
    })()
  }
}

/** 重编码回退：libx264 + aac（webm/vp9 等容器不兼容时） */
function runFfmpegReencode({ ffmpegPath, videoPath, audioPath, srtPath, outPath, timeoutSec, spawnImpl = spawn }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = ['-y', '-i', videoPath]
    if (audioPath) args.push('-i', audioPath)
    if (srtPath) args.push('-i', srtPath)
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p')
    if (audioPath) {
      args.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest')
    } else {
      args.push('-an')
    }
    if (srtPath) {
      args.push('-map', audioPath ? '2:s:0' : '1:s:0', '-c:s', 'mov_text')
    }
    args.push('-movflags', '+faststart', outPath)

    let stderrTail = ''
    const child = spawnImpl(ffmpegPath, args, { windowsHide: true })
    child.stderr.on('data', (d) => {
      stderrTail = (stderrTail + String(d)).slice(-4096)
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectPromise(Object.assign(new Error(`ffmpeg 渲染超时（>${timeoutSec}s），已终止`), { code: 'WLS_RENDER_TIMEOUT', status: 504 }))
    }, timeoutSec * 1000)
    child.on('error', (err) => {
      clearTimeout(timer)
      rejectPromise(Object.assign(new Error(`ffmpeg 启动失败：${err.message}`), { status: 500 }))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolvePromise({ bytes: statSync(outPath).size })
        return
      }
      rejectPromise(
        Object.assign(new Error(`ffmpeg 重编码退出码 ${code}：${stderrTail.split('\n').slice(-6).join(' | ').slice(0, 600)}`), {
          code: 'WLS_FFMPEG_FAIL',
          status: 502,
        })
      )
    })
  })
}

/** GET /files/render/<name>.mp4 静态成片服务（文件名白名单防路径穿越） */
export function createRenderFileHandler({ renderDir }) {
  return function serveRenderFile(req, res, urlPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: '仅支持 GET/HEAD' })
      return
    }
    let name
    try {
      name = decodeURIComponent(urlPath.slice('/files/render/'.length))
    } catch {
      sendJson(res, 400, { error: '非法成片文件名' })
      return
    }
    if (!/^render_[A-Za-z0-9-]+\.mp4$/.test(name)) {
      sendJson(res, 400, { error: '非法成片文件名' })
      return
    }
    const filePath = join(renderDir, name)
    let size
    try {
      size = statSync(filePath).size
    } catch {
      sendJson(res, 404, { error: '成片文件不存在' })
      return
    }
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
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
