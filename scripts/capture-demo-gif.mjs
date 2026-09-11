#!/usr/bin/env node
/**
 * 演示 GIF 帧采集（README 顶部 30 秒演示）。
 *
 * 为什么单独一个脚本：README 的演示必须是**真实操作录屏**，不是设计稿或手绘 mock
 * （与 `capture-screenshots.mjs` 同一口径）。本脚本用 Playwright 驱动生产构建 dist，
 * 按真实节奏走一遍「开场层 → 一句话编排 → 脚本 → 分镜预演 → 逐镜出片 → 3D 运镜台 →
 * 剪映草稿打包」主线，全程**连续抓帧并记录时间戳**，产出到 `.tmp-gif/`：
 *   - `f-0000.png …`：帧序列
 *   - `frames.json`：每帧的真实时间戳（毫秒）
 *
 * 为什么记时间戳而不是固定帧率：截图本身耗时（每帧约 80–150ms），若按固定帧率写进 GIF
 * 会与实际耗时脱节（动作被加速）。记录真实时间戳后，由组装脚本按**真实间隔**写每帧延时，
 * 播放节奏就与真人操作一致。
 *
 * 组装成 GIF（需要 Python + Pillow，仓库已有 `docs/build_how_to_use_pdf.py` 的同类先例）：
 *   npm run demo:frames && python docs/build_demo_gif.py
 *
 * `--prod`：用 **https + 非回环域名**（自签证书 + 域名解析到 127.0.0.1）录制，
 * 也就是与线上 GitHub Pages 一致的形态。为什么需要它：
 *   tldraw 在**开发环境**（http 协议，或 https + 回环地址）会显示
 *   「Get a license for production」开发水印，而线上（https + 公网域名 + 已配置 key）
 *   没有水印。若用默认的 127.0.0.1 形态录，README 里会出现**访客看不到的水印**。
 * 该模式需要 dist 里已烘焙 license key（构建时注入 `VITE_TLDRAW_LICENSE_KEY`），
 * 且**不启动伴生服务**——与真实线上一致（纯静态托管，无 /healthz 与 /api/*）。
 *
 * 用法：
 *   npm run demo:frames                 # 本机 http 形态（有水印，仅调试用）
 *   npm run demo:frames -- --skip-build
 *   npm run demo:frames -- --prod       # 线上形态（https + 非回环域名，无水印）← README 用这个
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
const PROD = argv.includes('--prod')
/** 16:9；采集用大图，组装时再降采样（比直接小图采集清晰） */
const VIEWPORT = { width: 1440, height: 810 }
const FRAME_DIR = join(ROOT, '.tmp-gif')
/** 生产形态用的非回环域名（与 prodmode-check 同口径） */
const DEMO_HOST = 'wls.demo.test'

