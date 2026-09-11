#!/usr/bin/env node
/**
 * 降级 / 迁移矩阵（CANVAS_PLAN.md §9 T5）
 *
 * 逐项实机验证「能力缺失时是否优雅降级、如实标注、不崩溃不白屏」：
 *   ① 旧单画布 → 多画布迁移（零丢失，老键保留作安全网）
 *   ② 无 WebGL（3D 台如实降级为提示态，画布其余功能不受影响）
 *   ③ 无伴生服务（纯静态托管：能力探测失败 → 全功能本地模式 + 如实标注）
 *   ④ 无 LLM Key（编排走演示引擎并如实标注「非真实 LLM」）
 *   ⑤ WLS_STORAGE=sqlite / memory（能力位 memory: sqlite|off + 记忆源双模如实切换）
 *   ⑥ ComfyUI 离线（反代返回错误而非挂起，伴生服务进程存活）
 *
 * 用法：
 *   npm run degrade                 # 构建（dist 缺失时）+ 全矩阵 + 写 docs/degrade-matrix.md
 *   npm run degrade -- --skip-build
 *
 * 判定口径：每项给出「预期降级表现 / 实测 / 结论」；出现崩溃、白屏、静默失败即 FAIL。
 */
import { createReadStream, existsSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { extname, join, normalize } from 'node:path'
import {
  ROOT,
  ensureDist,
  loadPlaywright,
  randomPort,
  skipEnv,
  startCompanionServer,
  waitHealthy,
} from './lib/browser-env.mjs'

const argv = process.argv.slice(2)
const FLAG = (name) => argv.includes(`--${name}`)
const SKIP_BUILD = FLAG('skip-build')
const VIEWPORT = { width: 1600, height: 900 }

const rows = []
const record = (scenario, expect, observed, ok, note = '') =>
  rows.push({ scenario, expect, observed, ok, note })

// ---------------- 纯静态托管（模拟「没有伴生服务」） ----------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
}

/** 只做静态文件托管：/healthz 与 /api/* 一律 404（真实「无伴生服务」形态） */
function startStaticServer(port, distDir) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (urlPath.startsWith('/api/') || urlPath === '/healthz') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end('{"error":"static host: no companion service"}')
      return
    }
    let filePath = normalize(join(distDir, urlPath === '/' ? 'index.html' : urlPath))
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(distDir, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    createReadStream(filePath).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

// ---------------- 页面工具 ----------------

const nodeCount = (page) =>
  page.evaluate(() => window.__wlsEditor?.getCurrentPageShapes().filter((s) => s.type === 'wls-node').length ?? 0)

async function waitForNodeCount(page, min, timeout = 12_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await nodeCount(page)) >= min) return true
    await page.waitForTimeout(200)
  }
  return false
}

/** 打开画布并跳过开场层 */
async function enterCanvas(page, base) {
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid=canvas-workbench]', { timeout: 25_000 })
  await page.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 15_000 })
  await page.click('[data-testid=co-enter]')
  await page.waitForSelector('[data-testid=canvas-onboarding]', { state: 'detached', timeout: 8000 })
}

/** 走一次对话栏演示编排，返回提示条文案 */
async function runDemoOrchestration(page) {
  await page.fill('.wls-chat-input', '给一款保温杯拍一条 30 秒竖屏带货短视频')
  await page.click('.wls-chat-send')
  await page.waitForFunction(
    () => /演示编排|LLM 编排|编排失败/.test(document.querySelector('[data-testid=orchestration-notice]')?.textContent || ''),
    null,
    { timeout: 25_000 }
  )
  return (await page.textContent('[data-testid=orchestration-notice]')) ?? ''
}

// ---------------- 主流程 ----------------

