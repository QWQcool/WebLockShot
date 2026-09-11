#!/usr/bin/env node
/**
 * WebLockShot 本地伴生服务 (Companion Server)
 *
 * 能力：
 * 1. 静态托管 dist/（生产构建后的纯前端应用）
 * 2. /api/kling、/api/jimeng、/api/comfyui 反向代理（生产环境也能直连 ComfyUI 与视频 API，规避浏览器跨域）
 * 3. POST /api/jianying/draft-zip：接收剪映草稿 zip 并解压到本地草稿目录，省去手动解压
 * 4. （预留）GET /healthz：版本 / 存储模式 / uptime 等自观测
 * 5. （预留）PUT/GET/DELETE /api/sessions/:id：会话快照存取（BackendAdapter rest 模式后端）
 * 6. （预留）/api/llm 反代：设置 WLS_LLM_TARGET 后启用，未设置返回 501
 * 7. （预留）WLS_KEYS：设置后反代注入真实密钥 Authorization 头；未设置 = 透传模式（现状）
 * 8. /api/connectors（D4/D8）：连接器目录 + auth 占位 + run（GitHub 标杆连接器，需 WLS_GITHUB_TOKEN）
 *    /healthz 能力位 connectors: 'interface' | 'ready'（D8：检测到 @modelcontextprotocol/sdk 后切 ready）
 * 9. /api/mcp/*（D8，可选依赖）：反向驱动画布桥接（画布拓扑镜像 + Agent 操作队列）
 *    /healthz 能力位 mcp: 'ready' | 'off'；未装 SDK = 全部 501 + 安装指引，服务器零报错
 *
 * 用法：
 *   npx weblockshot                 # 默认端口 5174
 *   node server/weblockshot-server.mjs --port 8080 --dist ./dist --draft-dir ./jianying-drafts
 *
 * 环境变量：PORT / DIST_DIR / DRAFT_DIR / WLS_STORAGE(memory|sqlite) / WLS_SQLITE_PATH /
 *          WLS_LLM_TARGET / WLS_KEYS(JSON) / WLS_LOG_LEVEL / SENTRY_DSN（命令行参数优先）
 *          WLS_AUTH_TOKEN（设置后所有 /api/* 需携带 x-wls-token 或 Authorization Bearer，不匹配 401）
 *          WLS_HOST（默认 127.0.0.1；公网部署必须 0.0.0.0 且强制配置 WLS_AUTH_TOKEN）
 *          WLS_MAX_UNZIP_MB（draft-zip 累计解压字节上限，默认 1024MB）
 *          WLS_TTS（=off 关闭 Edge-TTS 语音合成，/api/tts 返回 501；默认 on）
 *          TTS_DIR（mp3 落盘目录，默认 data/tts）
 *          WLS_FFMPEG（=off 关闭成片合成，/api/render 返回 501；默认 auto 探测 ffmpeg）
 *          RENDER_DIR（成片落盘目录，默认 data/render）
 *          WLS_RENDER_TIMEOUT_SEC（单渲染任务超时秒数，默认 600）
 */
import http from 'node:http'
import https from 'node:https'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractZip, safeEntryName } from './zip-extract.mjs'
import { createLogger } from './logger.mjs'
import { createStorage } from './storage.mjs'
import { createTtsHandler, createTtsFileHandler } from './tts.mjs'
import { createRenderHandler, createRenderFileHandler, detectFfmpeg, RENDER_DEFAULT_TIMEOUT_SEC } from './render.mjs'
import { createMemoryHandler } from './memory.mjs'
import { createConnectorsHandler } from './connectors.mjs'
import { createMcpHandler, detectMcpSdk } from './mcp.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const STARTED_AT = Date.now()

let PKG_VERSION = '0.0.0'
try {
  PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'
} catch {}

