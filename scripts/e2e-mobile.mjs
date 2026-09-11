#!/usr/bin/env node
/**
 * 移动端 / 触摸 E2E 套件（TODO.md P0 的固化验收）
 *
 * 来源：2026-09-11 的临时探针（`.tmp/mobile-probe.mjs`）→ 转正为 `scripts/e2e-mobile.mjs`（仅打印报告，恒 exit 0）
 *      → 本文件把它**断言化**并纳入 CI。历史实测与根因见 `TODO.md` P0 章节。
 *
 * 覆盖两个视口（均 isMobile + hasTouch，让 tldraw 走真实触摸路径）：
 *   · 390×844（iPhone 12/13）
 *   · 360×640（小屏 Android）
 *
 * 断言清单（每视口逐条判定，任一条不过 → exit 1）：
 *   A. 页面级（硬性）：`document.documentElement.scrollWidth === window.innerWidth`
 *   B. 元素级：**有效横向溢出 = 0** —— 排除「有 `overflow-x: auto|scroll` 且确实可滚动的祖先」的后代；
 *      并要求打印**无横滚祖先的溢出项清单**（防口径放宽变成遮丑）
 *   C. 顶栏高度 ≤ 120px
 *   D. 顶栏/工具条/节点面板内**无竖排（或换行）文字**（文本行盒数 > 1 即判失败）
 *   E. 画布区可见面积 ≥ 视口高度 45%（口径 = `.wls-canvas-root` 高度 / 视口高度，与 S1 验收一致）
 *   F. 小地图 / 快捷键提示已隐藏（display:none 或零尺寸）
 *   G. 触摸主流程（仅 390×844）：进入画布 → 对话栏发一句话 → 节点落位
 *
 * 口径说明（P0P1_PLAN.md §五「验收口径决策」）：
 *   - 横滚容器是方案指定的做法，其内部元素天然超出视口右边界；原始口径会让任何横滚设计恒不过关。
 *     故元素级只看「无横滚祖先」的溢出数量。本实现比口径**更严**：除 `overflow-x ∈ {auto,scroll}` 外，
 *     还要求该祖先**确实可滚动**（`scrollWidth > clientWidth`），避免「挂个 overflow:auto 就免疫」。
 *   - 已知诚实抖动：390 视口下原始溢出总数会出现 52↔53 的 ±1 抖动（首个越界项 right 落在阈值附近，
 *     亚像素/滚动位取整所致）。**总数不写进断言**，判定只看「无横滚祖先」的数量（必须为 0）。
 *
 * 用法：
 *   npm run e2e:mobile                 # 构建（dist 缺失时）+ 起伴生服务 + 双视口断言
 *   npm run e2e:mobile -- --skip-build # 复用现有 dist（CI / 快速回归）
 *   npm run e2e:mobile -- --headed     # 有头模式（排障）
 *
 * 诚实边界：
 *   - Playwright 未安装 / 浏览器未下载 → 打印指引并 exit 0（不伪装通过、不阻塞 CI）
 *   - 任一条断言失败 → 打印「哪个断言 / 实测值 / 期望值」并 exit 1
 *   - 伴生服务用 WLS_STORAGE=memory 起在随机端口，不触碰本机 sqlite / 草稿目录
 */
