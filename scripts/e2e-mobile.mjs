#!/usr/bin/env node
/**
 * 移动端 / 触摸探针（TODO.md P0 的起点资产）
 *
 * 来源：2026-09-11 的临时探针（`.tmp/mobile-probe.mjs`），用于量出手机视口下到底哪里破了。
 * 当时实测（iPhone 12/13 视口 390×844，isMobile + hasTouch）：
 *   - `.wls-canvas-topbar` 390×223（桌面约 60px），按钮被挤成 42px 宽 → 文字竖排
 *   - `.wls-canvas-root` 969 宽（视口只有 390）→ 「画布空白」的直接原因
 *   - `.wls-chat-dock` 943 宽、`.wls-minimap` x=761（完全在视口外）
 *   - 横向溢出元素 129 个；`document.scrollWidth === 390`（溢出被裁剪，用户滑不过去）
 *   - 触摸目标全部 ≥24px（这一项没问题，问题在布局溢出）
 * 完整数据与根因、建议做法、验收标准见 `TODO.md` P0 章节。
 *
 * 当前状态：**探针**（打印 JSON 报告 + 截图 + 触摸一次），**不是断言式测试套件**。
 * P0 开工时需要在此基础补：
 *   1. 断言（溢出 = 0 / 顶栏 ≤120px / 画布 ≥45% 视口高 / 触摸可完成主流程）；
 *   2. 失败时 `process.exit(1)`（当前恒 exit 0，只用于取证）；
 *   3. `package.json` 增加 `"e2e:mobile"` 脚本并纳入 CI；
 *   4. **负向验收**：把旧 CSS 还原回去，套件必须立刻红。
 *
 * 用法：node scripts/e2e-mobile.mjs
 */
import { mkdirSync } from 'node:fs'
import {
  ensureDist,
  loadPlaywright,
  randomPort,
  startCompanionServer,
  waitHealthy,
} from './lib/browser-env.mjs'

const pw = loadPlaywright()
if (!pw) {
  console.log('未找到 playwright')
  process.exit(0)
}
ensureDist({ skipBuild: true })
mkdirSync('.tmp/mobile', { recursive: true })

const port = randomPort(39_000)
const base = `http://127.0.0.1:${port}`
const server = startCompanionServer(port, { storage: 'memory', tmpDir: '.tmp-mobile-srv' })
if (!(await waitHealthy(base))) throw new Error('伴生服务未就绪')

const browser = await pw.chromium.launch({ headless: true })
// iPhone 12/13 尺寸 + 触摸（isMobile + hasTouch 让 tldraw 走真实触摸路径）
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
})
const page = await ctx.newPage()
await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 30_000 })
await page.screenshot({ path: '.tmp/mobile/01-onboarding.png' })
await page.click('[data-testid=co-enter]')
await page.waitForSelector('[data-testid=chat-dock]', { timeout: 20_000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: '.tmp/mobile/02-canvas.png' })

const report = await page.evaluate(() => {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rect = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }
  // 横向溢出元素（右边界超出视口 2px 以上）
  const overflow = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 2) {
      overflow.push({
        cls: (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 2).join('.'),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 14),
        right: Math.round(r.right),
        w: Math.round(r.width),
      })
    }
  }
  // 触摸目标是否够大（WCAG 2.5.8 建议 ≥24×24；iOS HIG 建议 ≥44×44）
  const small = []
  for (const el of document.querySelectorAll('button, [role=button], a')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.width < 24 || r.height < 24) {
      small.push({
        cls: (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)[0],
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12),
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      })
    }
  }
  return {
    vw,
    vh,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    rects: {
      topbar: rect('.wls-canvas-topbar'),
      palette: rect('.wls-node-palette'),
      canvasRoot: rect('.wls-canvas-root'),
      chatDock: rect('.wls-chat-dock'),
      minimap: rect('.wls-minimap'),
      tlToolbar: rect('.tlui-main-toolbar__tools'),
      hint: rect('.wls-canvas-hint'),
      shortcuts: rect('.wls-shortcuts-toggle'),
    },
    overflowCount: overflow.length,
    overflowTop: overflow.slice(0, 12),
    smallTargets: small.length,
    smallTop: small.slice(0, 10),
  }
})

console.log(JSON.stringify(report, null, 1))

// 触摸一次：在画布上拖动，看 tldraw 是否响应（手势平移）
const before = await page.evaluate(() => window.__wlsEditor?.getCamera?.())
await page.touchscreen.tap(200, 400)
await page.waitForTimeout(300)
const afterTap = await page.evaluate(() => window.__wlsEditor?.getCamera?.())
console.log('\n触摸 tap 后相机变化:', JSON.stringify({ before, afterTap }))

await browser.close()
server.child.kill()
