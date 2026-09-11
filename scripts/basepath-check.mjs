#!/usr/bin/env node
/**
 * 子路径部署回归（GitHub Pages 真实形态：base = `/WebLockShot/`）
 *
 * 为什么必须单独有这套件（2026-09-11 线上白屏事故复盘）：
 *   T1 E2E / T3 性能 / T4 a11y / T5 降级矩阵**全部**用一个「根路径」静态服务托管 dist，
 *   而线上是**子路径**托管。凡写死根绝对路径的资源（`/models/x.glb`）在本地全绿、
 *   线上 404 —— 3D 运镜台点「加人物」时 drei `useGLTF` 抛错，整页白屏。
 *   本套件用 `GITHUB_PAGES=1` 构建（base=/WebLockShot/）+ 子路径静态服务复现线上形态。
 *
 * 断言（任一失败即 exit 1）：
 *   ① `/WebLockShot/` 可加载 → 开场层 → 进入画布
 *   ② 画布资源（场景配图等）零 404
 *   ③ 3D 运镜台「加人物」：素体模型 200 + 姿势生效 + 无 pageerror + 无白屏
 *   ④ 全程 `/WebLockShot/` 下任何 4xx/5xx 都算失败（打印完整路径）
 *
 * 用法：
 *   npm run e2e:basepath              # 构建 dist-pages + 跑回归
 *   npm run e2e:basepath -- --skip-build
 */
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { existsSync } from 'node:fs'
import { ROOT, loadPlaywright, randomPort, skipEnv } from './lib/browser-env.mjs'

const argv = process.argv.slice(2)
const FLAG = (name) => argv.includes(`--${name}`)
const SKIP_BUILD = FLAG('skip-build')
const HEADED = FLAG('headed')
const HEADLESS = !HEADED

const PREFIX = '/WebLockShot/'
const OUT_DIR = join(ROOT, 'dist-pages')
const VIEWPORT = { width: 1600, height: 900 }