import { mkdirSync } from 'node:fs'
import {
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
const HEADED = FLAG('headed')

const pw = loadPlaywright()
if (!pw) {
  skipEnv('移动端 E2E', '未找到 playwright（npm i -D playwright && npx playwright install chromium）')
}

ensureDist({ skipBuild: SKIP_BUILD })
mkdirSync('.tmp/mobile', { recursive: true })

// ---------------- 阈值（与 TODO.md P0 验收标准一一对应） ----------------
const TOPBAR_MAX_H = 120
const CANVAS_MIN_PCT = 45
const OVERFLOW_TOLERANCE_PX = 2
const VIEWPORTS = [
  { label: '390x844', width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { label: '360x640', width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
]

// ---------------- 断言收集 ----------------
const failures = []
const checks = []
function record(viewport, assertion, ok, actual, expected) {
  checks.push({ viewport, assertion, ok, actual, expected })
  if (ok) {
    console.log(`  ✔ [${viewport}] ${assertion}（实测 ${actual}）`)
  } else {
    failures.push({ viewport, assertion, actual, expected })
    console.error(`  ❌ [${viewport}] ${assertion} —— 实测 ${actual}，期望 ${expected}`)
  }
}

// ---------------- 页内量测（在浏览器上下文里执行） ----------------
function measureInPage(tolerance) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const shortCls = (el) =>
    (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 2).join('.')
  const shortText = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18)
  const rectOf = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }

  // 横滚祖先：overflow-x ∈ {auto, scroll} 且确实可滚动（比口径更严，防「挂个 overflow:auto 就免疫」）
  const isScroller = (el) => {
    const ox = getComputedStyle(el).overflowX
    return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1
  }
  const scrollableAncestor = (el) => {
    let p = el.parentElement
    while (p && p !== document.body) {
      if (isScroller(p)) return p
      p = p.parentElement
    }
    return null
  }

  // 横向溢出（右边界超出视口 tolerance 以上）
  const overflow = []
  const unowned = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + tolerance) {
      const a = scrollableAncestor(el)
      const item = {
        cls: shortCls(el),
        text: shortText(el),
        right: Math.round(r.right),
        ancestor: a ? shortCls(a) : null,
      }
      overflow.push(item)
      if (!a) unowned.push(item)
    }
  }

  // 竖排/换行检测：只统计**文本节点**的行盒（容差 8px 聚类），>1 行即失败。
  // 注意：必须按文本节点取 rect，不能对元素整体 selectNodeContents——否则
  // `.wls-palette-accent`（position:absolute 满高装饰条）会贡献一个「跨全高的 rect」，
  // 被聚类成第二行，造成假阳性（本套件首跑即踩到）。
  const lineCount = (el) => {
    const tops = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      if (!node.textContent || !node.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const r of range.getClientRects()) {
        if (r.width === 0 && r.height === 0) continue
        tops.push(r.top)
      }
    }
    tops.sort((a, b) => a - b)
    let lines = 0
    let last = -Infinity
    for (const t of tops) {
      if (t - last > 8) {
        lines++
        last = t
      }
    }
    return lines
  }
  const verticalText = []
  const textTargets = document.querySelectorAll(
    '.wls-canvas-topbar button, .wls-canvas-topbar h1, .wls-canvas-toolbar button, .wls-node-palette button'
  )
  for (const el of textTargets) {
    if (!(el.textContent || '').trim()) continue
    const lines = lineCount(el)
    if (lines > 1) verticalText.push({ cls: shortCls(el), text: shortText(el), lines })
  }

  const hidden = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return true
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return true
    const r = el.getBoundingClientRect()
    return r.width === 0 || r.height === 0
  }

  const canvasRoot = rectOf('.wls-canvas-root')
  const topbar = rectOf('.wls-canvas-topbar')
  return {
    vw,
    vh,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    rects: {
      topbar,
      canvasRoot,
      chatDock: rectOf('.wls-chat-dock'),
      minimap: rectOf('.wls-minimap'),
      shortcuts: rectOf('.wls-shortcuts-toggle'),
    },
    topbarH: topbar ? topbar.h : null,
    canvasPctOfViewport: canvasRoot ? Math.round((canvasRoot.h / vh) * 100) : null,
    overflowCount: overflow.length,
    effectiveOverflowCount: unowned.length,
    unownedOverflow: unowned,
    attribution: overflow,
    verticalText,
    minimapHidden: hidden('.wls-minimap'),
    shortcutsHidden: hidden('.wls-shortcuts'),
  }
}

// ---------------- 主流程 ----------------
const port = randomPort(39_000)
const base = `http://127.0.0.1:${port}`
const server = startCompanionServer(port, { storage: 'memory', tmpDir: '.tmp-mobile-srv' })
if (!(await waitHealthy(base))) throw new Error('伴生服务未就绪')

const browser = await pw.chromium.launch({ headless: !HEADED })
const reports = []