// ---------------- 参数解析 ----------------
function parseArgs(argv, env = process.env) {
  const args = {
    port: Number(env.PORT) || 5174,
    dist: env.DIST_DIR,
    draftDir: env.DRAFT_DIR,
    storageMode: env.WLS_STORAGE || 'memory',
    sqlitePath: env.WLS_SQLITE_PATH,
    llmTarget: env.WLS_LLM_TARGET,
    keysRaw: env.WLS_KEYS,
    sentryDsn: env.SENTRY_DSN,
    logLevel: env.WLS_LOG_LEVEL,
    // 共享 token 鉴权：设置后所有 /api/* 请求须带 x-wls-token 头（或 Authorization Bearer）；
    // 未设置 = 不鉴权（本地模式现状不变）。默认监听 127.0.0.1，公网部署须显式 WLS_HOST=0.0.0.0
    // 且强制配置 WLS_AUTH_TOKEN。
    authToken: env.WLS_AUTH_TOKEN?.trim() || undefined,
    // D8 正向标杆连接器：GitHub PAT（只存服务端，不落前端）
    githubToken: env.WLS_GITHUB_TOKEN?.trim() || undefined,
    host: env.WLS_HOST || '127.0.0.1',
    maxUnzipMb: Number(env.WLS_MAX_UNZIP_MB) || 1024,
    // Edge-TTS 语音合成开关（P1-1）：'off' 关闭（/api/tts 返回 501），默认 on
    tts: env.WLS_TTS === 'off' ? 'off' : 'on',
    ttsDir: env.TTS_DIR,
    // ffmpeg 成片合成开关（P1-2）：auto（默认，探测二进制）| off（/api/render 返回 501）
    ffmpeg: env.WLS_FFMPEG === 'off' ? 'off' : 'auto',
    renderDir: env.RENDER_DIR,
    renderTimeoutSec: Number(env.WLS_RENDER_TIMEOUT_SEC) || RENDER_DEFAULT_TIMEOUT_SEC,
    // 反代上游空闲超时（连接+响应共用，秒）：默认 60s（O5）
    proxyTimeoutSec: Number(env.WLS_PROXY_TIMEOUT_SEC) || 60,
    // Edge-TTS 单次合成超时（秒）：默认 60s（O6）
    ttsTimeoutSec: Number(env.WLS_TTS_TIMEOUT_SEC) || 60,
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]) || args.port
    else if (argv[i] === '--dist') args.dist = argv[++i]
    else if (argv[i] === '--draft-dir') args.draftDir = argv[++i]
  }
  args.dist = resolve(args.dist || join(ROOT, 'dist'))
  args.draftDir = resolve(args.draftDir || join(ROOT, 'jianying-drafts'))
  args.ttsDir = resolve(args.ttsDir || join(ROOT, 'data', 'tts'))
  args.renderDir = resolve(args.renderDir || join(ROOT, 'data', 'render'))
  return args
}

/**
 * 解析 WLS_KEYS（预留）：JSON 格式 {"kling":"Bearer xxx","jimeng":"...","llm":"..."}。
 * 设置后对应引擎反代会注入 Authorization 头（并覆盖客户端传入值）；未设置 = 透传模式。
 */
export function parseWlsKeys(raw, logger) {
  if (!raw || !raw.trim()) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const keys = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.trim()) keys[k.toLowerCase()] = v.trim()
      }
      return keys
    }
    throw new Error('WLS_KEYS 必须是字符串到字符串的 JSON 对象')
  } catch (err) {
    logger?.warn?.({ err: err.message }, 'WLS_KEYS 解析失败，反代保持透传模式')
    return null
  }
}

// ---------------- 反向代理 ----------------
const BASE_PROXY_ROUTES = [
  { name: 'kling', prefix: '/api/kling', target: 'https://api.klingai.com' },
  { name: 'jimeng', prefix: '/api/jimeng', target: 'https://api.jimeng.bytedance.com' },
  { name: 'comfyui', prefix: '/api/comfyui', target: 'http://127.0.0.1:8188' },
]

/** hop-by-hop 头：不应随代理转发（RFC 7230） */
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

function respondJson(res, status, payload) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/**
 * 反向代理（R3 + O5 加固）：
 * - 剥离本服务敏感头（x-wls-token / cookie）与 hop-by-hop 头；客户端自带 Authorization 保留
 *   （透传语义：那是用户自己的引擎密钥）
 * - proxyRes 与 proxyReq 均挂 error 监听：上游中途断流不再触发未捕获异常进程崩溃
 * - 所有错误回写前判 res.headersSent，避免 ERR_HTTP_HEADERS_SENT 二次崩溃
 * - 上游空闲超时（连接 + 响应停顿共用）→ 504
 */
