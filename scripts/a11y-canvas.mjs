#!/usr/bin/env node
/**
 * 跨浏览器抽查 + 可访问性扫描（CANVAS_PLAN.md §9 T4）
 *
 * 两件事，同一套流程跑两个引擎（chromium / webkit）：
 *   ① 跨浏览器核心链路抽查：开场层 → 对话栏演示编排 → 节点落位 → Skill 市场 → 记忆图谱 → 3D 运镜台
 *   ② axe-core 基础扫描（WCAG 2.0 A/AA 标签）：画布主界面 / 3D 运镜台 / Skill 市场 / 记忆图谱，
 *      输出严重项（serious / critical）清单。
 *
 * 口径：
 *   - **不强制清零**（§9 T4 明确「不强制清零但需如实记录」），退出码恒为 0；
 *   - 引擎不可用（浏览器未下载）→ 如实记录 unavailable + 原因，不伪装通过；
 *   - 扫描结果落盘 `docs/a11y.md`（生成物，用脚本刷新）。
 *
 * 用法：
 *   npm run a11y                 # 构建（dist 缺失时）+ 双引擎 + 扫描 + 写 docs/a11y.md
 *   npm run a11y -- --skip-build
 *   npm run a11y -- --engine=chromium
 */
import { createRequire } from 'node:module'
import { rmSync, writeFileSync } from 'node:fs'
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

const require = createRequire(import.meta.url)
const argv = process.argv.slice(2)
const FLAG = (name) => argv.includes(`--${name}`)
const SKIP_BUILD = FLAG('skip-build')
const ENGINE_ARG = (argv.find((a) => a.startsWith('--engine=')) ?? '').split('=')[1]
const ENGINES = ENGINE_ARG ? [ENGINE_ARG] : ['chromium', 'webkit']
const VIEWPORT = { width: 1600, height: 900 }

const report = { engines: [], generatedAt: '' }

// ---------------- 核心链路抽查（每个引擎跑一遍） ----------------

/**
 * 打开 3D 运镜台：优先复用已存在的 stage3d 节点，没有则用左侧节点面板新建。
 * 注意不能按 /3D 运镜台/ 模糊匹配按钮——面板项与节点内「进入 3D 运镜台」会同时命中（strict mode 冲突）。
 */
async function openStage3D(page) {
  const entries = page.locator('[data-testid=stage3d-enter]')
  if ((await entries.count()) === 0) {
    await page.locator('.wls-palette-item', { hasText: '3D 运镜台' }).first().click()
    await page.waitForTimeout(400)
    await page.evaluate(() => {
      window.__wlsEditor?.zoomToFit()
    })
  }
  await page.locator('[data-testid=stage3d-enter]').last().click()
  await page.waitForSelector('[data-testid=stage3d-studio]', { timeout: 15_000 })
}

const CORE_CHECKS = [
  {
    name: '开场层首访可见 → 「进入画布」折叠为对话栏',
    run: async (page) => {
      await page.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 20_000 })
      await page.click('[data-testid=co-enter]')
      await page.waitForSelector('[data-testid=canvas-onboarding]', { state: 'detached', timeout: 8000 })
      if (!(await page.isVisible('[data-testid=chat-dock]'))) throw new Error('对话栏未出现')
    },
  },
  {
    name: '对话栏演示编排 → 节点落位（无 Key 走演示并如实标注）',
    run: async (page) => {
      await page.fill('.wls-chat-input', '给一款保温杯拍一条 30 秒竖屏带货短视频')
      await page.click('.wls-chat-send')
      await page.waitForFunction(
        () => /演示编排|LLM 编排/.test(document.querySelector('[data-testid=orchestration-notice]')?.textContent || ''),
        null,
        { timeout: 25_000 }
      )
      const count = await page.evaluate(() => window.__wlsEditor?.getCurrentPageShapes().filter((s) => s.type === 'wls-node').length ?? 0)
      if (count < 3) throw new Error(`编排后节点数不足（${count}）`)
    },
  },
  {
    name: 'Skill 市场打开/关闭',
    run: async (page) => {
      await page.click('[data-testid=open-skill-market]')
      await page.waitForSelector('[data-testid=skill-market-view]', { timeout: 12_000 })
      await page.click('[data-testid=sm-close]')
      await page.waitForSelector('[data-testid=skill-market-view]', { state: 'detached', timeout: 8000 })
    },
  },
  {
    name: '记忆图谱打开/关闭',
    run: async (page) => {
      await page.click('[data-testid=open-memory-graph]')
      await page.waitForSelector('[data-testid=memory-graph-view]', { timeout: 12_000 })
      await page.waitForFunction(
        () => !!document.querySelector('.mg-canvas') || !!document.querySelector('[data-testid=memory-graph-empty]'),
        null,
        { timeout: 15_000 }
      )
      await page.click('[data-testid=memory-graph-close]')
      await page.waitForSelector('[data-testid=memory-graph-view]', { state: 'detached', timeout: 8000 })
    },
  },
  {
    name: '3D 运镜台进入 → 场景预设 → 返回',
    run: async (page) => {
      await openStage3D(page)
      await page.click('[data-testid=s3-scene-studio]')
      const cls = await page.getAttribute('[data-testid=s3-scene-studio]', 'class')
      if (!/active/.test(cls || '')) throw new Error(`场景预设未激活：${cls}`)
      await page.click('[data-testid=s3-back]')
      await page.waitForSelector('[data-testid=stage3d-studio]', { state: 'detached', timeout: 8000 })
    },
  },
]

