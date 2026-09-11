/**
 * HTTPS/HTTP 极简静态服务 + 自签证书（供「生产形态」类套件共用）。
 *
 * 为什么需要它：tldraw 的许可判定是
 *   `protocol === 'http:'` **或** `https:` + 回环主机 → 视为开发环境（豁免）
 * 也就是说 **http://127.0.0.1 永远看不到线上形态**。要复现「https + 非回环域名」，
 * 必须自己起一个 https 静态服务并把域名解析到 127.0.0.1。
 *
 * 使用方：
 *   - `scripts/prodmode-check.mjs`（生产模式回归：许可闸门 + 诚实提示）
 *   - `scripts/capture-demo-gif.mjs`（演示录屏：带 license key 的生产形态，无水印）
 *
 * 诚实边界：自签证书**仅本机测试**用，落在 gitignore 的临时目录里，不进入仓库。
 */
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** 定位 openssl（Windows 上 Git for Windows 自带） */
export function findOpenssl() {
  const candidates = [
    'C:/Program Files/Git/usr/bin/openssl.exe',
    'C:/Program Files/Git/mingw64/bin/openssl.exe',
    'C:/Program Files (x86)/Git/usr/bin/openssl.exe',
    '/usr/bin/openssl',
    '/usr/local/bin/openssl',
  ]
  for (const p of candidates) if (existsSync(p)) return p
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return 'openssl'
  } catch {
    return null
  }
}

/**
 * 生成/复用自签证书（仅本机测试用，落在 tmpDir 内，调用方负责把 tmpDir 放进 gitignore）。
 * @returns {{ key: Buffer, cert: Buffer }}
 */
export function makeCert(openssl, { host, tmpDir }) {
  mkdirSync(tmpDir, { recursive: true })
  const key = join(tmpDir, 'key.pem')
  const cert = join(tmpDir, 'cert.pem')
  if (!existsSync(key) || !existsSync(cert)) {
    execFileSync(
      openssl,
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', key, '-out', cert, '-days', '2',
        '-subj', `/CN=${host}`,
        '-addext', `subjectAltName=DNS:${host}`,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] }
    )
  }
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

/**
 * 极简静态服务（http / https 共用），SPA 回落 index.html。
 * @returns {Promise<import('node:http').Server>}
 */
export function startStaticServer({ tls, port, distDir }) {
  const handler = async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const rel = pathname === '/' || pathname.endsWith('/') ? `${pathname}index.html` : pathname
    const safe = normalize(rel).replace(/^([/\\])+/, '')
    const abs = join(distDir, safe)
    if (!abs.startsWith(distDir)) {
      res.writeHead(403).end('forbidden')
      return
    }
    try {
      const buf = readFileSync(abs)
      res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream' })
      res.end(buf)
    } catch {
      // SPA 回落
      try {
        const html = readFileSync(join(distDir, 'index.html'))
        res.writeHead(200, { 'content-type': MIME['.html'] })
        res.end(html)
      } catch {
        res.writeHead(404).end('not found')
      }
    }
  }
  const server = tls ? createServer({ key: tls.key, cert: tls.cert }, handler) : createHttpServer(handler)
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}