function proxyRequest(req, res, route, keys, logger, { timeoutSec = 60 } = {}) {
  const targetPath = req.url.slice(route.prefix.length) || '/'
  const url = new URL(targetPath, route.target)
  const isHttps = url.protocol === 'https:'
  const mod = isHttps ? https : http

  const headers = { ...req.headers }
  delete headers.host
  delete headers.origin
  delete headers.referer
  // O5：剥离本服务鉴权头与会话 cookie，不得泄漏给上游引擎
  delete headers['x-wls-token']
  delete headers.cookie
  for (const h of HOP_BY_HOP_HEADERS) delete headers[h]

  // 预留：WLS_KEYS 注入真实密钥（覆盖客户端 Authorization）；未设置 = 透传
  const injectedKey = keys?.[route.name]
  if (injectedKey) {
    headers.authorization = injectedKey
  }

  const proxyReq = mod.request(
    {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
      // R3：上游响应流中途断流（socket destroyed）→ 只终止客户端响应，进程不死
      proxyRes.on('error', (err) => {
        logger?.warn?.({ route: route.name, err: err.message }, '代理上游响应流中断')
        res.destroy()
      })
      proxyRes.pipe(res)
    }
  )

  // O5：上游空闲超时（覆盖连接建立与响应中途停顿），默认 60s（WLS_PROXY_TIMEOUT_SEC 可调）
  proxyReq.setTimeout(timeoutSec * 1000, () => {
    logger?.warn?.({ route: route.name, timeoutSec }, '代理上游超时')
    // destroy(err) 会触发下方 'error' 回调，由其统一回写 504（避免与 end 竞态截断响应）
    proxyReq.destroy(new Error(`上游超时（>${timeoutSec}s 无响应）`))
  })

  proxyReq.on('error', (err) => {
    logger?.warn?.({ route: route.name, err: err.message }, '代理请求失败')
    // R3：headers 已发出（流式中断）只能销毁连接，否则 writeHead 抛 ERR_HTTP_HEADERS_SENT
    if (res.headersSent) {
      res.destroy()
      return
    }
    const isTimeout = err.message?.includes('上游超时')
    respondJson(res, isTimeout ? 504 : 502, {
      error: isTimeout ? err.message : `代理请求失败: ${err.message}`,
    })
  })

  // 客户端提前断开：同步终止上游请求，避免孤儿连接
  req.on('aborted', () => proxyReq.destroy())
  req.on('error', () => proxyReq.destroy())

  req.pipe(proxyReq)
}

// ---------------- 剪映草稿落盘 ----------------
async function handleDraftZip(req, res, args, logger) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '仅支持 POST' }))
    return
  }

  const chunks = []
  let size = 0
  const MAX = 200 * 1024 * 1024 // 200MB 上限
  let tooLarge = false

  req.on('data', (chunk) => {
    size += chunk.length
    if (size > MAX) {
      if (tooLarge) return
      tooLarge = true
      // R2 修复：destroy 前先回 413 并结束响应。此前只 destroy 不回应，
      // 'end' 永不触发 → 分支内 writeHead(413) 成为死代码，客户端连接被裸重置。
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' })
      res.end(JSON.stringify({ error: 'zip 超过 200MB 上限' }))
      req.destroy()
      return
    }
    chunks.push(chunk)
  })

  req.on('end', () => {
    if (tooLarge) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'zip 超过 200MB 上限' }))
      return
    }

    try {
      const buf = Buffer.concat(chunks)
      // zip bomb 防护：累计解压字节配额（WLS_MAX_UNZIP_MB，默认 1GB），超限中止
      const entries = extractZip(buf, { maxBytes: args.maxUnzipMb * 1024 * 1024 })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const targetDir = join(args.draftDir, `draft_${stamp}`)
      mkdirSync(targetDir, { recursive: true })

      const written = []
      for (const entry of entries) {
        const safeName = safeEntryName(entry.name)
        if (!safeName) continue
        const outPath = join(targetDir, safeName)
        mkdirSync(resolve(outPath, '..'), { recursive: true })
        writeFileSync(outPath, entry.data)
        written.push(safeName)
      }

      logger.info({ files: written.length, dir: targetDir }, '[draft-zip] 已解压')
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, dir: targetDir, savedPath: targetDir, files: written }))
    } catch (err) {
      const isQuota = err instanceof Error && err.code === 'WLS_UNZIP_QUOTA'
      res.writeHead(isQuota ? 413 : 400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: `zip 解压失败: ${err instanceof Error ? err.message : String(err)}` }))
    }
  })
}

