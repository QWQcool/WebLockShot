#!/usr/bin/env node
/**
 * WebLockShot 画布 E2E 固化套件（CANVAS_PLAN.md §9 T1）
 *
 * 把「每切片用完即弃」的 Playwright 实机冒烟固化为可重复套件：真实鼠标路径 + 独立浏览器
 * 上下文（隔离 localStorage / IndexedDB，不污染本机数据），覆盖画布五大块：
 *   ① 开场层 → 对话栏演示编排 → 节点落位 → 刷新恢复
 *   ② 3D 运镜台（进入 / 场景预设 / 返回）
 *   ③ Skill 市场（安装 / 启停 / 卸载）
 *   ④ 记忆图谱（打开 / 真实空态或真实数据 / 关闭）
 *   ⑤ 多画布项目 + 小地图 + 连接器面板 + 创作场景画廊
 *
 * 用法：
 *   npm run e2e                 # 构建（dist 缺失时）+ 起伴生服务 + 跑全部步骤
 *   npm run e2e -- --skip-build # 复用现有 dist（快速回归）
 *   npm run e2e -- --headed     # 有头模式（排障）
 *
 * 诚实边界：
 *   - Playwright 未安装 / 浏览器未下载 → 打印指引并 exit 0（不伪装通过、不阻塞 CI）
 *   - 任一步骤失败 → 打印 ❌ 详情并 exit 1（可定位到具体步骤）
 *   - 伴生服务用 WLS_STORAGE=memory 起在随机端口，不触碰本机 sqlite / 草稿目录
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const require = createRequire(import.meta.url)
const argv = process.argv.slice(2)
const FLAG = (name) => argv.includes(`--${name}`)
const SKIP_BUILD = FLAG('skip-build')
const HEADED = FLAG('headed')
const VIEWPORT = { width: 1600, height: 900 }
const STEP_TIMEOUT = 30_000

/** 画布节点 shape type（contract.ts 的 CANVAS_NODE_SHAPE_TYPE，避免 import TS） */
const NODE_SHAPE_TYPE = 'wls-node'

// ---------------- Playwright 解析（多路径，缺失即优雅跳过） ----------------

/**
 * 依次尝试：项目 node_modules → 全局 npm root → npx 缓存目录。
 * 返回 playwright 模块或 null（null = 环境未安装，走诚实跳过）。
 */
function loadPlaywright() {
  const candidates = [ROOT]
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (globalRoot) candidates.push(globalRoot)
  } catch {
    /* npm 不可用时忽略 */
  }
  const npxCache = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
  try {
    for (const dir of readdirSync(npxCache)) candidates.push(join(npxCache, dir, 'node_modules'))
  } catch {
    /* 无 npx 缓存时忽略 */
  }
  for (const base of candidates) {
    try {
      return require(require.resolve('playwright', { paths: [base] }))
    } catch {
      /* 继续下一个候选 */
    }
  }
  return null
}

function skip(reason) {
  console.log('\n=== 画布 E2E 已跳过（环境不满足）===')
  console.log(`原因：${reason}`)
  console.log('启用方式：')
  console.log('  npm i -D playwright && npx playwright install chromium')
  console.log('（套件在无 Playwright 的环境下如实跳过，不伪装通过）')
  process.exit(0)
}

// ---------------- 伴生服务 ----------------