try {
  for (const vp of VIEWPORTS) {
    console.log(`\n===== 视口 ${vp.label} =====`)
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor,
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
      serviceWorkers: 'block',
    })
    const page = await ctx.newPage()
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 30_000 })
    await page.screenshot({ path: `.tmp/mobile/${vp.label}-01-onboarding.png` })
    await page.click('[data-testid=co-enter]')
    await page.waitForSelector('[data-testid=chat-dock]', { timeout: 20_000 })
    await page.waitForTimeout(1200)

    const r = await page.evaluate(measureInPage, OVERFLOW_TOLERANCE_PX)
    await page.screenshot({ path: `.tmp/mobile/${vp.label}-02-canvas.png` })
    reports.push({ label: vp.label, ...r })

    // A. 页面级硬性
    record(vp.label, 'A 页面无横向滚动（scrollWidth === innerWidth）', r.docScrollW === r.vw, `${r.docScrollW} vs ${r.vw}`, '相等')
    // B. 有效横向溢出 = 0（原始总数仅作信息打印，不判定）
    record(
      vp.label,
      'B 有效横向溢出 = 0（排除横滚容器后代）',
      r.effectiveOverflowCount === 0,
      `${r.effectiveOverflowCount} 项无横滚祖先（原始溢出总数 ${r.overflowCount}）`,
      '0 项'
    )
    // C. 顶栏高度
    record(vp.label, 'C 顶栏高度 ≤ 120px', r.topbarH !== null && r.topbarH <= TOPBAR_MAX_H, `${r.topbarH}px`, `≤ ${TOPBAR_MAX_H}px`)
    // D. 无竖排文字
    record(
      vp.label,
      'D 顶栏/工具条/节点面板无竖排（换行）文字',
      r.verticalText.length === 0,
      r.verticalText.length === 0
        ? '0 处'
        : `${r.verticalText.length} 处：${JSON.stringify(r.verticalText.slice(0, 5))}${r.verticalText.length > 5 ? ' …' : ''}`,
      '0 处'
    )
    // E. 画布可见面积
    record(
      vp.label,
      'E 画布区可见面积 ≥ 视口高 45%',
      r.canvasPctOfViewport !== null && r.canvasPctOfViewport >= CANVAS_MIN_PCT,
      `${r.canvasPctOfViewport}%（画布 ${r.rects.canvasRoot ? r.rects.canvasRoot.h : '?'}px / 视口 ${r.vh}px）`,
      `≥ ${CANVAS_MIN_PCT}%`
    )
    // F. 小地图 / 快捷键隐藏
    record(vp.label, 'F-1 小地图已隐藏', r.minimapHidden === true, r.minimapHidden ? '隐藏' : '仍可见', '隐藏')
    record(vp.label, 'F-2 快捷键提示已隐藏', r.shortcutsHidden === true, r.shortcutsHidden ? '隐藏' : '仍可见', '隐藏')

    // 归属清单（人工核验用；§五 要求逐项核验「溢出元素 → 可滚动祖先」）
    console.log(`  · 溢出归属清单（${r.overflowCount} 项，原始口径）`)
    if (r.overflowCount === 0) {
      console.log('    （无）')
    } else {
      for (const it of r.attribution) {
        console.log(`    · ${it.cls || '(无类名)'} [${it.text}] right=${it.right} → 横滚祖先: ${it.ancestor ?? '⛔ 无（有效溢出！）'}`)
      }
    }
    console.log(`  · 无横滚祖先的溢出项：${r.unownedOverflow.length === 0 ? '无 ✅' : JSON.stringify(r.unownedOverflow)}`)

    // G. 触摸主流程（仅 390×844）：进入画布 → 对话栏发一句话 → 节点落位
    if (vp.label === '390x844') {
      const before = await page.evaluate(() => window.__wlsEditor?.getCurrentPageShapes?.().length ?? -1)
      let after = before
      let touchErr = null
      try {
        await page.locator('input.wls-chat-input').tap()
        await page.locator('input.wls-chat-input').fill('做一条保温杯的带货短视频')
        await page.locator('button.wls-chat-send').tap()
        await page.waitForFunction(
          (n) => (window.__wlsEditor?.getCurrentPageShapes?.().length ?? 0) > n,
          before,
          { timeout: 20_000 }
        )
        after = await page.evaluate(() => window.__wlsEditor?.getCurrentPageShapes?.().length ?? -1)
      } catch (err) {
        touchErr = err instanceof Error ? err.message : String(err)
        after = await page.evaluate(() => window.__wlsEditor?.getCurrentPageShapes?.().length ?? -1)
      }
      await page.screenshot({ path: `.tmp/mobile/${vp.label}-03-touch-flow.png` })
      record(
        vp.label,
        'G 触摸可完成「进入画布 → 发一句话 → 节点落位」',
        touchErr === null && after > before,
        touchErr ? `异常：${touchErr}（节点 ${before} → ${after}）` : `节点 ${before} → ${after}`,
        '节点数递增'
      )
    }

    await ctx.close()
  }
} finally {
  await browser.close()
  server.child.kill()
}

// ---------------- 汇总 ----------------
console.log('\n===== 关键数字汇总 =====')
for (const r of reports) {
  console.log(
    `· ${r.label}: topbar=${r.topbarH}px canvasRoot=${r.rects.canvasRoot ? `${r.rects.canvasRoot.w}x${r.rects.canvasRoot.h}` : '?'} ` +
      `(${r.canvasPctOfViewport}%) chatDock=${r.rects.chatDock ? r.rects.chatDock.w : '?'}px ` +
      `scrollW=${r.docScrollW} 原始溢出=${r.overflowCount} 有效溢出=${r.effectiveOverflowCount} ` +
      `小地图=${r.minimapHidden ? '隐藏' : '可见'} 快捷键=${r.shortcutsHidden ? '隐藏' : '可见'}`
  )
}

const total = checks.length
if (failures.length === 0) {
  console.log(`\n=== 移动端 E2E：${total}/${total} 条断言全过 ===`)
  process.exit(0)
}
console.log(`\n=== 移动端 E2E：${total - failures.length}/${total} 条断言通过，${failures.length} 条失败 ===`)
for (const f of failures) {
  console.log(`  ✗ [${f.viewport}] ${f.assertion} —— 实测 ${f.actual}，期望 ${f.expected}`)
}
process.exit(1)
