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
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  NODE_SHAPE_TYPE,
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
const STEP_TIMEOUT = 30_000

const skip = (reason) => skipEnv('画布 E2E', reason)

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
  ensureDist({ skipBuild: SKIP_BUILD })

  // 2. 伴生服务
  const port = randomPort()
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
      // 本形态是 http://127.0.0.1 → tldraw 判定为开发环境（豁免），顶部说明条**不应**出现
      // 「5 秒停渲染」这类限制文案（2026-09-11 配置 license key 后的过期文案回归）。
      const hint = (await page.locator('.wls-canvas-hint').first().textContent()) || ''
      assert(!/5 秒停渲染/.test(hint), `开发/已授权形态不应出现 tldraw 限制文案：${hint.slice(0, 60)}`)
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

      // 回归（2026-09-11 线上白屏）：点「加人物」才会真正拉取 GLB。
      // 此前 E2E 只进出 3D 台、从不加人物，于是「模型 URL 根绝对路径 → 子路径 404 →
      // useGLTF 抛错 → 整页白屏」这一整类缺陷在四门槛下全绿溜到了线上。
      const errBefore = pageErrors.length
      await page.click('[data-testid=s3-add-character]')
      await page.waitForTimeout(2500)
      assert(
        (await page.locator('[data-testid=stage3d-studio]').count()) === 1,
        '「加人物」后 3D 台消失（疑似整页白屏）'
      )
      assert(
        await page.evaluate(() => typeof window.__s3poseMatched === 'number'),
        '素体模型未解析（加人物后仍是占位体，模型资源可能加载失败）'
      )
      assert(
        pageErrors.length === errBefore,
        `「加人物」触发 JS 异常：${pageErrors.slice(errBefore).join(' | ')}`
      )

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

    await step('⑥ i18n：切英文即时生效 + 刷新持久化 + 切回中文零残留', async () => {
      const paletteTitle = () => page.textContent('.wls-palette-title')
      const chatPlaceholder = () => page.getAttribute('.wls-chat-input', 'placeholder')
      assert((await paletteTitle()) === 'Agent 节点', `默认应为中文：${await paletteTitle()}`)

      await page.click('[data-testid=toggle-language]')
      await page.waitForFunction(() => document.querySelector('.wls-palette-title')?.textContent === 'Agent nodes', null, {
        timeout: 8000,
      })
      assert(/Describe what you want/.test((await chatPlaceholder()) || ''), `对话栏未切英文：${await chatPlaceholder()}`)
      // 节点面板标签也走 i18n（切语言后画布节点标题同步）
      assert(
        /WebLockShot · Agent Canvas/.test((await page.textContent('.brand-text h1')) || ''),
        '顶栏品牌未切英文'
      )

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid=chat-dock]', { timeout: 20_000 })
      assert((await paletteTitle()) === 'Agent nodes', `刷新后语言未持久化：${await paletteTitle()}`)

      await page.click('[data-testid=toggle-language]')
      await page.waitForFunction(() => document.querySelector('.wls-palette-title')?.textContent === 'Agent 节点', null, {
        timeout: 8000,
      })
      assert((await paletteTitle()) === 'Agent 节点', '切回中文失败')
    })

    await step('⑦ 海外引擎（M1）：引擎条可选 + 无 Key 灰态如实提示', async () => {
      // 引擎条在全链路工作台（sell + mode=pipeline）常驻
      await page.goto(`${base}/?view=sell&mode=pipeline`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.pill-btn', { timeout: 25_000 })
      const runwayBtn = page.locator('.pill-btn', { hasText: 'Runway' })
      assert((await runwayBtn.count()) === 1, '引擎条缺少 Runway 选项')
      assert((await page.locator('.pill-btn', { hasText: 'Luma' }).count()) === 1, '引擎条缺少 Luma 选项')
      const title = await runwayBtn.getAttribute('title')
      assert(/待真实环境验证/.test(title || ''), `海外引擎未如实标注验证状态：${title}`)

      // 无 Key 选中 → 必须给出「未检测到 … API Key」而非静默接受
      await runwayBtn.click()
      await page.waitForFunction(
        () => /未检测到 Runway API Key/.test(document.body.textContent || ''),
        null,
        { timeout: 8000 }
      )
    })

    await step('⑧ 海外引擎（M1）：设置面板 Key 输入 + 诚实标注', async () => {
      await page.goto(`${base}/?view=sell&mode=pipeline&settings=open`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('input[value=runway]', { timeout: 20_000 })
      await page.check('input[value=runway]')
      await page.waitForSelector('[data-testid=runway-key]', { timeout: 8000 })
      const hint = await page
        .locator('.form-item', { has: page.locator('[data-testid=runway-key]') })
        .textContent()
      assert(/待真实环境验证/.test(hint || ''), `Runway Key 区未标注验证状态：${hint?.slice(0, 140)}`)

      await page.check('input[value=luma]')
      await page.waitForSelector('[data-testid=luma-key]', { timeout: 8000 })
      const lumaHint = await page
        .locator('.form-item', { has: page.locator('[data-testid=luma-key]') })
        .textContent()
      assert(/待真实环境验证/.test(lumaHint || ''), `Luma Key 区未标注验证状态：${lumaHint?.slice(0, 140)}`)
    })

    // ---- ⑨ 节点管线「实跑」（R6 审计固化） ----
    // 此前所有步骤只**摆节点**、从不**执行节点动作**，于是「标注就绪但实际跑不通」这类缺陷
    // 完全没有覆盖。本步把整条链路真跑一遍：生成脚本 → 生成分镜 → 逐镜出片 → 打包剪映草稿 zip。
    await step('⑨ 节点管线实跑：生成脚本 → 生成分镜 → 逐镜出片 → 打包剪映草稿 zip', async () => {
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid=chat-dock]', { timeout: 20_000 })
      // 先清空画布：本步需要「唯一一套」节点与确定的上下游连线——前序步骤（3D 节点、多画布项目等）
      // 会在画布上留下节点，导致按 DOM 取节点时新旧混在一起、连线关系不确定（首版即踩此坑）。
      await page.locator('.wls-canvas-btn', { hasText: '清空画布' }).first().click()
      await page.waitForTimeout(700)
      await page.fill('.wls-chat-input', '给一款保温杯拍一条 30 秒竖屏带货短视频')
      await page.click('.wls-chat-send')
      await page.waitForFunction(
        () => /演示编排|LLM 编排/.test(document.querySelector('[data-testid=orchestration-notice]')?.textContent || ''),
        null,
        { timeout: 20_000 }
      )
      await page.waitForTimeout(900)

      const nodeText = (kind) =>
        page.evaluate((k) => {
          const el = [...document.querySelectorAll(`.wls-node[data-kind="${k}"]`)].pop()
          return el ? (el.innerText || '').replace(/\s+/g, ' ') : ''
        }, kind)
      const clickNodeBtn = async (kind, label) => {
        const r = await page.evaluate(
          ({ k, lp }) => {
            const el = [...document.querySelectorAll(`.wls-node[data-kind="${k}"]`)].pop()
            if (!el) return 'no-node'
            const b = [...el.querySelectorAll('button')].find((x) => (x.textContent || '').includes(lp))
            if (!b) return 'no-button'
            if (b.disabled) return 'disabled'
            b.click()
            return 'clicked'
          },
          { k: kind, lp: label }
        )
        assert(r === 'clicked', `${kind} 节点的「${label}」按钮不可用（${r}）`)
      }

      // ① 生成脚本（无 LLM Key → 演示编排，必须如实标注）
      // 等待条件直接盯「脚本节点自身」的文案：全局 body 文本里 Critic 会出现在别处（如节点提示），
      // 会造成「等到了但其实还没生成完」的假通过（首版即踩此坑）。
      await clickNodeBtn('script', '生成脚本')
      await page.waitForFunction(
        () => {
          const el = [...document.querySelectorAll('.wls-node[data-kind="script"]')].pop()
          return /演示 · 评分非真实/.test(el?.innerText || '')
        },
        null,
        { timeout: 25_000 }
      )

      // ② 生成分镜 → 6 镜 GSAP 预演
      // 注意：`wls-shotplan-shot` 属于 **D3 自由镜数分镜**（来自 3D 台），script→6 镜走的是
      // ShotStage 预演（节点内显示「镜 k/N」），两者不是同一渲染路径——首版断言用错 testid。
      await clickNodeBtn('storyboard', '生成分镜')
      await page.waitForFunction(
        () => {
          const el = [...document.querySelectorAll('.wls-node[data-kind="storyboard"]')].pop()
          return /镜 \d+\/\d+/.test(el?.innerText || '')
        },
        null,
        { timeout: 25_000 }
      )
      const sbText = await nodeText('storyboard')
      assert(/镜 1\/6/.test(sbText), `分镜未生成 6 镜：${sbText.slice(0, 160)}`)
      assert(/本地预演 · 非成片/.test(sbText), '分镜节点未如实标注「本地预演 · 非成片」')

      // ③ 逐镜出片（演示引擎；确认弹窗必须显式确认）
      await clickNodeBtn('generate', '开始逐镜出片')
      await page.waitForSelector('[data-testid=wls-generate-confirm-ok]', { timeout: 10_000 })
      await page.click('[data-testid=wls-generate-confirm-ok]')
      await page.waitForFunction(
        () => document.querySelectorAll('.wls-node[data-kind="asset"]').length > 0,
        null,
        { timeout: 45_000 }
      )
      assert(/播放/.test(await nodeText('asset')), '产物卡未进入可播放态')

      // ④ 打包剪映草稿 zip（真实下载）
      const downloadPromise = page.waitForEvent('download', { timeout: 25_000 })
      await clickNodeBtn('deliver', '打包剪映草稿')
      const download = await downloadPromise
      assert(/剪映草稿\.zip$/.test(download.suggestedFilename()), `下载文件名异常：${download.suggestedFilename()}`)
      assert(/已下载剪映草稿 zip/.test(await nodeText('deliver')), 'deliver 节点未给出打包成功反馈')
    })

    // ---- ⑩ 悬浮提示可读性守卫（白底白字回归） ----
    // 2026-09-11 用户实机反馈「鼠标移过去提示描述为空」。根因是浅色皮肤把 tldraw 的
    // `--tl-color-tooltip` 覆盖成白色，却没有同时改 `--tl-color-text-shadow`（light 主题下为白），
    // 于是 tooltip 变成**白底白字**——看起来就是一个空提示框。
    // 这条守卫直接量测 tooltip 的实际计算色并算 WCAG 对比度，杜绝同类「配色变量覆盖」回归。
    await step('⑩ 悬浮提示可读性：tooltip 文字/底色对比度 ≥ 4.5:1（白底白字回归）', async () => {
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid=chat-dock]', { timeout: 20_000 })

      const tool = page.locator('.tlui-button__tool').first()
      const box = await tool.boundingBox()
      assert(box, '底部工具条未渲染')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForSelector('.tlui-tooltip', { timeout: 8000 })

      const probe = await page.evaluate(() => {
        const el = document.querySelector('.tlui-tooltip')
        if (!el) return null
        const cs = getComputedStyle(el)
        // 逐级向上找第一个不透明的底色（tooltip 自身可能就是透明的）
        let bg = cs.backgroundColor
        let node = el
        while (node && /rgba?\([^)]*,\s*0\)/.test(bg)) {
          node = node.parentElement
          bg = node ? getComputedStyle(node).backgroundColor : bg
        }
        return { text: (el.textContent || '').trim(), color: cs.color, bg }
      })
      assert(probe, 'tooltip 元素未找到')
      assert(probe.text.length > 0, 'tooltip 文案为空（提示描述缺失）')

      const parse = (v) => {
        const m = v.match(/rgba?\(([^)]+)\)/)
        if (!m) return null
        const p = m[1].split(',').map((x) => Number(x.trim()))
        return { r: p[0], g: p[1], b: p[2] }
      }
      const lum = ({ r, g, b }) => {
        const f = (c) => {
          const s = c / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const fg = parse(probe.color)
      const bgc = parse(probe.bg)
      assert(fg && bgc, `无法解析 tooltip 配色（color=${probe.color} bg=${probe.bg}）`)
      const [l1, l2] = [lum(fg), lum(bgc)].sort((a, b) => b - a)
      const ratio = (l1 + 0.05) / (l2 + 0.05)
      assert(
        ratio >= 4.5,
        `tooltip 对比度不足（${ratio.toFixed(2)}:1，文字 ${probe.color} / 底色 ${probe.bg}）——「${probe.text}」看起来会是空框`
      )
    })

    // ---- ⑪ P1 运行历史（S3 数据层 + S4 UI） ----
    await step('⑪ 运行历史：刷新后仍在 + 面板可开合 + ≥3 条 + 字段完整 + 持久引用', async () => {
      // 显式再刷新一次：记录存 IndexedDB，必须跨刷新存活（TODO P1 验收标准）
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid=chat-dock]', { timeout: 20_000 })

      // 刷新后引擎内存态为空 → 重新点「出片」会真正新建任务。
      // 注意：⑨ 只等「首个产物出现」就继续了，故这里必须等**6 镜全部到终态**再断言记录数。
      await page.evaluate(() => {
        const node = [...document.querySelectorAll('.wls-node[data-kind="generate"]')].pop()
        const btn = [...(node?.querySelectorAll('button') ?? [])].find((b) => /出片|重新生成/.test(b.textContent || ''))
        btn?.click()
      })
      await page.waitForSelector('[data-testid=wls-generate-confirm-ok]', { timeout: 10_000 })
      await page.click('[data-testid=wls-generate-confirm-ok]')
      await page.waitForFunction(
        () => {
          const els = [...document.querySelectorAll('.wls-generate-artifact')]
          return els.length >= 6 && els.every((e) => !/排队中|生成中/.test(e.textContent || ''))
        },
        null,
        { timeout: 90_000 }
      )

      await page.click('[data-testid=open-run-history]')
      await page.waitForSelector('[data-testid=run-history]', { timeout: 10_000 })
      await page.waitForSelector('[data-testid=rh-row]', { timeout: 10_000 })

      const rows = page.locator('[data-testid=rh-row]')
      const count = await rows.count()
      assert(count >= 3, `运行历史记录不足（${count}，期望 ≥3：逐镜出片 6 镜应有 6 条）`)

      // 取一条**成功**记录做字段断言（不假设首条一定成功：⑨ 只等首个产物，中途导航可能留下
      // 未释放的跨页锁元数据，使个别镜次在下一轮以「跨页任务锁」失败——那是既有幂等实现的
      // 已知粗糙点，与本步要验证的「记录字段完整性」无关，故按状态定位而非按位置定位）。
      const okRows = page.locator('[data-testid=rh-row]', { hasText: '成功' })
      assert((await okRows.count()) > 0, '运行历史中没有成功记录')
      const okRow = okRows.first()
      const okText = (await okRow.innerText()) || ''
      assert(/耗时/.test(okText), `记录未显示耗时：${okText.slice(0, 80)}`)
      assert(/灵感币/.test(okText), `记录未显示费用：${okText.slice(0, 80)}`)
      assert(/演示 · 非真实生成/.test(okText), `演示引擎记录未标注「演示 · 非真实生成」：${okText.slice(0, 80)}`)

      // 展开详情：演示产物的 record.outputRef 是 blob:，必须回查到节点 meta 的 idbref:// 持久引用
      await okRow.locator('button').first().click()
      const detail = (await page.textContent('[data-testid=rh-detail]')) || ''
      assert(/idbref:\/\//.test(detail), `详情未显示持久 idbref 引用（blob: 回查节点 meta 失败）：${detail.slice(0, 200)}`)
      assert(!/产物引用已失效/.test(detail), `持久引用回查失败，退化成「已失效」：${detail.slice(0, 200)}`)

      await page.click('[data-testid=rh-close]')
      await page.waitForSelector('[data-testid=run-history]', { state: 'detached', timeout: 5000 })
    })

    await step('⑫ 运行历史：注入上游失败 → 记录数递增 + 失败原因可见 + 0 币不显示已退款 + 清空', async () => {
      // 刷新 → 引擎内存态清空（否则同 taskKey 会被幂等防重跳过，不会产生新记录）
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid=chat-dock]', { timeout: 20_000 })

      // 基线记录数（从 UI 读，顺带验证「面板可开合」）
      await page.click('[data-testid=open-run-history]')
      await page.waitForSelector('[data-testid=rh-row]', { timeout: 10_000 })
      const before = await page.locator('[data-testid=rh-row]').count()
      await page.click('[data-testid=rh-close]')
      await page.waitForSelector('[data-testid=run-history]', { state: 'detached', timeout: 5000 })

      // 一次性故障注入（仅测试钩子，见 mock.ts）：下一次 submit 返回「上游 4xx」，其余 5 镜照常成功
      await page.evaluate(() => {
        window.__WLS_MOCK_FAIL_ONCE__ = true
      })
      await page.evaluate(() => {
        const node = [...document.querySelectorAll('.wls-node[data-kind="generate"]')].pop()
        const btn = [...(node?.querySelectorAll('button') ?? [])].find((b) => /出片|重新生成/.test(b.textContent || ''))
        btn?.click()
      })
      await page.waitForSelector('[data-testid=wls-generate-confirm-ok]', { timeout: 10_000 })
      await page.click('[data-testid=wls-generate-confirm-ok]')
      await page.waitForFunction(
        () => {
          const els = [...document.querySelectorAll('.wls-generate-artifact')]
          return els.length >= 6 && els.every((e) => !/排队中|生成中/.test(e.textContent || ''))
        },
        null,
        { timeout: 90_000 }
      )

      // 记录数递增 + 失败原因可见
      await page.click('[data-testid=open-run-history]')
      await page.waitForSelector('[data-testid=rh-row]', { timeout: 10_000 })
      const after = await page.locator('[data-testid=rh-row]').count()
      assert(after > before, `记录数未递增（${before} → ${after}）`)

      // 在失败记录里定位「注入的那条」（不假设它一定是最新一条），并采集全部失败原因便于诊断
      const failRows = page.locator('[data-testid=rh-row]', { hasText: '失败' })
      const failCount = await failRows.count()
      assert(failCount > 0, '注入失败后运行历史中没有失败记录')
      const collected = []
      let injectedText = ''
      let injectedDetail = ''
      for (let i = 0; i < Math.min(failCount, 6); i++) {
        const row = failRows.nth(i)
        const text = (await row.innerText()) || ''
        await row.locator('button').first().click()
        const d = (await page.textContent('[data-testid=rh-detail]')) || ''
        collected.push(`${text.slice(0, 24)} → ${d.replace(/\s+/g, ' ').slice(0, 140)}`)
        if (/模拟上游 4xx/.test(d)) {
          injectedText = text
          injectedDetail = d
          break
        }
      }
      assert(
        injectedText.length > 0,
        `未在任何失败记录中看到注入的失败原因（采集 ${collected.length} 条：${collected.join(' || ')}）`
      )
      assert(/0 灵感币/.test(injectedText), `演示引擎 0 币失败的费用应显示「0 灵感币」：${injectedText.slice(0, 80)}`)
      assert(!/已退款/.test(injectedText), `0 币无可退，不应显示「已退款」：${injectedText.slice(0, 80)}`)
      assert(/无款项可退/.test(injectedDetail), `0 币失败应显示「无款项可退」：${injectedDetail.slice(0, 200)}`)

      // 清空
      await page.click('[data-testid=rh-clear]')
      await page.waitForSelector('[data-testid=rh-empty]', { timeout: 10_000 })
      assert((await page.locator('[data-testid=rh-row]').count()) === 0, '清空后仍存在记录')
      await page.click('[data-testid=rh-close]')
      await page.waitForSelector('[data-testid=run-history]', { state: 'detached', timeout: 5000 })
    })

    await step('⑬ 全程无未捕获页面异常（真实鼠标路径零 pageerror）', async () => {
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