async function waitHealthy(base, deadlineMs = 20_000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) return true
    } catch {
      /* 未就绪，继续等 */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

function startCompanionServer(port) {
  const draftDir = join(ROOT, '.tmp-e2e', 'drafts')
  mkdirSync(draftDir, { recursive: true })
  const child = spawn(
    process.execPath,
    [
      'server/weblockshot-server.mjs',
      '--port',
      String(port),
      '--dist',
      join(ROOT, 'dist'),
      '--draft-dir',
      draftDir,
    ],
    {
      cwd: ROOT,
      env: { ...process.env, WLS_STORAGE: 'memory', WLS_LOG_LEVEL: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  // 必须同时消费 stdout 与 stderr：只消费一路会让另一路写满 64KB 管道缓冲后阻塞进程
  let log = ''
  child.stdout.on('data', (d) => (log += String(d)))
  child.stderr.on('data', (d) => (log += String(d)))
  return { child, getLog: () => log }
}

// ---------------- 断言工具 ----------------

let failures = 0
const stepResults = []

async function step(name, fn) {
  const started = Date.now()
  try {
    await fn()
    stepResults.push({ name, ok: true, ms: Date.now() - started })
    console.log(`  ✔ ${name}（${Date.now() - started}ms）`)
  } catch (err) {
    failures++
    const msg = err instanceof Error ? err.message : String(err)
    stepResults.push({ name, ok: false, ms: Date.now() - started, err: msg })
    console.error(`  ❌ ${name} —— ${msg}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// ---------------- 主流程 ----------------

async function main() {
  console.log('=== WebLockShot 画布 E2E ===')

  const playwright = loadPlaywright()
  if (!playwright) {
    skip('未找到 playwright 包（项目 / 全局 / npx 缓存均无）')
  }
  const { chromium } = playwright

  // 1. 构建产物
  if (!SKIP_BUILD) {
    console.log('· 构建 dist（--skip-build 可复用现有产物）…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
  } else if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.log('· dist 缺失，回退为完整构建…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
  }

  // 2. 伴生服务
  const port = 23000 + Math.floor(Math.random() * 2000)
  const base = `http://127.0.0.1:${port}`
  const server = startCompanionServer(port)
  let browser = null

  try {
    if (!(await waitHealthy(base))) {
      throw new Error(`伴生服务未就绪（${base}/healthz）\n${server.getLog().slice(-800)}`)
    }
    console.log(`· 伴生服务就绪：${base}`)

    // 3. 浏览器（独立上下文 = 隔离 storage；屏蔽 SW 防旧 bundle 干扰）
    try {
      browser = await chromium.launch({ headless: !HEADED })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/Executable doesn't exist|please run the following command/i.test(msg)) {
        skip(`Chromium 可执行文件缺失（${msg.split('\n')[0]}）`)
      }
      throw err
    }
    const context = await browser.newContext({
      viewport: VIEWPORT,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(STEP_TIMEOUT)

    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    const nodeCount = () =>
      page.evaluate(
        (type) => window.__wlsEditor?.getCurrentPageShapes().filter((s) => s.type === type).length ?? 0,
        NODE_SHAPE_TYPE
      )
    const waitForNodeCount = async (min, timeout = 10_000) => {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        if ((await nodeCount()) >= min) return true
        await page.waitForTimeout(200)
      }
      return false
    }

    // ---- ① 画布核心链路 ----
    await step('① 开场层首次进入（隔离 storage → 真实首访）', async () => {
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid=canvas-workbench]', { timeout: 20_000 })
      await page.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 10_000 })
      assert(await page.isVisible('[data-testid=canvas-onboarding]'), '开场层未出现')
    })

    await step('① 开场层「进入画布」→ 折叠为底部对话栏', async () => {
      await page.click('[data-testid=co-enter]')
      await page.waitForSelector('[data-testid=canvas-onboarding]', { state: 'detached', timeout: 5000 })
      assert(await page.isVisible('[data-testid=chat-dock]'), '对话栏未出现')
    })

    await step('① 对话栏演示编排 → 节点落位（无 LLM Key 走演示并如实标注）', async () => {
      await page.fill('.wls-chat-input', '给一款保温杯拍一条 30 秒竖屏带货短视频')
      await page.click('.wls-chat-send')
      // 提示条先出现「布置中」busy 态，等终态文案（演示编排 / LLM 编排）再断言
      await page.waitForFunction(
        () => /演示编排|LLM 编排/.test(document.querySelector('[data-testid=orchestration-notice]')?.textContent || ''),
        null,
        { timeout: 20_000 }
      )
      const text = await page.textContent('[data-testid=orchestration-notice]')
      assert(/演示编排|LLM 编排/.test(text || ''), `编排提示未出现两态标注：${text}`)
      assert(/演示编排/.test(text || ''), `隔离环境无 LLM Key，应走演示编排：${text}`)
      assert(await waitForNodeCount(3), `编排后节点数不足（实测 ${await nodeCount()}）`)
    })

    await step('① 刷新恢复（画布持久化 + 落盘不丢）', async () => {
      const before = await nodeCount()
      await page.waitForTimeout(700) // 等防抖落盘
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid=canvas-workbench]', { timeout: 20_000 })
      assert(await waitForNodeCount(before), `刷新后节点数回落（before=${before} after=${await nodeCount()}）`)
    })

    // ---- ② 3D 运镜台 ----
    await step('② 3D 运镜台：节点进入 + 场景预设生效 + 返回画布', async () => {
      await page.getByRole('button', { name: /3D 运镜台/ }).click()
      await page.waitForTimeout(400)
      await page.evaluate(() => {
        window.__wlsEditor?.zoomToFit()
      })
      await page.waitForSelector('[data-testid=stage3d-enter]', { timeout: 10_000 })
      await page.click('[data-testid=stage3d-enter]')
      await page.waitForSelector('[data-testid=stage3d-studio]', { timeout: 15_000 })
      // WebGL 就绪或被如实降级（两者都算诚实通过）
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
      assert(await page.isVisible('[data-testid=s3-scenes]'), '场景预设区未渲染')
      await page.click('[data-testid=s3-scene-studio]')
      const active = await page.getAttribute('[data-testid=s3-scene-studio]', 'class')
      assert(/active/.test(active || ''), `场景预设未激活：${active}`)
      await page.click('[data-testid=s3-back]')
      await page.waitForSelector('[data-testid=stage3d-studio]', { state: 'detached', timeout: 5000 })
      assert(await page.isVisible('[data-testid=canvas-workbench]'), '返回画布失败')
    })

    // ---- ③ Skill 市场 ----
    await step('③ Skill 市场：打开 + 安装 + 启停 + 卸载', async () => {
      await page.click('[data-testid=open-skill-market]')
      await page.waitForSelector('[data-testid=skill-market-view]', { timeout: 10_000 })
      const official = await page.locator('[data-testid^=sm-install-]').count()
      assert(official > 0, 'Skill 市场无任何官方可安装项')
      const target = page.locator('[data-testid^=sm-install-]').first()
      const installId = await target.getAttribute('data-testid')
      await target.click()
      await page.waitForSelector('[data-testid=sm-installed-card]', { timeout: 10_000 })
      assert((await page.locator('[data-testid=sm-installed-card]').count()) > 0, '安装后已安装分区为空')
      const toggle = page.locator('[data-testid=sm-card-toggle]').first()
      await toggle.click()
      await page.waitForTimeout(200)
      const uninstall = page.locator('[data-testid=sm-card-uninstall]').first()
      await uninstall.click()
      await page.waitForTimeout(300)
      assert((await page.locator('[data-testid=sm-installed-card]').count()) === 0, '卸载后已安装分区未清空')
      assert(!!installId, '未取到安装按钮标识')
      await page.click('[data-testid=sm-close]')
      await page.waitForSelector('[data-testid=skill-market-view]', { state: 'detached', timeout: 5000 })
    })

    // ---- ④ 记忆图谱 ----
    await step('④ 记忆图谱：打开 + 真实空态/真实数据 + 关闭', async () => {
      await page.click('[data-testid=open-memory-graph]')
      await page.waitForSelector('[data-testid=memory-graph-view]', { timeout: 10_000 })
      // 先过 loading 态：真实记录 → .mg-canvas；无记录 → 诚实空态
      await page.waitForFunction(
        () => !!document.querySelector('.mg-canvas') || !!document.querySelector('[data-testid=memory-graph-empty]'),
        null,
        { timeout: 15_000 }
      )
      const hasData = await page.locator('.mg-canvas').count()
      const isEmpty = await page.locator('[data-testid=memory-graph-empty]').count()
      assert(hasData + isEmpty === 1, '记忆图谱既非空态也未渲染图谱（疑似摆样例/未就绪）')
      if (isEmpty === 1) {
        // 空态必须诚实（隔离 storage 无任何回流记录）
        const txt = await page.textContent('[data-testid=memory-graph-empty]')
        assert(/暂无记忆记录/.test(txt || ''), `空态文案异常：${txt}`)
        assert(/永不摆样例数据/.test(txt || ''), `空态未标注「永不摆样例数据」：${txt}`)
      } else {
        const footnote = await page.textContent('[data-testid=memory-graph-footnote]')
        assert(/真实回流记录/.test(footnote || ''), `脚注未标注真实记录口径：${footnote}`)
      }
      await page.click('[data-testid=memory-graph-close]')
      await page.waitForSelector('[data-testid=memory-graph-view]', { state: 'detached', timeout: 5000 })
    })

    // ---- ⑤ 多画布 / 小地图 / 连接器 / 创作场景 ----
    await step('⑤ 多画布项目：新建 → 切换 → 删除（含隔离存储）', async () => {
      assert(await page.isVisible('[data-testid=minimap]'), '小地图未渲染')
      const before = await page.locator('[data-testid=project-select] option').count()
      page.once('dialog', (d) => void d.accept('E2E 项目'))
      await page.click('[data-testid=project-new]')
      await page.waitForSelector('[data-testid=project-notice]', { timeout: 8000 })
      const notice = await page.textContent('[data-testid=project-notice]')
      assert(/已新建项目/.test(notice || ''), `新建项目提示异常：${notice}`)
      const after = await page.locator('[data-testid=project-select] option').count()
      assert(after === before + 1, `项目数未增加（${before} → ${after}）`)
      const options = await page.locator('[data-testid=project-select] option').all()
      const firstValue = await options[0].getAttribute('value')
      await page.selectOption('[data-testid=project-select]', firstValue)
      await page.waitForTimeout(300)
      page.once('dialog', (d) => void d.accept())
      await page.selectOption('[data-testid=project-select]', await page.locator('[data-testid=project-select] option').last().getAttribute('value'))
      await page.waitForTimeout(200)
      await page.click('[data-testid=project-delete]')
      await page.waitForTimeout(400)
      const final = await page.locator('[data-testid=project-select] option').count()
      assert(final === before, `删除后项目数未回落（${final} vs ${before}）`)
    })

    await step('⑤ 连接器面板 + 创作场景画廊：打开/关闭', async () => {
      await page.click('[data-testid=open-connectors]')
      await page.waitForSelector('[data-testid=connector-panel]', { timeout: 8000 })
      const mode = await page.textContent('[data-testid=cp-mode]')
      assert((mode || '').length > 0, '连接器面板未标注模式')
      await page.click('[data-testid=cp-close]')
      await page.waitForSelector('[data-testid=connector-panel]', { state: 'detached', timeout: 5000 })

      await page.click('[data-testid=open-scene-gallery]')
      await page.waitForSelector('[data-testid=scene-gallery]', { timeout: 8000 })
      const cards = await page.locator('[data-testid^=sg-card-]').count()
      assert(cards >= 6, `创作场景卡片不足（${cards}）`)
      await page.click('[data-testid=sg-close]')
      await page.waitForSelector('[data-testid=scene-gallery]', { state: 'detached', timeout: 5000 })
    })

    await step('⑥ 全程无未捕获页面异常（真实鼠标路径零 pageerror）', async () => {
      assert(pageErrors.length === 0, `捕获到 ${pageErrors.length} 条 pageerror：${pageErrors.slice(0, 3).join(' | ')}`)
    })
  } finally {
    if (browser) await browser.close().catch(() => {})
    server.child.kill()
    await new Promise((r) => setTimeout(r, 150))
    try {
      rmSync(join(ROOT, '.tmp-e2e'), { recursive: true, force: true })
    } catch {
      /* 清理失败不影响结论 */
    }
  }

  // ---------------- 汇总 ----------------
  const passed = stepResults.filter((s) => s.ok).length
  console.log(`\n=== 画布 E2E：${passed}/${stepResults.length} 步通过 ===`)
  for (const s of stepResults.filter((r) => !r.ok)) console.error(`  ❌ ${s.name} —— ${s.err}`)
  if (failures > 0) process.exit(1)
  console.log('全部通过（真实鼠标路径 + 隔离 storage）')
  process.exit(0)
}

main().catch((err) => {
  console.error('\nE2E 套件异常终止：', err instanceof Error ? err.message : err)
  process.exit(1)
})
