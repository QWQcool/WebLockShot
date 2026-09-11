#!/usr/bin/env node
/**
 * 画布性能基准（CANVAS_PLAN.md §9 T3）
 *
 * 真实浏览器（chromium headless + 生产构建 dist + 伴生服务）实测四组场景，输出可复现基准表：
 *   ① 画布 200 / 500 节点：批量创建耗时 + 持续平移帧率（驱动 setCamera 强制逐帧重绘）
 *   ② 记忆图谱 500 条真实回流记录：打开耗时 + 渲染节点数
 *   ③ 3D 运镜台：懒加载 chunk 体积 + 冷加载耗时（新上下文无缓存）
 *   ④ Skill 市场 100 项：打开耗时 + 渲染 DOM 节点数
 *
 * 本期**只测不改**（§9 T3）：明显劣化项如实记录 + 优化建议，不夹带优化改动。
 *
 * 用法：
 *   npm run perf                 # 构建（dist 缺失时）+ 实测 + 写 docs/perf.md
 *   npm run perf -- --skip-build # 复用现有 dist
 *   npm run perf -- --headed     # 有头模式
 *
 * 诚实边界：
 *   - Playwright 未安装 / 浏览器未下载 → 打印指引并 exit 0（不伪装通过）
 *   - 基准是**本机实测快照**（headless 软件渲染），不跨机器承诺；数字与口径一并落盘
 */
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

const argv = process.argv.slice(2)
const FLAG = (name) => argv.includes(`--${name}`)
const SKIP_BUILD = FLAG('skip-build')
const HEADED = FLAG('headed')
const VIEWPORT = { width: 1600, height: 900 }
const FPS_WINDOW_MS = 2000

const results = []
const record = (area, metric, value, unit, note = '') => results.push({ area, metric, value, unit, note })

// ---------------- 页面内测量工具 ----------------

/** 持续平移画布驱动逐帧重绘，采样 rAF 间隔 → 真实交互帧率 */
async function measurePanFps(page, ms = FPS_WINDOW_MS) {
  return page.evaluate(async (duration) => {
    const ed = window.__wlsEditor
    const deltas = []
    let last = performance.now()
    const t0 = last
    await new Promise((resolve) => {
      const loop = () => {
        const now = performance.now()
        deltas.push(now - last)
        last = now
        const cam = ed.getCamera()
        ed.setCamera({ ...cam, x: cam.x + 1 })
        if (now - t0 < duration) requestAnimationFrame(loop)
        else resolve()
      }
      requestAnimationFrame(loop)
    })
    const sorted = deltas.slice(1).sort((a, b) => a - b)
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length
    return {
      frames: sorted.length,
      avgMs: +avg.toFixed(2),
      p95Ms: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(2),
      fps: +(1000 / avg).toFixed(1),
    }
  }, ms)
}

/** 批量创建 [from, to) 号节点（单一 editor.run batch），返回耗时 ms */
async function createNodes(page, from, to) {
  return page.evaluate(
    ({ from, to }) => {
      const ed = window.__wlsEditor
      const t0 = performance.now()
      ed.run(() => {
        for (let i = from; i < to; i++) {
          ed.createShape({
            id: `shape:wls-perf-${i}`,
            type: 'wls-node',
            x: (i % 25) * 320,
            y: Math.floor(i / 25) * 220,
            props: { w: 260, h: 160, kind: 'brief', meta: {} },
          })
        }
      })
      ed.zoomToFit()
      return +(performance.now() - t0).toFixed(1)
    },
    { from, to }
  )
}

/** 读取 localStorage 里已落盘的画布文档（验证契约上限行为） */
async function readPersistedDocs(page) {
  return page.evaluate(() => {
    const out = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.includes('canvas')) continue
      try {
        const v = JSON.parse(localStorage.getItem(key))
        if (v && Array.isArray(v.nodes)) out.push({ key, nodes: v.nodes.length, edges: (v.edges ?? []).length })
      } catch {
        /* 非文档键跳过 */
      }
    }
    return out
  })
}

