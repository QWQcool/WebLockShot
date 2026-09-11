#!/usr/bin/env node
/**
 * 实机截图采集（CANVAS_PLAN.md §9 收官）
 *
 * 用 Playwright 驱动**生产构建 dist + 伴生服务**真实操作后截图，落盘 `docs/screenshots/`，
 * 供 README / HOW_TO_USE / PDF 引用（不使用设计稿或手绘 mock）。
 *
 * 覆盖三条线：
 *   - 画布线：开场层 / 主界面 / 对话栏编排 / Skill 市场 / 记忆图谱（空态 + 有数据）/ 3D 运镜台 /
 *     创作场景画廊 / 连接器面板 / 英文界面
 *   - 带货线：全链路工作台（含引擎条与海外引擎）
 *   - 短剧线：legacy 粗剪台
 *
 * 诚实说明：记忆图谱「有数据」截图由本脚本向**本地 IndexedDB** 写入 60 条结构化回流记录后拍摄，
 * 图注必须写明「演示数据由截图脚本写入」，不得当作产品内置样例。
 *
 * 用法：
 *   npm run shots                 # 构建（dist 缺失时）+ 采集
 *   npm run shots -- --skip-build
 *   npm run shots -- --prod       # 线上形态（https + 非回环域名，无 tldraw 开发水印）← PDF / README 用这个
 *
 * `--prod`：用 https + 非回环域名拍摄，复现线上 GitHub Pages 形态。为什么需要它：
 * tldraw 在**开发环境**（http 协议，或 https + 回环地址）会显示「Get a license for production」
 * 开发水印，而线上（https + 公网域名 + 已配置 key）没有水印。若用默认的 127.0.0.1 形态拍，
 * PDF / README 里会出现**访客看不到的水印**（与 capture-demo-gif.mjs 同一口径）。
 * 该模式需要 dist 里已烘焙 license key（构建时注入 `VITE_TLDRAW_LICENSE_KEY`，仓库
 * `.env.production` 已提交，`npm run build` 会自动加载），且**不启动伴生服务**——与真实线上一致
 * （纯静态托管，无 /healthz 与 /api/*；连接器面板因此如实显示「纯前端模式 · 无功能可用」）。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  ROOT,
  ensureDist,
  loadPlaywright,
  randomPort,
  skipEnv,
  startCompanionServer,
  waitHealthy,
} from './lib/browser-env.mjs'
import { findOpenssl, makeCert, startStaticServer } from './lib/tls-static-server.mjs'

const argv = process.argv.slice(2)
const SKIP_BUILD = argv.includes('--skip-build')
/** --prod：用 https + 非回环域名录制，复现线上形态（无 tldraw 开发水印） */
const PROD = argv.includes('--prod')
const VIEWPORT = { width: 1600, height: 900 }
const OUT_DIR = join(ROOT, 'docs', 'screenshots')
/** 生产形态用的非回环域名（与 capture-demo-gif / prodmode-check 同口径） */
const SHOTS_HOST = 'wls.shots.test'

const shots = []

