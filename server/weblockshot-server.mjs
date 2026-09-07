#!/usr/bin/env node
/**
 * WebLockShot 本地伴生服务 (Companion Server, 零依赖纯 Node)
 *
 * 能力：
 * 1. 静态托管 dist/（生产构建后的纯前端应用）
 * 2. /api/kling、/api/jimeng、/api/comfyui 反向代理（生产环境也能直连 ComfyUI 与视频 API，规避浏览器跨域）
 * 3. POST /api/jianying/draft-zip：接收剪映草稿 zip 并解压到本地草稿目录，省去手动解压
 *
 * 用法：
 *   npx weblockshot                 # 默认端口 5174
 *   node server/weblockshot-server.mjs --port 8080 --dist ./dist --draft-dir ./jianying-drafts
 *
 * 环境变量：PORT / DIST_DIR / DRAFT_DIR（命令行参数优先）
 */
import http from 'node:http'
import https from 'node:https'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractZip, safeEntryName } from './zip-extract.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

// ---------------- 参数解析 ----------------
function parseArgs(argv) {
  const args = { port: Number(process.env.PORT) || 5174, dist: process.env.DIST_DIR, draftDir: process.env.DRAFT_DIR }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]) || args.port
    else if (argv[i] === '--dist') args.dist = argv[++i]
    else if (argv[i] === '--draft-dir') args.draftDir = argv[++i]
  }
  args.dist = resolve(args.dist || join(ROOT, 'dist'))
  args.draftDir = resolve(args.draftDir || join(ROOT, 'jianying-drafts'))
  return args
}

const args = parseArgs(process.argv.slice(2))

// ---------------- 反向代理 ----------------
const PROXY_ROUTES = [
  { prefix: '/api/kling', target: 'https://api.klingai.com' },
  { prefix: '/api/jimeng', target: 'https://api.jimeng.bytedance.com' },
  { prefix: '/api/comfyui', target: 'http://127.0.0.1:8188' },
]

function proxyRequest(req, res, route) {
  const targetPath = req.url.slice(route.prefix.length) || '/'
  const url = new URL(targetPath, route.target)
  const isHttps = url.protocol === 'https:'
  const mod = isHttps ? https : http

  const headers = { ...req.headers }
  delete headers.host
  delete headers.origin
  delete headers.referer

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
      proxyRes.pipe(res)
    }
  )

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: `代理请求失败: ${err.message}` }))
  })

  req.pipe(proxyReq)
}

// ---------------- 剪映草稿落盘 ----------------
async function handleDraftZip(req, res) {
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
      tooLarge = true
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
      const entries = extractZip(buf)
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

      console.log(`[draft-zip] 已解压 ${written.length} 个文件 -> ${targetDir}`)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, dir: targetDir, files: written }))
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: `zip 解压失败: ${err instanceof Error ? err.message : String(err)}` }))
    }
  })
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
}

function serveStatic(req, res) {
  let filePath = join(args.dist, decodeURIComponent(req.url.split('?')[0]))
  if (req.url === '/' || !filePath.startsWith(args.dist)) {
    filePath = join(args.dist, 'index.html')
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
    filePath = join(args.dist, 'index.html')
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('dist/ 不存在，请先执行 npm run build')
    return
  }

  res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

// ---------------- 服务入口 ----------------
const server = http.createServer((req, res) => {
  const route = PROXY_ROUTES.find((r) => req.url.startsWith(r.prefix))
  if (route) {
    proxyRequest(req, res, route)
    return
  }

  if (req.url.startsWith('/api/jianying/draft-zip')) {
    void handleDraftZip(req, res)
    return
  }

  if (req.url.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '未知 API 路由' }))
    return
  }

  serveStatic(req, res)
})

server.listen(args.port, () => {
  console.log(`
WebLockShot 伴生服务已启动
  应用地址:   http://localhost:${args.port}
  静态目录:   ${args.dist}
  草稿落盘:   ${args.draftDir}
  代理路由:   /api/kling -> https://api.klingai.com
              /api/jimeng -> https://api.jimeng.bytedance.com
              /api/comfyui -> http://127.0.0.1:8188
  剪映落盘:   POST /api/jianying/draft-zip (body = zip 二进制)
`)
})

server.on('error', (err) => {
  console.error('服务启动失败:', err.message)
  process.exit(1)
})