const MIME = {
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

/** 极简子路径静态服务：只服务 `<prefix>` 下的 dist-pages（模拟 GitHub Pages） */
function startSubpathServer(rootDir, prefix, port) {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
    const deny = (code, msg) => {
      res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(msg)
    }
    if (!pathname.startsWith(prefix)) return deny(404, 'outside deployment prefix')
    let rel = pathname.slice(prefix.length)
    if (rel === '' || rel.endsWith('/')) rel += 'index.html'
    const safe = normalize(rel).replace(/^([/\\])+/, '')
    const abs = join(rootDir, safe)
    if (!abs.startsWith(rootDir)) return deny(403, 'path traversal blocked')
    try {
      const buf = await readFile(abs)
      res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream' })
      res.end(buf)
    } catch {
      deny(404, `not found: ${pathname}`)
    }
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

// ---------------- 断言工具 ----------------

let failures = 0
function check(ok, label, extra = '') {
  if (ok) {
    console.log(`  ✔ ${label}${extra ? `（${extra}）` : ''}`)
  } else {
    failures++
    console.error(`  ❌ ${label}${extra ? ` —— ${extra}` : ''}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ---------------- 主流程 ----------------

async function main() {
  console.log('=== 子路径部署回归（GitHub Pages 形态 base=/WebLockShot/）===')

  const playwright = loadPlaywright()
  if (!playwright) skipEnv('子路径部署回归', '未找到 playwright 包（项目 / 全局 / npx 缓存均无）')
  const { chromium } = playwright

  // 1. 子路径构建（独立 outDir，避免覆盖根路径 dist）
  if (!SKIP_BUILD || !existsSync(join(OUT_DIR, 'index.html'))) {
    console.log('· 以 GITHUB_PAGES=1 构建到 dist-pages（base=/WebLockShot/）…')
    execSync('npx vite build --outDir dist-pages --emptyOutDir', {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, GITHUB_PAGES: '1' },
    })
  } else {
    console.log('· 复用现有 dist-pages（--skip-build）')
  }

  const entry = await readFile(join(OUT_DIR, 'index.html'), 'utf8')
  assert(entry.includes(PREFIX), 'dist-pages/index.html 未引用子路径前缀（base 未生效？）')

  // 2. 子路径静态服务
  const port = randomPort(25_000)
  const origin = `http://127.0.0.1:${port}`
  const server = await startSubpathServer(OUT_DIR, PREFIX, port)
  console.log(`· 子路径静态服务：${origin}${PREFIX}`)

  let browser = null
  try {
    browser = await chromium.launch({ headless: HEADLESS }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (/Executable doesn't exist|please run the following command/i.test(msg)) {
        skipEnv('子路径部署回归', `Chromium 可执行文件缺失（${msg.split('\n')[0]}）`)
      }
      throw err
    })
    const context = await browser.newContext({
      viewport: VIEWPORT,
      serviceWorkers: 'block', // 屏蔽 SW 防旧 bundle 干扰
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)

    const pageErrors = []
    const httpErrors = []
    const modelResponses = []
    /** 预期降级（无伴生服务）：/healthz 与 /api/* 探测失败，仅如实记录 */
    const degraded = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    page.on('response', (res) => {
      const url = res.url()
      if (!url.startsWith(origin)) return
      if (/quaternius/i.test(url)) modelResponses.push({ url, status: res.status() })
      if (res.status() < 400) return
      const path = url.replace(origin, '')
      // 纯静态托管（GitHub Pages）本就没有伴生服务：/healthz 与 /api/* 探测失败属
      // 「无伴生服务」的预期降级（T5 已覆盖），不是资源缺失，不计入失败。
      if (/^\/(healthz|api\/)/.test(path)) {
        degraded.push(`${res.status()} ${path}`)
        return
      }
      httpErrors.push(`${res.status()} ${path}`)
    })

    // ---- ① 入口 + 开场层 ----
    const res = await page.goto(`${origin}${PREFIX}`, { waitUntil: 'domcontentloaded' })
    check(res?.ok() ?? false, '子路径入口可访问', `HTTP ${res?.status()}`)
    await page.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 30_000 })
    check(true, '开场层已渲染')
    await page.click('[data-testid=co-enter]')
    await page.waitForSelector('[data-testid=canvas-workbench]', { timeout: 20_000 })
    check(true, '已进入画布')

    // ---- ② 画布资源零 404（场景画廊配图走 publicUrl，是同一类风险面） ----
    await page.click('[data-testid=open-scene-gallery]')
    await page.waitForSelector('[data-testid=scene-gallery]', { timeout: 15_000 })
    await page.waitForTimeout(1200) // 等配图请求发出
    const sceneErrors = httpErrors.filter((e) => /\/scenes\//.test(e))
    check(sceneErrors.length === 0, '场景画廊配图零 404', sceneErrors.join('、') || 'ok')
    await page.click('[data-testid=sg-close]').catch(() => {})

    // ---- ③ 3D 运镜台「加人物」（线上白屏的复现路径） ----
    await page.locator('.wls-palette-item', { hasText: '3D 运镜台' }).first().click()
    await page.waitForTimeout(400)
    await page.evaluate(() => {
      window.__wlsEditor?.zoomToFit()
    })
    await page.locator('[data-testid=stage3d-enter]').last().click()
    await page.waitForSelector('[data-testid=stage3d-studio]', { timeout: 20_000 })
    await page
      .waitForFunction(
        () =>
          document.querySelector('[data-testid=s3-webgl-fallback]') ||
          (!document.querySelector('[data-testid=s3-viewport-loading]') &&
            document.querySelector('[data-testid=s3-viewport] canvas')),
        null,
        { timeout: 30_000 }
      )
      .catch(() => {})
    check(true, '3D 运镜台已打开')

    const errorsBeforeAdd = pageErrors.length
    await page.click('[data-testid=s3-add-character]')
    await page.waitForTimeout(3000) // 等 GLB 请求 + 解析 + 首帧

    const modelOk = modelResponses.some((r) => r.status === 200)
    check(
      modelOk,
      '素体模型请求 200（子路径下不再 404）',
      modelResponses.map((r) => `${r.status} ${r.url.replace(origin, '')}`).join('、') || '未捕获到模型请求'
    )

    const studioAlive = await page.locator('[data-testid=stage3d-studio]').count()
    const rootAlive = await page.evaluate(() => (document.getElementById('root')?.children.length ?? 0) > 0)
    const bodyText = await page.evaluate(() => document.body.innerText.trim().length)
    check(studioAlive === 1 && rootAlive && bodyText > 0, '点「加人物」后未白屏', `studio=${studioAlive} root=${rootAlive} text=${bodyText}`)

    const poseApplied = await page.evaluate(() => typeof window.__s3poseMatched === 'number')
    check(poseApplied, '素体模型已解析并应用姿势（真渲染，非占位体）')

    const newErrors = pageErrors.slice(errorsBeforeAdd)
    check(newErrors.length === 0, '「加人物」过程零 JS 异常', newErrors.join(' | ') || 'ok')

    // ---- ④ 全程子路径资源零 4xx/5xx ----
    check(httpErrors.length === 0, '全程子路径资源零 4xx/5xx', httpErrors.slice(0, 8).join('、') || 'ok')
    check(pageErrors.length === 0, '全程零 pageerror', pageErrors.slice(0, 3).join(' | ') || 'ok')
    if (degraded.length) {
      console.log(`  ℹ 预期降级（纯静态托管无伴生服务，T5 口径）：${[...new Set(degraded)].join('、')}`)
    }
  } finally {
    await browser?.close().catch(() => {})
    server.close()
  }

  console.log(
    failures === 0
      ? '\n=== 子路径部署回归：全部通过（线上形态不再白屏）==='
      : `\n=== 子路径部署回归：${failures} 项失败 ===`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n❌ 套件异常终止：', err instanceof Error ? err.message : err)
  process.exit(1)
})