async function main() {
  console.log('=== WebLockShot 降级 / 迁移矩阵（T5）===')

  const playwright = loadPlaywright()
  if (!playwright) skipEnv('降级 / 迁移矩阵', '未找到 playwright 包（项目 / 全局 / npx 缓存均无）')
  const { chromium } = playwright

  ensureDist({ skipBuild: SKIP_BUILD })

  const distDir = join(ROOT, 'dist')
  const tmpDir = join(ROOT, '.tmp-degrade')
  const port = randomPort(29_000)
  const base = `http://127.0.0.1:${port}`
  const staticPort = randomPort(31_000)
  const staticBase = `http://127.0.0.1:${staticPort}`
  const sqlitePort = randomPort(33_000)
  const sqliteBase = `http://127.0.0.1:${sqlitePort}`

  const server = startCompanionServer(port, { storage: 'memory', tmpDir: '.tmp-degrade' })
  const sqliteServer = startCompanionServer(sqlitePort, {
    storage: 'sqlite',
    tmpDir: '.tmp-degrade',
    // 唯一库名：避免同名库 WAL 重放累积脏数据（历史踩坑）
    env: { WLS_SQLITE_PATH: join(tmpDir, `degrade-${Date.now().toString(36)}.tdb`) },
  })
  const staticServer = await startStaticServer(staticPort, distDir)
  let browser = null

  try {
    if (!(await waitHealthy(base))) throw new Error(`伴生服务未就绪（${base}）\n${server.getLog().slice(-600)}`)
    if (!(await waitHealthy(sqliteBase))) throw new Error(`sqlite 伴生服务未就绪（${sqliteBase}）\n${sqliteServer.getLog().slice(-600)}`)
    console.log(`· 伴生服务(memory)：${base}`)
    console.log(`· 伴生服务(sqlite)：${sqliteBase}`)
    console.log(`· 纯静态托管：${staticBase}`)

    browser = await chromium.launch({ headless: true })

    // ============ ① 旧单画布 → 多画布迁移 ============
    {
      const context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(30_000)
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))

      const legacyDoc = {
        version: 1,
        id: 'legacy-doc',
        name: '老单画布',
        nodes: [
          { id: 'legacy-1', kind: 'brief', x: 0, y: 0, w: 260, h: 160, meta: { text: '旧数据 1' } },
          { id: 'legacy-2', kind: 'script', x: 300, y: 0, w: 300, h: 220, meta: {} },
          { id: 'legacy-3', kind: 'storyboard', x: 640, y: 0, w: 300, h: 560, meta: {} },
        ],
        edges: [{ id: 'legacy-e1', from: 'legacy-1', to: 'legacy-2' }],
        updatedAt: Date.now() - 60_000,
      }
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.evaluate((doc) => {
        localStorage.clear()
        localStorage.setItem('weblockshot.canvas.v1', JSON.stringify(doc))
      }, legacyDoc)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid=canvas-workbench]', { timeout: 25_000 })

      const migrated = await waitForNodeCount(page, 3)
      const store = await page.evaluate(() => {
        const idx = JSON.parse(localStorage.getItem('weblockshot.canvas.projects') ?? 'null')
        const active = idx?.activeId
        const doc = active ? JSON.parse(localStorage.getItem(`weblockshot.canvas.doc.${active}`) ?? 'null') : null
        return {
          hasIndex: !!idx,
          projectCount: idx?.projects?.length ?? 0,
          docNodes: doc?.nodes?.length ?? 0,
          docEdges: doc?.edges?.length ?? 0,
          legacyKept: !!localStorage.getItem('weblockshot.canvas.v1'),
        }
      })
      const ok =
        migrated &&
        store.hasIndex &&
        store.projectCount === 1 &&
        store.docNodes === 3 &&
        store.docEdges === 1 &&
        store.legacyKept &&
        errors.length === 0
      record(
        '① 旧单画布 → 多画布迁移',
        '老键 weblockshot.canvas.v1 的 3 节点 1 边复制进默认项目；老键保留；无报错',
        `画布节点 ${await nodeCount(page)} · 索引 ${store.projectCount} 项目 · 迁移文档 ${store.docNodes} 节点/${store.docEdges} 边 · 老键保留 ${store.legacyKept} · pageerror ${errors.length}`,
        ok
      )
      await context.close()
    }

    // ============ ② 无 WebGL ============
    {
      const context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block', reducedMotion: 'reduce' })
      await context.addInitScript(() => {
        const orig = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (typeof type === 'string' && /webgl/i.test(type)) return null
          return orig.call(this, type, ...rest)
        }
      })
      const page = await context.newPage()
      page.setDefaultTimeout(30_000)
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))

      await enterCanvas(page, base)
      await page.locator('.wls-palette-item', { hasText: '3D 运镜台' }).first().click()
      await page.waitForTimeout(400)
      await page.evaluate(() => {
        window.__wlsEditor?.zoomToFit()
      })
      await page.locator('[data-testid=stage3d-enter]').last().click()
      await page.waitForSelector('[data-testid=stage3d-studio]', { timeout: 15_000 })
      await page.waitForSelector('[data-testid=s3-webgl-fallback]', { timeout: 20_000 })
      const fallbackText = ((await page.textContent('[data-testid=s3-webgl-fallback]')) ?? '').replace(/\s+/g, ' ').trim()
      const webglCanvas = await page.locator('[data-testid=s3-viewport] canvas').count()
      await page.click('[data-testid=s3-back]')
      await page.waitForSelector('[data-testid=stage3d-studio]', { state: 'detached', timeout: 8000 })
      const notice = await runDemoOrchestration(page)
      const ok = webglCanvas === 0 && fallbackText.length > 0 && /演示编排/.test(notice) && errors.length === 0
      record(
        '② 无 WebGL',
        '3D 台显示降级提示（不渲染 canvas）；返回后画布编排照常；无报错',
        `降级提示「${fallbackText.slice(0, 60)}」· 视口 canvas ${webglCanvas} 个 · 返回后编排：${notice.includes('演示编排') ? '正常' : '异常'} · pageerror ${errors.length}`,
        ok
      )
      await context.close()
    }

    // ============ ③ 无伴生服务（纯静态托管）============
    {
      const context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(30_000)
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))

      await enterCanvas(page, staticBase)
      const notice = await runDemoOrchestration(page)
      const mcpChip = await page.locator('[data-testid=mcp-chip]').count()

      await page.click('[data-testid=open-memory-graph]')
      await page.waitForSelector('[data-testid=memory-graph-view]', { timeout: 15_000 })
      await page.waitForFunction(
        () => !!document.querySelector('.mg-canvas') || !!document.querySelector('[data-testid=memory-graph-empty]'),
        null,
        { timeout: 15_000 }
      )
      const memTag = ((await page.textContent('.mg-mode-tag')) ?? '').trim()
      await page.click('[data-testid=memory-graph-close]')
      await page.waitForSelector('[data-testid=memory-graph-view]', { state: 'detached', timeout: 8000 })

      await page.click('[data-testid=open-connectors]')
      await page.waitForSelector('[data-testid=connector-panel]', { timeout: 12_000 })
      const cpMode = ((await page.textContent('[data-testid=cp-mode]')) ?? '').trim()
      await page.click('[data-testid=cp-close]')

      const ok =
        /演示编排/.test(notice) &&
        mcpChip === 0 &&
        /纯前端模式/.test(memTag) &&
        /纯前端模式/.test(cpMode) &&
        errors.length === 0
      record(
        '③ 无伴生服务（纯静态托管）',
        '画布全功能本地可用；MCP 徽章不出现；记忆图谱标注「纯前端模式」；连接器面板标注无功能可用；无报错',
        `编排 ${notice.includes('演示编排') ? '正常' : '异常'} · MCP 徽章 ${mcpChip} 个 · 记忆源「${memTag}」· 连接器「${cpMode}」· pageerror ${errors.length}`,
        ok
      )
      await context.close()
    }

    // ============ ④ 无 LLM Key ============
    {
      const context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(30_000)
      await enterCanvas(page, base)
      const notice = await runDemoOrchestration(page)
      const ok = /演示编排/.test(notice) && /非真实 LLM/.test(notice)
      record(
        '④ 无 LLM Key',
        '编排走演示引擎且文案明确标注「非真实 LLM」，不伪装成真实生成',
        `提示条：「${notice.replace(/\s+/g, ' ').slice(0, 70)}」`,
        ok
      )
      await context.close()
    }

    // ============ ⑤ WLS_STORAGE=sqlite / memory ============
    {
      const memHealth = await (await fetch(`${base}/healthz`)).json()
      const sqliteHealth = await (await fetch(`${sqliteBase}/healthz`)).json()
      const memApi = await fetch(`${base}/api/memory/records`)
      const sqliteApi = await fetch(`${sqliteBase}/api/memory/records`)

      const context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(30_000)
      await enterCanvas(page, sqliteBase)
      await page.click('[data-testid=open-memory-graph]')
      await page.waitForSelector('[data-testid=memory-graph-view]', { timeout: 15_000 })
      await page.waitForFunction(() => !!document.querySelector('.mg-mode-tag'), null, { timeout: 15_000 })
      const tag = ((await page.textContent('.mg-mode-tag')) ?? '').trim()
      await page.click('[data-testid=memory-graph-close]')
      await context.close()

      const ok =
        memHealth.storage === 'memory' &&
        memHealth.memory === 'off' &&
        memApi.status === 501 &&
        String(sqliteHealth.storage).startsWith('sqlite') &&
        sqliteHealth.memory === 'sqlite' &&
        sqliteApi.status === 200 &&
        /伴生服务 sqlite/.test(tag)
      record(
        '⑤ WLS_STORAGE=memory / sqlite',
        'memory：memory=off、/api/memory/records 501、前端自动降级本地；sqlite：memory=sqlite、接口 200、图谱标注「伴生服务 sqlite」',
        `memory → storage=${memHealth.storage} memory=${memHealth.memory} API ${memApi.status}；sqlite → storage=${sqliteHealth.storage} memory=${sqliteHealth.memory} API ${sqliteApi.status}；图谱标注「${tag}」`,
        ok
      )
    }

    // ============ ⑥ ComfyUI 离线 ============
    {
      let status = 0
      let body = ''
      try {
        const res = await fetch(`${base}/api/comfyui/system_stats`, { signal: AbortSignal.timeout(15_000) })
        status = res.status
        body = (await res.text()).slice(0, 160)
      } catch (err) {
        status = -1
        body = err instanceof Error ? err.message : String(err)
      }
      const alive = (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(3000) })).ok
      const ok = status >= 400 && alive
      record(
        '⑥ ComfyUI 离线',
        '反代返回错误响应（不挂起），伴生服务进程存活；不伪造生成结果',
        `GET /api/comfyui/system_stats → ${status} ${body.replace(/\s+/g, ' ').slice(0, 80)} · healthz ${alive ? '200' : '异常'}`,
        ok
      )
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    server.child.kill()
    sqliteServer.child.kill()
    await new Promise((r) => staticServer.close(r))
    await new Promise((r) => setTimeout(r, 150))
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* 清理失败不影响结论 */
    }
  }

  // ---------------- 汇总 ----------------
  console.log('\n=== 矩阵结果 ===')
  for (const r of rows) {
    console.log(`${r.ok ? '✔' : '❌'} ${r.scenario}`)
    console.log(`   预期：${r.expect}`)
    console.log(`   实测：${r.observed}`)
  }
  const failed = rows.filter((r) => !r.ok).length
  console.log(`\n通过 ${rows.length - failed}/${rows.length}`)

  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const table = rows
    .map((r) => `| ${r.ok ? '✅' : '❌'} | ${r.scenario} | ${r.expect} | ${r.observed} |`)
    .join('\n')
  writeFileSync(
    join(ROOT, 'docs', 'degrade-matrix.md'),
    `# 降级 / 迁移矩阵（CANVAS_PLAN.md §9 T5）

> 生成：${stamp} · 由 \`npm run degrade\` 实机实测产出（本文件为生成物，请用脚本刷新而非手改）

## 口径

- 每项在**真实浏览器 + 生产构建 dist** 下跑，独立上下文（隔离 localStorage / IndexedDB）。
- 「无伴生服务」用最小静态文件服务器模拟：\`/healthz\` 与 \`/api/*\` 一律 404（真实静态托管形态）。
- 「无 WebGL」用 init script 把 \`getContext('webgl*')\` 置空模拟。
- 判定：出现崩溃 / 白屏 / 静默失败即 ❌；降级必须**如实标注**，不得伪装可用。

## 矩阵

| 结论 | 场景 | 预期降级表现 | 实测 |
|---|---|---|---|
${table}

## 结论

通过 ${rows.length - failed}/${rows.length}。
${failed === 0 ? '全部降级路径优雅、标注诚实、无崩溃无白屏。' : '存在未达标项，见上表 ❌ 行（需修复）。'}

## 说明（口径诚实性）

- \`WLS_STORAGE\` 只支持 \`memory\`（默认）与 \`sqlite\` 两个取值；「未启用 sqlite」即 \`memory\`，
  能力位 \`memory: 'off'\`，记忆接口 501，前端自动降级为本地 IndexedDB 并如实标注。
- ComfyUI 未运行时，\`/api/comfyui\` 反代返回上游连接错误（不挂起、不伪造），
  画布内的图像生成 / 局部重绘入口在未配置 Provider 时本就不会被调用。
`,
    'utf8'
  )
  console.log('已写入 docs/degrade-matrix.md')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n降级矩阵异常终止：', err instanceof Error ? err.message : err)
  process.exit(1)
})