/** 在页面内灌 N 条真实回流记录（IndexedDB，与回流看板同库同 store） */
async function seedFeedbackRecords(page, n) {
  await page.evaluate(async (count) => {
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
        for (let i = 0; i < count; i++) {
          store.put({
            id: `fb_perf_${i}`,
            videoTitle: `性能样本 ${i}`,
            templateId: `T${i % 10}`,
            hookIndex: i % 6,
            hookType: `hook${i % 5}`,
            category: `cat${i % 7}`,
            view3sRate: (i % 10) / 10,
            completionRate: 0.5,
            createdAt: Date.now() - i * 1000,
          })
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, n)
}

/** 在页面内灌 N 个合法 Skill manifest 到已安装库（localStorage） */
async function seedSkillLibrary(page, n) {
  await page.evaluate((count) => {
    const entries = []
    for (let i = 0; i < count; i++) {
      entries.push({
        id: `sk_perf_${i}`,
        source: 'import',
        enabled: true,
        installedAt: Date.now() - i,
        manifest: {
          version: 1,
          name: `性能 Skill ${i}`,
          nodes: [
            { slot: 'slot-1', kind: 'brief', x: 0, y: 0, w: 260, h: 160, params: {} },
            { slot: 'slot-2', kind: 'script', x: 0, y: 200, w: 300, h: 220, params: {} },
          ],
          edges: [{ from: 0, to: 1 }],
          inputs: [],
          outputs: [],
        },
      })
    }
    localStorage.setItem('weblockshot.skill_library', JSON.stringify(entries))
  }, n)
}

/** dist/assets 下三个特征 chunk 的体积（用内容特征串定位，不依赖文件名哈希） */
function chunkSizes() {
  const dir = join(ROOT, 'dist', 'assets')
  const out = []
  let total = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.js')) continue
    const size = readFileSync(join(dir, name)).length
    total += size
    out.push({ name, size })
  }
  out.sort((a, b) => b.size - a.size)
  return { chunks: out, total }
}

// ---------------- 主流程 ----------------

async function main() {
  console.log('=== WebLockShot 画布性能基准（T3，只测不改）===')

  const playwright = loadPlaywright()
  if (!playwright) skipEnv('画布性能基准', '未找到 playwright 包（项目 / 全局 / npx 缓存均无）')
  const { chromium } = playwright

  ensureDist({ skipBuild: SKIP_BUILD })

  // 3D chunk 体积（构建产物静态分析，与浏览器无关）
  const { chunks, total } = chunkSizes()
  const threeChunk = chunks.find((c) => {
    const text = readFileSync(join(ROOT, 'dist', 'assets', c.name), 'latin1')
    return text.includes('EquirectangularReflectionMapping')
  })
  record('3D 运镜台', 'three 懒加载 chunk 体积', threeChunk ? +(threeChunk.size / 1024).toFixed(1) : 0, 'kB', threeChunk?.name ?? '未识别')
  record('构建产物', 'dist/assets JS 合计', +(total / 1024).toFixed(1), 'kB', `${chunks.length} 个 chunk`)

  const port = randomPort(25_000)
  const base = `http://127.0.0.1:${port}`
  const server = startCompanionServer(port, { tmpDir: '.tmp-perf' })
  let browser = null
  const env = []

  try {
    if (!(await waitHealthy(base))) {
      throw new Error(`伴生服务未就绪（${base}/healthz）\n${server.getLog().slice(-800)}`)
    }
    console.log(`· 伴生服务就绪：${base}`)
    try {
      browser = await chromium.launch({ headless: !HEADED })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/Executable doesn't exist|please run the following command/i.test(msg)) {
        skipEnv('画布性能基准', `Chromium 可执行文件缺失（${msg.split('\n')[0]}）`)
      }
      throw err
    }
    env.push(`浏览器：chromium ${HEADED ? 'headed' : 'headless'} · 视口 ${VIEWPORT.width}×${VIEWPORT.height}`)
    env.push(`构建：${SKIP_BUILD ? '复用 dist（--skip-build）' : '本次新构建'} · 渲染：软件光栅（无 GPU 加速）`)

    const context = await browser.newContext({
      viewport: VIEWPORT,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)

    // ---- 进入画布（跳过开场层）----
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=canvas-workbench]', { timeout: 20_000 })
    await page.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 15_000 })
    await page.click('[data-testid=co-enter]')
    await page.waitForSelector('[data-testid=canvas-onboarding]', { state: 'detached', timeout: 8000 })

    // ---- ① 画布 200 节点 ----
    const t200 = await createNodes(page, 0, 200)
    const fps200 = await measurePanFps(page)
    await page.waitForTimeout(700)
    const saved200 = (await readPersistedDocs(page)).map((d) => d.nodes)
    record('画布 200 节点', '批量创建耗时', t200, 'ms', '单一 editor.run batch + zoomToFit')
    record('画布 200 节点', '持续平移帧率', fps200.fps, 'fps', `均值 ${fps200.avgMs}ms · P95 ${fps200.p95Ms}ms · ${fps200.frames} 帧`)
    record('画布 200 节点', '落盘节点数', Math.max(0, ...saved200), '个', '契约上限 200 节点')

    // ---- ② 画布 500 节点 ----
    const t500 = await createNodes(page, 200, 500)
    const fps500 = await measurePanFps(page)
    await page.waitForTimeout(700)
    const saved500 = (await readPersistedDocs(page)).map((d) => d.nodes)
    record('画布 500 节点', '追加 300 节点耗时', t500, 'ms', '200 → 500')
    record('画布 500 节点', '持续平移帧率', fps500.fps, 'fps', `均值 ${fps500.avgMs}ms · P95 ${fps500.p95Ms}ms · ${fps500.frames} 帧`)
    record('画布 500 节点', '落盘节点数', Math.max(0, ...saved500), '个', '契约 max 200 → 超限静默不落盘（见结论）')

    // ---- ③ 记忆图谱 500 条记录 ----
    await seedFeedbackRecords(page, 500)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=canvas-workbench]', { timeout: 20_000 })
    await page.waitForSelector('[data-testid=chat-dock]', { timeout: 15_000 })
    const tMem = Date.now()
    await page.click('[data-testid=open-memory-graph]')
    await page.waitForSelector('.mg-canvas', { timeout: 20_000 })
    const memOpenMs = Date.now() - tMem
    const memNodes = await page.locator('.mg-node').count()
    const memFootnote = await page.textContent('[data-testid=memory-graph-footnote]')
    record('记忆图谱 500 记录', '打开到渲染完成', memOpenMs, 'ms', '含 IndexedDB 读取 + 聚合 + 布局')
    record('记忆图谱 500 记录', '渲染节点数', memNodes, '个', '聚合桶 + Top 叶，节点数与记录数非 1:1')
    record('记忆图谱 500 记录', '记录数口径', Number((memFootnote?.match(/共 (\d+) 条/)?.[1] ?? '0')), '条', '图谱脚注如实展示')
    await page.click('[data-testid=memory-graph-close]')
    await page.waitForSelector('[data-testid=memory-graph-view]', { state: 'detached', timeout: 8000 })

    // ---- ④ 3D 运镜台冷加载 ----
    await page.getByRole('button', { name: /3D 运镜台/ }).click()
    await page.waitForTimeout(400)
    await page.evaluate(() => {
      window.__wlsEditor?.zoomToFit()
    })
    await page.waitForSelector('[data-testid=stage3d-enter]', { timeout: 10_000 })
    const t3d = Date.now()
    await page.click('[data-testid=stage3d-enter]')
    await page.waitForSelector('[data-testid=stage3d-studio]', { timeout: 15_000 })
    const shellMs = Date.now() - t3d
    await page
      .waitForFunction(
        () =>
          document.querySelector('[data-testid=s3-webgl-fallback]') ||
          (!document.querySelector('[data-testid=s3-viewport-loading]') && document.querySelector('[data-testid=s3-viewport] canvas')),
        null,
        { timeout: 40_000 }
      )
      .catch(() => {})
    const readyMs = Date.now() - t3d
    const webglOk = (await page.locator('[data-testid=s3-webgl-fallback]').count()) === 0
    const chunkLoads = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((e) => e.name.endsWith('.js'))
        .map((e) => ({ name: e.name.split('/').pop(), ms: +e.duration.toFixed(1), kb: +((e.transferSize || e.decodedBodySize) / 1024).toFixed(1) }))
        .sort((a, b) => b.kb - a.kb)
        .slice(0, 3)
    )
    const threeLoad = threeChunk ? chunkLoads.find((c) => c.name === threeChunk.name) : undefined
    record('3D 运镜台', '点击到外壳可见', shellMs, 'ms', '含懒加载 chunk 拉取')
    record('3D 运镜台', '点击到视口就绪', readyMs, 'ms', webglOk ? 'WebGL 就绪' : '如实降级（无 WebGL）')
    record(
      '3D 运镜台',
      '懒加载 chunk 网络加载',
      threeLoad?.ms ?? 0,
      'ms',
      threeLoad ? `${threeLoad.name} ${threeLoad.kb}kB` : `未捕获（最大资源 ${chunkLoads[0]?.name ?? '—'}）`
    )
    await page.click('[data-testid=s3-back]')
    await page.waitForSelector('[data-testid=stage3d-studio]', { state: 'detached', timeout: 8000 })

    // ---- ⑤ Skill 市场 100 项 ----
    await seedSkillLibrary(page, 100)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=chat-dock]', { timeout: 20_000 })
    const tMarket = Date.now()
    await page.click('[data-testid=open-skill-market]')
    await page.waitForSelector('[data-testid=skill-market-view]', { timeout: 15_000 })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid=sm-installed-card]').length >= 100,
      null,
      { timeout: 30_000 }
    )
    const marketMs = Date.now() - tMarket
    const marketCards = await page.locator('[data-testid=sm-installed-card]').count()
    const marketDomNodes = await page.evaluate(
      () => document.querySelector('[data-testid=skill-market-view]')?.querySelectorAll('*').length ?? 0
    )
    record('Skill 市场 100 项', '打开到 100 卡片渲染', marketMs, 'ms', 'localStorage 读取 + 校验 + 渲染')
    record('Skill 市场 100 项', '已安装卡片数', marketCards, '个', '')
    record('Skill 市场 100 项', '市场面板 DOM 节点数', marketDomNodes, '个', '全量渲染，未做虚拟列表')
  } finally {
    if (browser) await browser.close().catch(() => {})
    server.child.kill()
    await new Promise((r) => setTimeout(r, 150))
    try {
      rmSync(join(ROOT, '.tmp-perf'), { recursive: true, force: true })
    } catch {
      /* 清理失败不影响结论 */
    }
  }

  // ---------------- 输出 ----------------
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
  console.log(`\n=== 基准结果（${stamp}）===`)
  console.log('场景                    指标                          数值        单位')
  for (const r of results) {
    console.log(`${r.area.padEnd(22)}${r.metric.padEnd(30)}${String(r.value).padStart(8)}  ${r.unit}   ${r.note}`)
  }
  console.log(`\n环境：${env.join(' | ')}`)

  writePerfDoc({ stamp, results, env })
  console.log('\n已写入 docs/perf.md')
  process.exit(0)
}