// ---------------- 会话存储 API（预留，BackendAdapter rest 模式后端） ----------------
const SESSION_BODY_MAX = 8 * 1024 * 1024 // 8MB

/**
 * 读取请求体（R2 修复：超限 / 中途断开均不再挂起）。
 * - 超限：先回写 413（Connection: close）再 destroy，随后 reject —— 调用方 catch 中须判
 *   res.headersSent 避免二次回写。此前只 destroy 不回应，await 永挂 → 互斥锁等资源永久饿死。
 * - req 'close'/'aborted'（未正常 end 即断开）→ reject，防止 Promise 永挂。
 * @returns {Promise<Buffer>}
 */
function readBody(req, maxBytes, res) {
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
        // resume 排空剩余 body，避免 socket 未读数据触发 RST 令客户端丢弃 413（见 render.mjs 注释）
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
      // 正常路径 end 已 settle；未 end 即 close = 客户端中途断开
      if (!settled && !req.readableEnded) onAborted()
    })
  })
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/**
 * 容错 URI 解码：畸形转义序列（如 GET /%zz）会让 decodeURIComponent 抛 URIError。
 * 静态路径回退原始字符串；会话 API 等严格场景由调用方根据 needsValid 语义返回 400。
 */
function safeDecodeUriComponent(raw) {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

/** 解码失败时回退原始字符串（用于静态路径等宽松场景） */
function decodeUrlLenient(raw) {
  return safeDecodeUriComponent(raw) ?? raw
}

async function handleSessionApi(req, res, urlPath, storage) {
  const id = safeDecodeUriComponent(urlPath.slice('/api/sessions/'.length))
  if (!id || id.includes('/')) {
    // 畸形转义序列（%zz 等）解码失败 → 明确 400，而非 URIError 崩溃
    sendJson(res, 400, { error: '无效的会话 id' })
    return
  }

  try {
    if (req.method === 'GET') {
      const raw = storage.get(id)
      if (raw == null) {
        sendJson(res, 404, { error: '会话不存在' })
        return
      }
      sendJson(res, 200, { id, data: JSON.parse(raw) })
      return
    }

    if (req.method === 'PUT') {
      const buf = await readBody(req, SESSION_BODY_MAX, res)
      const parsed = JSON.parse(buf.toString('utf8'))
      const data = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed
      if (!data || typeof data !== 'object') {
        sendJson(res, 400, { error: '会话内容必须是 JSON 对象' })
        return
      }
      storage.set(id, JSON.stringify(data))
      sendJson(res, 200, { ok: true, id })
      return
    }

    if (req.method === 'DELETE') {
      storage.delete(id)
      sendJson(res, 200, { ok: true, id })
      return
    }

    sendJson(res, 405, { error: '仅支持 GET/PUT/DELETE' })
  } catch (err) {
    // R2：超限 413 已由 readBody 直接回写（headersSent = true），此处不再二次回写
    if (res.headersSent) return
    const tooLarge = err instanceof Error && err.message === 'body too large'
    sendJson(res, tooLarge ? 413 : 400, {
      error: tooLarge ? '会话快照超过 8MB 上限' : `会话操作失败: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

// ---------------- 静态托管 ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
}

function serveStatic(req, res, distDir) {
  let filePath = join(distDir, decodeUrlLenient(req.url.split('?')[0]))
  // O12 修复：前缀比较必须带路径分隔符，否则 /dist-evil 等同前缀兄弟目录会绕过校验
  const withinDist = filePath === distDir || filePath.startsWith(distDir + sep)
  if (req.url === '/' || !withinDist) {
    filePath = join(distDir, 'index.html')
  }

  try {
    const s = statSync(filePath)
    if (s.isDirectory()) filePath = join(filePath, 'index.html')
  } catch {
    // 带扩展名的未知路径语义上应为 404（而非 SPA 回退），避免吞掉真实的资源 404
    if (extname(req.url.split('?')[0])) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
    // SPA 回退（无扩展名的路由路径）
    filePath = join(distDir, 'index.html')
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('dist/ 不存在，请先执行 npm run build')
    return
  }

  res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' })
  // O7：stat 与 open 之间存在竞态（文件被删/损坏），流 error 必须被消费，否则未捕获 error 事件崩溃进程
  createReadStream(filePath).on('error', () => {
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
    res.destroy()
  }).pipe(res)
}

// ---------------- 服务工厂（CLI 与测试共用） ----------------
export async function startServer(opts = {}) {
  const args = parseArgs(opts.argv || process.argv.slice(2), opts.env || process.env)
  // dist 支持注入（O12 测试暴露：此前 opts.dist 被静默忽略，测试注入的 dist 目录
  // 不生效——Windows 本机因恰好存在已构建的仓库 dist 而侥幸通过，CI 无 dist 即失败）
  const distDir = opts.dist !== undefined ? resolve(opts.dist) : args.dist
  const logger = opts.logger || createLogger({ level: args.logLevel })
  const storage = opts.storage || (await createStorage({ mode: args.storageMode, sqlitePath: args.sqlitePath, logger }))
  const keys = opts.keys !== undefined ? opts.keys : parseWlsKeys(args.keysRaw, logger)
  const llmTarget = opts.llmTarget !== undefined ? opts.llmTarget : args.llmTarget

  if (args.sentryDsn) {
    // 预留：当前版本未接入 Sentry SDK；DSN 配置仅作为声明与 healthz 观测，行为为 no-op
    logger.warn({ sentry: 'no-op' }, 'SENTRY_DSN 已配置，但当前版本未接入 Sentry SDK（预留项，无行为影响）')
  }

  const proxyRoutes = [...BASE_PROXY_ROUTES]
  if (llmTarget) {
    proxyRoutes.push({ name: 'llm', prefix: '/api/llm', target: llmTarget })
  }
  // O5：反代上游空闲超时可注入（单测用短超时），默认走 args（60s，WLS_PROXY_TIMEOUT_SEC 可调）
  const proxyTimeoutSec = opts.proxyTimeoutSec !== undefined ? opts.proxyTimeoutSec : args.proxyTimeoutSec

  // Edge-TTS 能力（P1-1）：synth 可注入 mock 供协议层单测（不依赖网络）
  const ttsEnabled = opts.tts !== undefined ? opts.tts : args.tts === 'on'
  const ttsDir = opts.ttsDir !== undefined ? opts.ttsDir : args.ttsDir
  const ttsTimeoutSec = opts.ttsTimeoutSec !== undefined ? opts.ttsTimeoutSec : args.ttsTimeoutSec
  const ttsHandler = createTtsHandler({ enabled: ttsEnabled, ttsDir, logger, synth: opts.ttsSynth, timeoutSec: ttsTimeoutSec })
  const ttsFileHandler = createTtsFileHandler({ ttsDir })

  // ffmpeg 成片合成能力（P1-2）：启动时探测一次二进制；ffmpegPath 可注入供单测
  const ffmpegEnabled = opts.ffmpeg !== undefined ? opts.ffmpeg : args.ffmpeg === 'auto'
  const ffmpegPath = ffmpegEnabled ? (opts.ffmpegPath !== undefined ? opts.ffmpegPath : detectFfmpeg()) : null
  const renderDir = opts.renderDir !== undefined ? opts.renderDir : args.renderDir
  const renderHandler = createRenderHandler({
    enabled: ffmpegEnabled,
    ffmpegPath,
    renderDir,
    ttsDir,
    timeoutSec: args.renderTimeoutSec,
    logger,
    fetchImpl: opts.renderFetchImpl,
    spawnImpl: opts.renderSpawnImpl,
  })
  const renderFileHandler = createRenderFileHandler({ renderDir })

  // 记忆系统能力（S3）：仅 sqlite 存储模式启用（跨刷新持久化）；healthz 能力位 memory: sqlite|off
  const memoryEnabled = opts.memory !== undefined ? opts.memory : storage.mode === 'sqlite'
  const memoryHandler = createMemoryHandler({ enabled: memoryEnabled, storage, logger })

  // D8：可选依赖 @modelcontextprotocol/sdk 动态探测（未装 = 零依赖现状；绝不静态 import）
  const mcpSdkInstalled =
    opts.mcpSdkInstalled !== undefined
      ? opts.mcpSdkInstalled
      : await detectMcpSdk(opts.mcpSdkImport)
  // D4/D8 连接器：SDK 已装 = 'ready'（正向标杆连接器 + 反向 MCP 桥接开放），否则 'interface'（现状）
  const connectorsMode =
    opts.connectorsMode !== undefined ? opts.connectorsMode : mcpSdkInstalled ? 'ready' : 'interface'
  const connectorsHandler = createConnectorsHandler({
    mode: connectorsMode,
    logger,
    githubToken: args.githubToken,
    fetchImpl: opts.connectorFetchImpl,
  })
  const mcpHandler = createMcpHandler({ ready: mcpSdkInstalled, store: storage, logger })

  const healthPayload = () => ({
    ok: true,
    version: PKG_VERSION,
    storage: storage.mode,
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    node: process.version,
    keyMode: keys ? 'injected' : 'passthrough',
    llmProxy: llmTarget ? 'on' : 'off',
    sentry: args.sentryDsn ? 'configured' : 'off',
    authMode: args.authToken ? 'token' : 'off',
    // 能力位（P1 前端探测后才显示新按钮）
    tts: args.tts,
    ffmpeg: ffmpegEnabled && ffmpegPath ? 'on' : 'off',
    memory: memoryEnabled ? 'sqlite' : 'off',
    connectors: connectorsMode,
    mcp: mcpSdkInstalled ? 'ready' : 'off',
  })

  /** 校验共享 token：x-wls-token 头或 Authorization: Bearer <token> */
  const isAuthorized = (req) => {
    if (!args.authToken) return true
    const headerToken = req.headers['x-wls-token']
    if (typeof headerToken === 'string' && headerToken === args.authToken) return true
    const auth = req.headers.authorization
    if (typeof auth === 'string' && auth.startsWith('Bearer ') && auth.slice(7) === args.authToken) return true
    return false
  }

  const handler = (req, res) => {
    const urlPath = req.url.split('?')[0]

    if (urlPath === '/healthz') {
      sendJson(res, 200, healthPayload())
      return
    }

    // 共享 token 鉴权：仅覆盖 /api/*；healthz 与静态资源保持开放（本地模式现状不变）
    if (urlPath.startsWith('/api/') && !isAuthorized(req)) {
      sendJson(res, 401, { error: '未授权：请携带 x-wls-token 请求头（或 Authorization Bearer）' })
      return
    }

    if (urlPath.startsWith('/api/sessions/')) {
      handleSessionApi(req, res, urlPath, storage).catch((err) => {
        // 兜底：未预期的 rejection 不再裸 void 丢弃（原先会变成 unhandled rejection）
        logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, '会话 API 处理异常')
        if (!res.headersSent) {
          sendJson(res, 500, { error: '会话 API 内部错误' })
        } else {
          res.end()
        }
      })
      return
    }

    // 预留：存储配额端点（local adapter 语义对齐；本地磁盘不设硬配额）
    if (urlPath === '/api/quota') {
      sendJson(res, 200, { usageBytes: null, quotaBytes: null })
      return
    }

    const route = proxyRoutes.find((r) => urlPath.startsWith(r.prefix))
    if (route) {
      proxyRequest(req, res, route, keys, logger, { timeoutSec: proxyTimeoutSec })
      return
    }

    if (urlPath.startsWith('/api/llm')) {
      // 预留接口：未配置 WLS_LLM_TARGET 时明确 501，而非静默 404
      sendJson(res, 501, {
        error: 'LLM 反代未启用（预留接口）。设置 WLS_LLM_TARGET 后本路由将反向代理至目标 LLM API。',
      })
      return
    }

    // MCP 桥接（D8）：/api/mcp/*（SDK 未装 = 501 + 安装指引；装了 = 反向驱动画布可用）
    if (urlPath === '/api/mcp' || urlPath.startsWith('/api/mcp/')) {
      mcpHandler(req, res, urlPath).catch((err) => {
        logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, 'mcp 处理异常')
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'mcp 内部错误' })
        } else {
          res.end()
        }
      })
      return
    }

    // 连接器面板（D4）：/api/connectors[/:id/auth|run]（协议层 mock，未接入如实 501）
    if (urlPath === '/api/connectors' || urlPath.startsWith('/api/connectors/')) {
      connectorsHandler(req, res, urlPath).catch((err) => {
        logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, 'connectors 处理异常')
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'connectors 内部错误' })
        } else {
          res.end()
        }
      })
      return
    }

    // 记忆系统（S3）：/api/memory/records（GET/POST/DELETE，sqlite 存储模式启用，否则 501）
    if (urlPath === '/api/memory/records') {
      memoryHandler(req, res, urlPath).catch((err) => {
        logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, 'memory 处理异常')
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'memory 内部错误' })
        } else {
          res.end()
        }
      })
      return
    }

    // Edge-TTS 语音合成（P1-1）
    if (urlPath === '/api/tts') {
      ttsHandler(req, res, urlPath).catch((err) => {
        logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, 'tts 处理异常')
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'tts 内部错误' })
        } else {
          res.end()
        }
      })
      return
    }

    // ffmpeg 成片合成（P1-2）
    if (urlPath === '/api/render') {
      renderHandler(req, res, urlPath)
      return
    }

    if (urlPath.startsWith('/api/jianying/draft-zip')) {
      handleDraftZip(req, res, args, logger).catch((err) => {
        logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, 'draft-zip 处理异常')
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'draft-zip 内部错误' })
        } else {
          res.end()
        }
      })
      return
    }

    if (urlPath.startsWith('/api/')) {
      sendJson(res, 404, { error: '未知 API 路由' })
      return
    }

    // TTS 音频静态服务（P1-1）：/files/tts/<name>.mp3，先于 dist 静态托管
    if (urlPath.startsWith('/files/tts/')) {
      ttsFileHandler(req, res, urlPath)
      return
    }

    // 成片静态服务（P1-2）：/files/render/<name>.mp4
    if (urlPath.startsWith('/files/render/')) {
      renderFileHandler(req, res, urlPath)
      return
    }

    serveStatic(req, res, distDir)
  }

  const server = http.createServer(handler)
  const port = opts.port ?? args.port
  const host = opts.host ?? args.host

  if (opts.listen !== false) {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(port, host, () => resolveListen())
    })
  }

  return {
    server,
    args,
    logger,
    storage,
    keys,
    llmTarget,
    // R1 修复：ttsEnabled 此前未随返回值暴露，CLI 启动日志回调引用内部变量抛
    // ReferenceError → 进程 exit(1)，伴生服务全部能力不可用
    ttsEnabled,
    ttsTimeoutSec,
    proxyTimeoutSec,
    host,
    port: server.address()?.port ?? port,
    health: healthPayload,
  }
}

// ---------------- CLI 入口（被 import 时不自动启动） ----------------
function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href
  } catch {
    return false
  }
}

if (isDirectRun()) {
  const args = parseArgs(process.argv.slice(2))
  startServer()
    .then(({ server, logger, port, storage, keys, llmTarget, ttsEnabled }) => {
      logger.info(
        {
          appUrl: `http://localhost:${port}`,
          dist: args.dist,
          draftDir: args.draftDir,
          storage: storage.mode,
          keyMode: keys ? 'injected' : 'passthrough',
          llmProxy: llmTarget ? 'on' : 'off',
          tts: ttsEnabled ? 'on' : 'off',
          draftEndpoint: 'POST /api/jianying/draft-zip',
          ttsEndpoint: 'POST /api/tts',
        },
        `WebLockShot 伴生服务已启动 http://localhost:${port}`
      )
      server.on('error', (err) => {
        logger.error({ err: err.message }, '服务运行异常')
        process.exit(1)
      })
    })
    .catch((err) => {
      console.error('服务启动失败:', err.message)
      process.exit(1)
    })
}
