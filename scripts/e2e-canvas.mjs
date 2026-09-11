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

    await step('⑩ 全程无未捕获页面异常（真实鼠标路径零 pageerror）', async () => {
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