// ---------------- axe 扫描 ----------------

const AXE_TAGS = ['wcag2a', 'wcag2aa']

async function injectAxe(page) {
  const axePath = require.resolve('axe-core/axe.min.js')
  await page.addScriptTag({ path: axePath })
}

/**
 * 对当前界面跑一次 axe，返回 violations（只取 WCAG A/AA 标签）。
 * rootSelector：全屏覆盖层必须限定到覆盖层根，否则会把背后画布 DOM 一起算进来（实测过：
 * 市场/图谱扫描报出的全是画布里的 .wls-palette-phase）。
 */
async function scanAxe(page, label, rootSelector) {
  const res = await page.evaluate(
    async ({ tags, rootSelector }) => {
      const root = (rootSelector && document.querySelector(rootSelector)) || document
      const r = await window.axe.run(root, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'],
      })
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        target: v.nodes[0]?.target?.join(' ') ?? '',
        targets: [...new Set(v.nodes.map((n) => n.target?.join(' ') ?? ''))].slice(0, 12),
      }))
    },
    { tags: AXE_TAGS, rootSelector }
  )
  return { label, violations: res }
}

// ---------------- 主流程 ----------------

async function runEngine(playwright, engineName, base) {
  const entry = { engine: engineName, available: false, reason: '', core: [], scans: [] }
  const browserType = playwright[engineName]
  if (!browserType) {
    entry.reason = `playwright 无 ${engineName} 引擎导出`
    return entry
  }
  let browser = null
  try {
    try {
      browser = await browserType.launch({ headless: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      entry.reason = /Executable doesn't exist|please run the following command/i.test(msg)
        ? `浏览器未下载（${msg.split('\n')[0]}）`
        : msg.split('\n')[0]
      return entry
    }
    entry.available = true
    const context = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block', reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)

    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=canvas-workbench]', { timeout: 25_000 })
    await injectAxe(page)

    for (const check of CORE_CHECKS) {
      try {
        await check.run(page)
        entry.core.push({ name: check.name, ok: true })
      } catch (err) {
        entry.core.push({ name: check.name, ok: false, err: err instanceof Error ? err.message : String(err) })
      }
    }

    // ---- axe 扫描四态（复用上面流程留下的界面状态）----
    const states = [
      { label: '画布主界面（顶栏/节点面板/工具条/对话栏）', root: '[data-testid=canvas-workbench]', open: async () => {} },
      {
        label: '3D 运镜台',
        root: '[data-testid=stage3d-studio]',
        open: async () => {
          await openStage3D(page)
          await page.waitForTimeout(600)
        },
        close: async () => {
          await page.click('[data-testid=s3-back]')
          await page.waitForSelector('[data-testid=stage3d-studio]', { state: 'detached', timeout: 8000 })
        },
      },
      {
        label: 'Skill 市场',
        root: '[data-testid=skill-market-view]',
        open: async () => {
          await page.click('[data-testid=open-skill-market]')
          await page.waitForSelector('[data-testid=skill-market-view]', { timeout: 12_000 })
          await page.waitForTimeout(400)
        },
        close: async () => {
          await page.click('[data-testid=sm-close]')
          await page.waitForSelector('[data-testid=skill-market-view]', { state: 'detached', timeout: 8000 })
        },
      },
      {
        label: '记忆图谱',
        root: '[data-testid=memory-graph-view]',
        open: async () => {
          await page.click('[data-testid=open-memory-graph]')
          await page.waitForSelector('[data-testid=memory-graph-view]', { timeout: 12_000 })
          await page.waitForTimeout(600)
        },
        close: async () => {
          await page.click('[data-testid=memory-graph-close]')
          await page.waitForSelector('[data-testid=memory-graph-view]', { state: 'detached', timeout: 8000 })
        },
      },
    ]
    for (const state of states) {
      try {
        await state.open()
        entry.scans.push(await scanAxe(page, state.label, state.root))
        await state.close?.()
      } catch (err) {
        entry.scans.push({ label: state.label, violations: null, err: err instanceof Error ? err.message : String(err) })
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
  return entry
}

async function main() {
  console.log('=== WebLockShot 跨浏览器 + a11y 扫描（T4）===')

  const playwright = loadPlaywright()
  if (!playwright) skipEnv('跨浏览器 + a11y 扫描', '未找到 playwright 包（项目 / 全局 / npx 缓存均无）')

  ensureDist({ skipBuild: SKIP_BUILD })

  const port = randomPort(27_000)
  const base = `http://127.0.0.1:${port}`
  const server = startCompanionServer(port, { tmpDir: '.tmp-a11y' })
  try {
    if (!(await waitHealthy(base))) {
      throw new Error(`伴生服务未就绪（${base}/healthz）\n${server.getLog().slice(-800)}`)
    }
    console.log(`· 伴生服务就绪：${base}`)
    for (const engine of ENGINES) {
      console.log(`\n· 引擎 ${engine} …`)
      const entry = await runEngine(playwright, engine, base)
      report.engines.push(entry)
      if (!entry.available) {
        console.log(`  ⚠️  ${engine} 不可用：${entry.reason}`)
        continue
      }
      for (const c of entry.core) console.log(`  ${c.ok ? '✔' : '❌'} ${c.name}${c.ok ? '' : ` —— ${c.err}`}`)
      for (const s of entry.scans) {
        if (s.violations === null) console.log(`  ⚠️  axe(${s.label}) 未完成：${s.err}`)
        else console.log(`  · axe(${s.label})：${s.violations.length} 项违规`)
      }
    }
  } finally {
    server.child.kill()
    await new Promise((r) => setTimeout(r, 150))
    try {
      rmSync(join(ROOT, '.tmp-a11y'), { recursive: true, force: true })
    } catch {
      /* 清理失败不影响结论 */
    }
  }

  report.generatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ')

  // ---------------- 汇总 ----------------
  console.log('\n=== 汇总 ===')
  for (const e of report.engines) {
    if (!e.available) {
      console.log(`${e.engine}: 不可用（${e.reason}）`)
      continue
    }
    const passed = e.core.filter((c) => c.ok).length
    const serious = e.scans
      .filter((s) => s.violations)
      .flatMap((s) => s.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ ...v, label: s.label })))
    console.log(`${e.engine}: 核心链路 ${passed}/${e.core.length} · axe 严重项 ${serious.length}`)
    for (const v of serious) console.log(`  🔴 [${v.impact}] ${v.id} @ ${v.label} ×${v.nodes} —— ${v.help}`)
  }

  writeA11yDoc(report)
  console.log('\n已写入 docs/a11y.md（不强制清零，如实记录）')
  process.exit(0)
}

function writeA11yDoc(rep) {
  const engineSections = rep.engines
    .map((e) => {
      if (!e.available) return `### ${e.engine}\n\n**不可用**：${e.reason}\n`
      const coreRows = e.core
        .map((c) => `| ${c.ok ? '✅' : '❌'} | ${c.name} | ${c.ok ? '' : c.err} |`)
        .join('\n')
      const scanSections = e.scans
        .map((s) => {
          if (s.violations === null) return `#### ${s.label}\n\n未完成：${s.err}\n`
          if (s.violations.length === 0) return `#### ${s.label}\n\n0 项违规（WCAG 2.0 A/AA 标签集）\n`
          const rows = s.violations
            .map((v) => `| ${v.impact} | \`${v.id}\` | ${v.nodes} | ${v.help} |`)
            .join('\n')
          const details = s.violations
            .map(
              (v) =>
                `- \`${v.id}\` 命中目标（前 ${v.targets?.length ?? 0} 个）：` +
                (v.targets ?? []).map((t) => `\`${t}\``).join('、')
            )
            .join('\n')
          return `#### ${s.label}\n\n| 影响 | 规则 | 命中节点 | 说明 |\n|---|---|---|---|\n${rows}\n\n${details}\n`
        })
        .join('\n')
      return `### ${e.engine}\n\n**核心链路抽查**\n\n| 结果 | 检查项 | 失败原因 |\n|---|---|---|\n${coreRows}\n\n**axe 扫描**\n\n${scanSections}\n`
    })
    .join('\n')

  const md = `# 跨浏览器 + 可访问性扫描（CANVAS_PLAN.md §9 T4）

> 生成：${rep.generatedAt} · 由 \`npm run a11y\` 实测产出（本文件为生成物，请用脚本刷新而非手改）

## 口径

- **跨浏览器抽查**：chromium / webkit 各跑一遍画布核心链路（开场层 → 演示编排 → Skill 市场 →
  记忆图谱 → 3D 运镜台），断言真实鼠标路径可用性。
- **a11y 扫描**：axe-core（WCAG 2.0 A/AA 标签集）在四个界面状态各扫一次，输出全部违规；
  严重项 = \`serious\` / \`critical\`。
- **不强制清零**（§9 T4 明确）：本报告如实记录，修复与否逐项在下方结论中说明。
- 引擎不可用（浏览器未下载）时如实标注 unavailable，不伪装通过。

## 结果

${engineSections}

## 结论与处理

（见下方「修复记录」；未修项在此说明原因）

## 本轮修复记录（T4 落地，静态记录——不随重跑丢失）

| 规则 | 影响 | 修复 |
|---|---|---|
| \`aria-required-children\` | critical | \`.mode-toggle\` 声明了 \`role="tablist"\` 但子按钮无 \`role="tab"\`；已为三个模式按钮补 \`role="tab"\` + \`aria-selected\`（CanvasWorkbench） |
| \`color-contrast\` | serious | 白字在初音青 \`#39c5bb\` 上仅 ~2.1:1：\`.logo-badge\` / \`.mode-btn.active\` / \`.wls-chat-send\` / \`.s3-tool.active\` 改深墨色 \`#16323f\`（~6.3:1） |
| \`color-contrast\` | serious | 画布中性色 \`--cv-mute\` \`#5b7a86\`（~4.5:1 边界值）→ \`#4a6873\`（~6.0:1），一处改动覆盖节点面板 phase 标签等全部中性文案 |
| \`color-contrast\` | serious | 3D 运镜台浅底上的浅灰文案 \`#8b99a2\` / \`#a3aeb5\` / \`#9aa8b0\`（~2.1–2.7:1）→ \`#5f6f79\`（~4.8:1） |
| \`color-contrast\` | serious | Skill 市场 \`.sm-empty\` / \`.sm-card-version\` \`#7b8a94\`（~3.6:1）、\`.sm-footnote\` \`#8b99a2\`（~2.7:1）→ \`#5f6f79\`；\`.sm-badge--official\` \`#b35f10\`（~4.3:1）→ \`#9a4f08\`（~5.5:1）；\`.sm-chip.active\` 底色 \`#e8721e\`（白字 ~3.1:1）→ \`#b3520a\`（~5.1:1） |

> 对比度为手工按 WCAG 相对亮度公式估算后取安全值，最终以 axe 复扫结果为准（本文件上方各状态扫描）。
> 修复仅改颜色，不改布局与交互。
`

  // 严重项统计写入结论
  const allSerious = []
  for (const e of rep.engines) {
    if (!e.available) continue
    for (const s of e.scans) {
      if (!s.violations) continue
      for (const v of s.violations) {
        if (v.impact === 'serious' || v.impact === 'critical') allSerious.push({ engine: e.engine, label: s.label, ...v })
      }
    }
  }
  const summary =
    allSerious.length === 0
      ? '无 serious / critical 级违规。'
      : `共 ${allSerious.length} 处 serious / critical 级违规（去重规则：\n${[...new Set(allSerious.map((v) => v.id))].map((id) => `- \`${id}\``).join('\n')}\n）。`
  writeFileSync(join(ROOT, 'docs', 'a11y.md'), md.replace('（见下方「修复记录」；未修项在此说明原因）', summary), 'utf8')
}

main().catch((err) => {
  console.error('\na11y 扫描异常终止：', err instanceof Error ? err.message : err)
  process.exit(1)
})