async function main() {
  console.log('=== 演示 GIF 帧采集 ===')
  const playwright = loadPlaywright()
  if (!playwright) skipEnv('演示 GIF 帧采集', '未找到 playwright 包')

  ensureDist({ skipBuild: SKIP_BUILD })
  rmSync(FRAME_DIR, { recursive: true, force: true })
  mkdirSync(FRAME_DIR, { recursive: true })

  let server = null
  let staticServer = null
  let browser = null
  let base = ''

  try {
    if (PROD) {
      const openssl = findOpenssl()
      if (!openssl) skipEnv('演示录屏（生产形态）', '未找到 openssl（生成自签证书需要；Git for Windows 自带）')
      const port = randomPort(38_000)
      const tls = makeCert(openssl, { host: DEMO_HOST, tmpDir: join(ROOT, '.tmp-demo-tls') })
      staticServer = await startStaticServer({ tls, port, distDir: join(ROOT, 'dist') })
      base = `https://${DEMO_HOST}:${port}/`
      console.log(`  · 生产形态（https + 非回环域名 · 无 tldraw 开发水印）：${base}`)
    } else {
      const port = randomPort(37_000)
      base = `http://127.0.0.1:${port}/`
      server = startCompanionServer(port, { storage: 'memory', tmpDir: '.tmp-gif-srv' })
      if (!(await waitHealthy(base))) throw new Error(`伴生服务未就绪（${base}）`)
      console.log(`  · 本机开发形态（http + 回环 · 会带 tldraw 开发水印）：${base}`)
    }

    browser = await playwright.chromium.launch({
      headless: true,
      args: PROD ? [`--host-resolver-rules=MAP ${DEMO_HOST} 127.0.0.1`, '--ignore-certificate-errors'] : [],
    })
    // reducedMotion 必须是 no-preference：分镜预演是 GSAP 动画，关掉就没有动感了
    const context = await browser.newContext({
      viewport: VIEWPORT,
      serviceWorkers: 'block',
      reducedMotion: 'no-preference',
      acceptDownloads: true,
      ...(PROD ? { ignoreHTTPSErrors: true } : {}),
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)

    const frames = []
    let index = 0
    const captureOnce = async () => {
      const file = `f-${String(index++).padStart(4, '0')}.png`
      await page.screenshot({ path: join(FRAME_DIR, file) })
      frames.push({ file, t: Date.now() })
    }
    /** 在 ms 毫秒内**持续抓帧**（抓帧耗时自然决定帧率），节奏由真实时间戳还原 */
    const hold = async (ms) => {
      const end = Date.now() + ms
      do {
        await captureOnce()
      } while (Date.now() < end)
    }

    const t0 = Date.now()
    const el = (s) => page.locator(s).first()
    const clickNodeBtn = async (kind, label) => {
      const ok = await page.evaluate(
        ({ k, lp }) => {
          const node = [...document.querySelectorAll(`.wls-node[data-kind="${k}"]`)].pop()
          const b = node && [...node.querySelectorAll('button')].find((x) => (x.textContent || '').includes(lp))
          if (!b || b.disabled) return false
          b.click()
          return true
        },
        { k: kind, lp: label }
      )
      if (!ok) throw new Error(`${kind} 节点的「${label}」按钮不可用`)
    }

    // ---------- ① 开场层（3.0s）----------
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 25_000 })
    await hold(2600)

    // ---------- ② 进入画布（1.4s）----------
    await page.click('[data-testid=co-enter]')
    await page.waitForSelector('[data-testid=chat-dock]', { timeout: 10_000 })
    await hold(1400)

    // ---------- ③ 对话栏一句话（逐字输入，2.6s）----------
    const sentence = '给一款保温杯拍一条 30 秒竖屏带货短视频'
    await el('.wls-chat-input').click()
    for (let i = 0; i < sentence.length; i += 2) {
      await page.keyboard.type(sentence.slice(i, i + 2), { delay: 0 })
      await captureOnce()
    }
    await hold(500)

    // ---------- ④ 发送 → 演示编排落位（4.2s）----------
    await page.click('.wls-chat-send')
    await page.waitForFunction(
      () => /演示编排|LLM 编排/.test(document.querySelector('[data-testid=orchestration-notice]')?.textContent || ''),
      null,
      { timeout: 25_000 }
    )
    // 注意必须带花括号：`() => editor.zoomToFit()` 会把 editor 对象当返回值交给 Playwright，
    // 触发 "object reference chain is too long"（首版即踩此坑）
    await page.evaluate(() => {
      window.__wlsEditor?.zoomToFit()
    })
    await hold(3200)

    // ---------- ⑤ 生成脚本（ScriptWriter + Critic，3.4s）----------
    await clickNodeBtn('script', '生成脚本')
    await page.waitForFunction(
      () => {
        const n = [...document.querySelectorAll('.wls-node[data-kind="script"]')].pop()
        return /演示 · 评分非真实/.test(n?.innerText || '')
      },
      null,
      { timeout: 25_000 }
    )
    await hold(2400)

    // ---------- ⑥ 生成分镜 → 9:16 GSAP 预演（4.6s）----------
    await clickNodeBtn('storyboard', '生成分镜')
    await page.waitForFunction(
      () => {
        const n = [...document.querySelectorAll('.wls-node[data-kind="storyboard"]')].pop()
        return /镜 \d+\/\d+/.test(n?.innerText || '')
      },
      null,
      { timeout: 25_000 }
    )
    await hold(5200)

    // ---------- ⑦ 逐镜出片 → 产物卡（4.4s）----------
    await clickNodeBtn('generate', '开始逐镜出片')
    await page.waitForSelector('[data-testid=wls-generate-confirm-ok]', { timeout: 10_000 })
    await hold(900)
    await page.click('[data-testid=wls-generate-confirm-ok]')
    await page.waitForFunction(() => document.querySelectorAll('.wls-node[data-kind="asset"]').length > 0, null, {
      timeout: 45_000,
    })
    await hold(2600)

    // ---------- ⑧ 3D 运镜台（差异点，给足时间 6.2s）----------
    await page.locator('.wls-palette-item', { hasText: '3D 运镜台' }).first().click()
    await hold(600)
    await page.evaluate(() => {
      window.__wlsEditor?.zoomToFit()
    })
    await hold(600)
    await page.locator('[data-testid=stage3d-enter]').last().click()
    await page.waitForSelector('[data-testid=stage3d-studio]', { timeout: 15_000 })
    await hold(800)
    await page.click('[data-testid=s3-add-character]')
    await hold(900)
    await page.click('[data-testid=s3-add-camera]')
    await hold(700)
    await page.click('[data-testid=s3-scene-studio]')
    await hold(3000)

    // ---------- ⑨ 剪映草稿打包（差异点，2.6s）----------
    await page.click('[data-testid=s3-back]')
    await page.waitForSelector('[data-testid=stage3d-studio]', { state: 'detached', timeout: 10_000 })
    await page.evaluate(() => {
      window.__wlsEditor?.zoomToFit()
    })
    await hold(500)
    const download = page.waitForEvent('download', { timeout: 25_000 })
    await clickNodeBtn('deliver', '打包剪映草稿')
    await download
    await hold(3000)

    writeFileSync(join(FRAME_DIR, 'frames.json'), JSON.stringify({ frames, startedAt: t0 }, null, 0), 'utf8')
    const seconds = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`  ✔ 采集 ${frames.length} 帧 / ${seconds}s → .tmp-gif/`)
    console.log('  下一步：python docs/build_demo_gif.py')
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (server) server.child.kill()
    if (staticServer) staticServer.close()
    try {
      rmSync(join(ROOT, '.tmp-gif-srv'), { recursive: true, force: true })
    } catch {
      /* 清理失败不影响结论 */
    }
  }
}

main().catch((err) => {
  console.error('\n演示帧采集异常终止：', err instanceof Error ? err.message : err)
  process.exit(1)
})