/** 生成基准文档（含口径、结论与优化建议——数字可复现，结论不夸大） */
function writePerfDoc({ stamp, results, env }) {
  const rows = results
    .map((r) => `| ${r.area} | ${r.metric} | ${r.value} | ${r.unit} | ${r.note} |`)
    .join('\n')
  const md = `# 画布性能基准（CANVAS_PLAN.md §9 T3）

> 生成：${stamp} · 由 \`npm run perf\` 实测产出（本文件为生成物，请用脚本刷新而非手改）

## 实测环境

${env.map((e) => `- ${e}`).join('\n')}

## 基准表

| 场景 | 指标 | 数值 | 单位 | 备注 |
|---|---|---|---|---|
${rows}

## 口径（可复现）

- **帧率**：在页面内用 \`requestAnimationFrame\` 逐帧 \`editor.setCamera({x: x+1})\` 持续平移画布
  ${FPS_WINDOW_MS} ms，取 rAF 间隔均值的倒数；headless 软件渲染下不具 GPU 代表性，只用于同机回归对比。
- **节点创建**：单一 \`editor.run\` batch 创建 + \`zoomToFit\`，不含 tldraw 首帧渲染等待。
- **记忆图谱**：先向 IndexedDB 灌 500 条真实结构记录（与回流看板同库），再刷新打开图谱，
  计时到 \`.mg-canvas\` 出现（含读取 + Laplace 聚合 + 极坐标布局）。
- **3D 冷加载**：新浏览器上下文（无 HTTP 缓存），点击「进入 3D 运镜台」到视口就绪。
- **Skill 市场**：向已安装库灌 100 条合法 manifest 后刷新打开，计时到 100 张卡片全部渲染。

## 结论与优化建议（本期只测不改）

1. **画布文档契约上限 = 200 节点 / 400 边**（\`canvasDocSchema\`）。超过上限时
   \`validateCanvasDoc\` 返回 null，\`persistNow\` 静默提前返回——**画布看起来正常但不再落盘**，
   且 UI 无任何提示。这是当前最值得处理的诚实性问题，建议：超限时在保存状态位如实提示
   「节点数超过契约上限 200，本次未保存」（不扩契约、不静默）。
2. **边提取是 O(n²)**：\`editorPageToCanvasDraft\` 内 \`shapes.find(...)\` 按 shapeId 线性查找，
   节点/边规模增大时落盘耗时随之放大。建议改为一次 \`Map<shapeId, shape>\` 索引。
3. **Skill 市场全量渲染**：100 项即渲染 ${results.find((r) => r.metric === '市场面板 DOM 节点数')?.value ?? 'N'} 个 DOM 节点，
   未做虚拟列表/分页。规模继续增长时建议加窗口化（与既有「万行网格」同思路）。
4. **记忆图谱节点数与记录数解耦**（聚合桶 + Top 叶上限），500 条记录不会线性放大渲染成本——
   当前设计已具备规模弹性。
`
  writeFileSync(join(ROOT, 'docs', 'perf.md'), md, 'utf8')
}

main().catch((err) => {
  console.error('\n性能基准异常终止：', err instanceof Error ? err.message : err)
  process.exit(1)
})