async function main() {
  console.log('=== WebLockShot 实机截图采集 ===')
  const playwright = loadPlaywright()
  if (!playwright) skipEnv('实机截图采集', '未找到 playwright 包（项目 / 全局 / npx 缓存均无）')
  const { chromium } = playwright

  ensureDist({ skipBuild: SKIP_BUILD })
  mkdirSync(OUT_DIR, { recursive: true })

  let server = null
  let staticServer = null
  let browser = null
  let base = ''

  try {
    if (PROD) {
      const openssl = findOpenssl()
      if (!openssl) skipEnv('实机截图采集（生产形态）', '未找到 openssl（生成自签证书需要；Git for Windows 自带）')
      const port = randomPort(35_000)
      const tls = makeCert(openssl, { host: SHOTS_HOST, tmpDir: join(ROOT, '.tmp-shots-tls') })
      staticServer = await startStaticServer({ tls, port, distDir: join(ROOT, 'dist') })
      base = `https://${SHOTS_HOST}:${port}`
      console.log(`  · 生产形态（https + 非回环域名 · 无 tldraw 开发水印）：${base}`)
    } else {
      const port = randomPort(35_000)
      base = `http://127.0.0.1:${port}`
      server = startCompanionServer(port, { storage: 'memory', tmpDir: '.tmp-shots' })
      if (!(await waitHealthy(base))) throw new Error(`伴生服务未就绪（${base}）\n${server.getLog().slice(-600)}`)
      console.log(`  · 本机开发形态（http + 回环 · 会带 tldraw 开发水印）：${base}`)
    }

    browser = await chromium.launch({
      headless: true,
      args: PROD ? [`--host-resolver-rules=MAP ${SHOTS_HOST} 127.0.0.1`, '--ignore-certificate-errors'] : [],
    })
    const context = await browser.newContext({
      viewport: VIEWPORT,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
      ...(PROD ? { ignoreHTTPSErrors: true } : {}),
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)

    const shot = async (file, caption) => {
      const path = join(OUT_DIR, file)
      await page.screenshot({ path, fullPage: false })
      shots.push({ file, caption })
      console.log(`  ✔ ${file} — ${caption}`)
    }

    // ---------------- 画布线 ----------------
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 25_000 })
    await page.waitForTimeout(400)
    await shot('15_canvas_onboarding.png', '开场层：五类创作场景 tab + 大输入卡 + 连接器条（首访叠加）')

    await page.click('[data-testid=co-enter]')
    await page.waitForSelector('[data-testid=chat-dock]', { timeout: 10_000 })
    await page.waitForTimeout(600)
    await shot('16_canvas_workbench.png', '画布主界面：顶栏模式切换 + 节点面板 + 工具条 + 对话栏 + 右下小地图')

    await page.fill('.wls-chat-input', '给一款保温杯拍一条 30 秒竖屏带货短视频')
    await page.click('.wls-chat-send')
    await page.waitForFunction(
      () => /演示编排|LLM 编排/.test(document.querySelector('[data-testid=orchestration-notice]')?.textContent || ''),
      null,
      { timeout: 20_000 }
    )
    await page.waitForTimeout(800)
    await shot('17_canvas_orchestration.png', '对话栏一句话 → 演示编排落位节点拓扑（提示条如实标注「非真实 LLM」）')

    await page.click('[data-testid=open-skill-market]')
    await page.waitForSelector('[data-testid=skill-market-view]', { timeout: 10_000 })
    await page.waitForTimeout(500)
    await shot('18_canvas_skill_market.png', 'Skill 市场：官方内置 + 已安装分区（安装 / 启停 / 卸载 / 发布到本地）')
    await page.click('[data-testid=sm-close]')
    await page.waitForSelector('[data-testid=skill-market-view]', { state: 'detached', timeout: 8000 })

    await page.click('[data-testid=open-memory-graph]')
    await page.waitForSelector('[data-testid=memory-graph-view]', { timeout: 10_000 })
    await page.waitForFunction(
      () => !!document.querySelector('.mg-canvas') || !!document.querySelector('[data-testid=memory-graph-empty]'),
      null,
      { timeout: 15_000 }
    )
    await page.waitForTimeout(400)
    await shot('19_canvas_memory_graph_empty.png', '记忆图谱 · 真实空态（无回流记录时如实显示，不摆样例数据）')
    await page.click('[data-testid=memory-graph-close]')
    await page.waitForSelector('[data-testid=memory-graph-view]', { state: 'detached', timeout: 8000 })

    // 有数据态：脚本向本地 IndexedDB 写入 60 条结构化记录（图注如实说明来源）
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('weblockshot-feedback', 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('records')) {
            const store = db.createObjectStore('records', { keyPath: 'id' })
            store.createIndex('templateId', 'templateId')
          }
        }
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('records', 'readwrite')
          const store = tx.objectStore('records')
          for (let i = 0; i < 60; i++) {
            store.put({
              id: `shot_demo_${i}`,
              videoTitle: `示例视频 ${i + 1}`,
              templateId: `structure-${(i % 5) + 1}`,
              hookIndex: i % 6,
              hookType: `hook-${(i % 4) + 1}`,
              category: ['美妆护肤', '数码潮玩', '服饰穿搭'][i % 3],
              view3sRate: i % 10 >= 3 ? 0.42 : 0.18,
              completionRate: 0.35,
              createdAt: Date.now() - i * 3_600_000,
            })
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      })
    })
    await page.click('[data-testid=open-memory-graph]')
    await page.waitForSelector('.mg-canvas', { timeout: 15_000 })
    await page.waitForTimeout(600)
    await shot('19b_canvas_memory_graph_data.png', '记忆图谱（演示数据：由截图脚本写入本地 IndexedDB 的 60 条记录，非产品内置样例）')
    await page.click('[data-testid=memory-graph-close]')
    await page.waitForSelector('[data-testid=memory-graph-view]', { state: 'detached', timeout: 8000 })

    await page.locator('.wls-palette-item', { hasText: '3D 运镜台' }).first().click()
    await page.waitForTimeout(400)
    await page.evaluate(() => {
      window.__wlsEditor?.zoomToFit()
    })
    await page.locator('[data-testid=stage3d-enter]').last().click()
    await page.waitForSelector('[data-testid=stage3d-studio]', { timeout: 15_000 })
    // 摆台演示：加素体 + 加机位 + 应用程序化场景预设（截图需体现真实能力，不是空场景）
    await page.click('[data-testid=s3-add-character]')
    await page.waitForTimeout(600)
    await page.click('[data-testid=s3-add-camera]')
    await page.waitForTimeout(400)
    await page.click('[data-testid=s3-scene-studio]')
    await page.waitForTimeout(2500)
    await shot('20_canvas_stage3d.png', '3D 运镜台：素体 + 程序化场景预设（影棚）+ 多机位 + 关键帧时间轴（本地预演 · 0 灵感币）')
    await page.click('[data-testid=s3-back]')
    await page.waitForSelector('[data-testid=stage3d-studio]', { state: 'detached', timeout: 8000 })

    await page.click('[data-testid=open-scene-gallery]')
    await page.waitForSelector('[data-testid=scene-gallery]', { timeout: 10_000 })
    await page.waitForTimeout(500)
    await shot('21_canvas_scene_gallery.png', '创作场景画廊：六类场景卡片（预填对话栏 / 一键编排）')
    await page.click('[data-testid=sg-close]')
    await page.waitForSelector('[data-testid=scene-gallery]', { state: 'detached', timeout: 8000 })

    await page.click('[data-testid=open-connectors]')
    await page.waitForSelector('[data-testid=connector-panel]', { timeout: 10_000 })
    await page.waitForTimeout(500)
    await shot('22_canvas_connectors.png', '连接器面板：推荐目录 + 自定义添加（如实标注纯前端模式 / 仅接口）')
    await page.click('[data-testid=cp-close]')
    await page.waitForSelector('[data-testid=connector-panel]', { state: 'detached', timeout: 8000 })

    await page.click('[data-testid=toggle-language]')
    await page.waitForFunction(() => document.querySelector('.wls-palette-title')?.textContent === 'Agent nodes', null, {
      timeout: 8000,
    })
    await page.waitForTimeout(400)
    await shot('23_canvas_en.png', '英文界面（顶栏「🌐 中文 / EN」或设置面板「界面语言」切换，持久化）')
    await page.click('[data-testid=toggle-language]')
    await page.waitForTimeout(300)

    // ---------------- 带货线（含海外引擎） ----------------
    await page.goto(`${base}/?view=sell&mode=pipeline`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.pill-btn', { timeout: 25_000 })
    await page.waitForTimeout(800)
    await shot('24_sell_pipeline_engine_bar.png', '带货全链路工作台：顶部引擎条已含海外引擎 Runway / Luma（契约先行 · 待真实环境验证）')

    // ---------------- 短剧线（legacy） ----------------
    await page.goto(`${base}/?view=drama`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await shot('25_drama_legacy.png', '剧情短剧粗剪台（legacy：保留兼容与零回归，新创作建议走 Agent 画布）')
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (server) server.child.kill()
    if (staticServer) staticServer.close()
    await new Promise((r) => setTimeout(r, 150))
    try {
      rmSync(join(ROOT, '.tmp-shots'), { recursive: true, force: true })
    } catch {
      /* 清理失败不影响结果 */
    }
  }

  console.log(`\n共 ${shots.length} 张，已写入 docs/screenshots/`)
  process.exit(0)
}

main().catch((err) => {
  console.error('\n截图采集异常终止：', err instanceof Error ? err.message : err)
  process.exit(1)
})
