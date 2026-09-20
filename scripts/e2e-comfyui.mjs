#!/usr/bin/env node
/**
 * ComfyUI 本地算力出片 E2E（真实本机 GPU，**不进 CI**）
 *
 * 目标：证明「画布 → 本地 ComfyUI 出片 → 产物卡」在真实算力下闭环，而不是只跑演示引擎。
 *
 *   ① 引擎标签必须显示「🔥 ComfyUI 本地算力」（设置里的引擎选择真实生效）
 *   ② 产物 url 必须是 ComfyUI /view 的 http 直链（不是 blob/idbref 演示产物）
 *   ③ 产物 url 的缓存破坏参数必须是 & 拼接（修复前 `?v=` 会污染 type= 参数导致 404）
 *   ④ 产物卡里的 <video> 真的能解码（videoWidth > 0，不是死链）
 *   ⑤ 负向：切回 mock 再出片 → 产物必须变回非 http 引用（证明引擎切换在真实路由，
 *      而不是「选了 ComfyUI 其实还跑演示引擎」）
 *
 * 环境不满足时**如实跳过**（exit 0，不伪装通过）：
 *   - Playwright 未安装 / Chromium 缺失                → skipEnv
 *   - ComfyUI 未启动（GET /system_stats 不可达）        → 打印启动命令后 exit 0
 *   - Wan 2.2 TI2V-5B 三件权重不在 /object_info 枚举里   → 打印缺什么后 exit 0
 *
 * 用法：
 *   npm run e2e:comfyui                    # 构建 + 起伴生服务 + 真实出片
 *   npm run e2e:comfyui -- --skip-build    # 复用现有 dist
 *   npm run e2e:comfyui -- --headed        # 有头模式（排障）
 *   WLS_COMFY_URL=http://127.0.0.1:8188 WLS_COMFY_TIER=fast npm run e2e:comfyui
 */
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
const VIEWPORT = { width: 1600, height: 900 }

const COMFY_BASE = (process.env.WLS_COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '')
/** 默认快速档：真实 GPU 出片要等，档位越高等越久（快档单镜约 1 分钟） */
const TIER = process.env.WLS_COMFY_TIER || 'fast'
const PRESET = 'wan2.2-ti2v-5b'
/** 单镜真实出片预算（快档实测 ~1 分钟，给足 10 倍余量；超时按失败报，不静默放过） */
const GENERATE_TIMEOUT = Number(process.env.WLS_COMFY_TIMEOUT_MS || 10 * 60 * 1000)

const skip = (reason) => skipEnv('ComfyUI 画布出片 E2E', reason)

let failures = 0
async function step(name, fn) {
  const t0 = Date.now()
  try {
    await fn()
    console.log(`  ✔ ${name}（${Date.now() - t0}ms）`)
  } catch (err) {
    failures++
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`  ❌ ${name} —— ${msg}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function comfyGet(path, timeoutMs = 5000) {
  const res = await fetch(`${COMFY_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return res.json()
}

/** 出片前置自检：ComfyUI 在线 + 权重枚举里有 Wan 2.2 三件套（缺一即如实跳过） */
async function preflight() {
  let stats
  try {
    stats = await comfyGet('/system_stats')
  } catch (err) {
    skip(
      `ComfyUI 不可达（${COMFY_BASE}/system_stats：${err instanceof Error ? err.message : err}）\n` +
        '  启动方式（Windows 便携包）：\n' +
        "    Start-Process -FilePath 'D:\\ComfyUI\\ComfyUI_windows_portable\\python_embeded\\python.exe' `\n" +
        "      -ArgumentList @('-s','ComfyUI\\main.py','--windows-standalone-build','--listen','127.0.0.1','--port','8188') `\n" +
        "      -WorkingDirectory 'D:\\ComfyUI\\ComfyUI_windows_portable' -WindowStyle Hidden"
    )
  }
  const dev = stats.devices?.[0]
  console.log(
    `· ComfyUI ${stats.system?.comfyui_version} 在线 · ${dev?.name || '未知 GPU'} · 空闲显存 ${
      dev?.vram_free ? (dev.vram_free / 1024 ** 3).toFixed(1) : '?'
    } GB`
  )

  const need = [
    ['UNETLoader', 'unet_name', 'wan2.2_ti2v_5B_fp16.safetensors'],
    ['CLIPLoader', 'clip_name', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
    ['VAELoader', 'vae_name', 'wan2.2_vae.safetensors'],
  ]
  const missing = []
  for (const [node, input, value] of need) {
    try {
      const info = await comfyGet(`/object_info/${node}`)
      const opts = info?.[node]?.input?.required?.[input]?.[0]
      if (!Array.isArray(opts) || !opts.includes(value)) missing.push(`${node}.${input} 缺 ${value}`)
    } catch (err) {
      missing.push(`${node} 节点不可用（${err instanceof Error ? err.message : err}）`)
    }
  }
  if (missing.length > 0) {
    skip(`Wan 2.2 TI2V-5B 依赖不齐：\n  - ${missing.join('\n  - ')}`)
  }
  console.log('· Wan 2.2 TI2V-5B 三件权重就位')
}

async function main() {
  console.log('=== ComfyUI 本地算力出片 E2E ===')
  console.log(`· ComfyUI：${COMFY_BASE} · 预设 ${PRESET} · 质量档 ${TIER}`)

  const playwright = loadPlaywright()
  if (!playwright) skip('未找到 playwright 包（项目 / 全局 / npx 缓存均无）')
  const { chromium } = playwright

  // 先做外部依赖自检（比构建便宜），不满足就如实跳过
  await preflight()

  ensureDist({ skipBuild: SKIP_BUILD })

  const port = randomPort(25_000)
  const base = `http://127.0.0.1:${port}`
  const server = startCompanionServer(port)
  let browser = null

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
        skip(`Chromium 可执行文件缺失（${msg.split('\n')[0]}）`)
      }
      throw err
    }

    const context = await browser.newContext({
      viewport: VIEWPORT,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    })
    // 应用启动前写好设置：引擎 = comfyui、快档（等价于用户在「⚙️ API 设置」里选好）。
    // **故意不写 comfyui_url**：留空 = 走同源反代 /api/comfyui，这才是本机唯一可行的连法
    // （ComfyUI 新版对回环 Host/Origin 做一致性校验，直连 127.0.0.1:8188 必 403）。
    await context.addInitScript(
      ([preset, tier]) => {
        try {
          sessionStorage.removeItem('weblockshot.comfyui_url')
          sessionStorage.setItem('weblockshot.comfyui_preset', preset)
          sessionStorage.setItem('weblockshot.comfyui_quality', tier)
          sessionStorage.setItem('weblockshot.video_provider', 'comfyui')
          sessionStorage.setItem('weblockshot.canvas.onboarding_seen', '1')
        } catch {
          /* 隐私模式下失败由后续断言暴露 */
        }
      },
      [PRESET, TIER]
    )

    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(e.message))

    /** 读出 generate 节点的 meta（providerId / artifacts） */
    const generateMeta = () =>
      page.evaluate(() => {
        const s = window.__wlsEditor
          ?.getCurrentPageShapes()
          .find((x) => x.type === 'wls-node' && x.props?.kind === 'generate')
        return s?.props?.meta ?? null
      })
    const assetMetas = () =>
      page.evaluate(() =>
        window.__wlsEditor
          .getCurrentPageShapes()
          .filter((x) => x.type === 'wls-node' && x.props?.kind === 'asset')
          .map((x) => x.props?.meta ?? null)
      )
    const generateBtnText = () =>
      page.evaluate(() => {
        const el = document.querySelector('.wls-node[data-kind="generate"]')
        return el ? (el.innerText || '').replace(/\s+/g, ' ') : ''
      })

    await step('① 进入画布（预置 ComfyUI 引擎）', async () => {
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-testid=canvas-workbench]', { timeout: 25_000 })
      const enter = page.locator('[data-testid=co-enter]')
      if (await enter.count()) {
        await enter.first().click().catch(() => {})
      }
      await page.waitForFunction(() => Boolean(window.__wlsEditor), null, { timeout: 20_000 })
    })

    await step('② 搭图：product(填标题) + generate + 连线 product→generate', async () => {
      await page.locator('.wls-palette-item', { hasText: '素材导入' }).first().click()
      await page.waitForSelector('.wls-product-title', { timeout: 10_000 })
      // 真实输入路径：onChange → persist → meta{title, upstreamText, imports}
      await page.fill('.wls-product-title', '一只白色陶瓷马克杯，晨光下的桌面特写')
      await page.waitForTimeout(300)

      await page.locator('.wls-palette-item', { hasText: '视频生成' }).first().click()
      await page.waitForSelector('.wls-node[data-kind="generate"]', { timeout: 10_000 })

      // 真实鼠标画箭头在本环境对自定义 shape 不可靠（起笔/收笔被节点体吞掉），
      // 沿用既有 E2E 口径：走 editor API 物化箭头 + 绑定（与 CanvasWorkbench 编排同一条路径）
      const linked = await page.evaluate(() => {
        const ed = window.__wlsEditor
        const shapes = ed.getCurrentPageShapes().filter((s) => s.type === 'wls-node')
        const from = shapes.find((s) => s.props?.kind === 'product')
        const to = shapes.find((s) => s.props?.kind === 'generate')
        if (!from || !to) return 'missing-node'
        const arrowId = 'shape:e2e-comfy-arrow'
        ed.run(() => {
          ed.createShape({
            id: arrowId,
            type: 'arrow',
            x: from.x,
            y: from.y,
            props: { start: { x: 0, y: 0 }, end: { x: to.x - from.x, y: to.y - from.y } },
          })
          ed.createBindings([
            { fromId: arrowId, toId: from.id, type: 'arrow', props: { terminal: 'start' } },
            { fromId: arrowId, toId: to.id, type: 'arrow', props: { terminal: 'end' } },
          ])
        })
        return 'linked'
      })
      assert(linked === 'linked', `连线失败：${linked}`)
      await page.waitForFunction(
        () => {
          const el = document.querySelector('.wls-node[data-kind="generate"]')
          return /上游素材就绪/.test(el?.innerText || '')
        },
        null,
        { timeout: 10_000 }
      )
    })

    await step('③ 引擎标签显示「ComfyUI 本地算力」（设置真实生效）', async () => {
      const text = await generateBtnText()
      assert(/ComfyUI 本地算力/.test(text), `generate 节点未显示 ComfyUI 引擎：${text.slice(0, 200)}`)
      // 未接通的引擎必须被如实列出，不能假装可用
      assert(/可灵|jimeng|kling/.test(text), `未列出未接通引擎：${text.slice(0, 200)}`)
    })

    await step('④ 出片前确认弹层如实标注预计耗时，确认后真实出片', async () => {
      const opened = await page.evaluate(() => {
        const el = document.querySelector('.wls-node[data-kind="generate"]')
        const b = [...el.querySelectorAll('button')].find((x) => /出片|重新直出/.test(x.textContent || ''))
        if (!b) return 'no-button'
        if (b.disabled) return 'disabled'
        b.click()
        return 'clicked'
      })
      assert(opened === 'clicked', `出片按钮不可用：${opened}`)
      await page.waitForSelector('[data-testid=wls-generate-confirm]', { timeout: 10_000 })
      const detail = (await page.locator('[data-testid=wls-generate-confirm]').innerText()) || ''
      assert(/预计约/.test(detail), `确认弹层未如实告知出片耗时：${detail}`)
      assert(/ComfyUI 本地算力/.test(detail), `确认弹层未显示引擎名：${detail}`)
      await page.click('[data-testid=wls-generate-confirm-ok]')

      const t0 = Date.now()
      await page.waitForFunction(
        () => {
          const s = window.__wlsEditor
            ?.getCurrentPageShapes()
            .find((x) => x.type === 'wls-node' && x.props?.kind === 'generate')
          const arts = s?.props?.meta?.artifacts
          return Array.isArray(arts) && arts.some((a) => a.status === 'succeeded')
        },
        null,
        { timeout: GENERATE_TIMEOUT }
      )
      console.log(`     · 真实出片完成，耗时 ${Math.round((Date.now() - t0) / 1000)}s`)
    })

    await step('⑤ 产物是同源反代直链（绝对 http）且缓存参数拼接正确', async () => {
      const meta = await generateMeta()
      assert(meta?.providerId === 'comfyui', `meta.providerId 应为 comfyui，实际 ${meta?.providerId}`)
      const art = (meta?.artifacts ?? []).find((a) => a.status === 'succeeded')
      assert(art?.url, '未找到 succeeded 产物')
      // 必须是**绝对** http 直链，否则 persistentUrlSchema 会拒绝入档（相对路径 /api/... 不合法）
      assert(/^https?:\/\//.test(art.url), `产物不是绝对 http 直链：${art.url}`)
      assert(new URL(art.url).pathname.startsWith('/api/comfyui/view'), `产物未走同源反代：${art.url}`)
      assert(new URL(art.url).origin === base, `产物未指向本页同源（跨域会被 ComfyUI 403）：${art.url}`)
      assert(art.url.includes('filename='), `产物直链缺 filename：${art.url}`)
      // 负向：修复前拼 `?v=` 会得到 `...type=output?v=123`，ComfyUI 会 404
      assert(!/type=output\?v=/.test(art.url), `缓存参数污染了 type 查询参数（会 404）：${art.url}`)
      assert(/[&?]v=\d+/.test(art.url), `产物直链缺缓存破坏参数：${art.url}`)
    })

    await step('⑥ 产物卡可播放（<video> 真实解码，不是死链）', async () => {
      await page.waitForSelector('.wls-node[data-kind="asset"]', { timeout: 15_000 })
      const metas = await assetMetas()
      assert(metas.length > 0, '未创建产物卡')
      const url = metas[0]?.url || ''
      assert(new URL(url).pathname.startsWith('/api/comfyui/view'), `产物卡 url 未走同源反代：${url}`)

      const decoded = await page.evaluate(async (u) => {
        const v = document.createElement('video')
        v.muted = true
        v.preload = 'metadata'
        v.src = u
        return await new Promise((resolve) => {
          const done = (r) => resolve(r)
          v.onloadedmetadata = () => done({ ok: true, w: v.videoWidth, h: v.videoHeight, d: v.duration })
          v.onerror = () => done({ ok: false, w: 0, h: 0, d: 0 })
          setTimeout(() => done({ ok: false, w: 0, h: 0, d: 0, timeout: true }), 15_000)
        })
      }, url)
      assert(decoded.ok, `产物视频无法解码（死链或非法容器）：${JSON.stringify(decoded)}`)
      assert(decoded.w > 0 && decoded.h > 0, `产物视频尺寸异常：${JSON.stringify(decoded)}`)
      console.log(`     · 产物可解码 ${decoded.w}×${decoded.h} · ${decoded.d?.toFixed?.(2) ?? decoded.d}s`)
    })

    await step('⑦ 负向验收：切回 mock 重新出片 → 产物必须变回非 http 引用', async () => {
      const before = (await generateMeta())?.artifacts?.find((a) => a.status === 'succeeded')?.url || ''
      assert(before.includes('/api/comfyui/view'), '前置产物不是 ComfyUI 直链，负向用例无意义')

      // 与设置面板「保存」走**同一条**链路：写 sessionStorage + 派发应用内部广播信号
      // （sessionStorage 同标签页写入不会触发 storage 事件，所以必须显式广播，
      //   见 src/canvas/generateProvider.ts 的 CANVAS_PROVIDER_CHANGED_EVENT）
      await page.evaluate(() => {
        sessionStorage.setItem('weblockshot.video_provider', 'mock')
        window.dispatchEvent(new Event('weblockshot:canvas-provider-changed'))
      })
      await page.waitForFunction(
        () => {
          const el = document.querySelector('.wls-node[data-kind="generate"]')
          return /Mock 实验画布/.test(el?.innerText || '')
        },
        null,
        { timeout: 10_000 }
      )

      const opened = await page.evaluate(() => {
        const el = document.querySelector('.wls-node[data-kind="generate"]')
        const b = [...el.querySelectorAll('button')].find((x) => /直出|重新直出/.test(x.textContent || ''))
        if (!b) return 'no-button'
        if (b.disabled) return 'disabled'
        b.click()
        return 'clicked'
      })
      assert(opened === 'clicked', `切回 mock 后出片按钮不可用：${opened}`)
      await page.waitForSelector('[data-testid=wls-generate-confirm-ok]', { timeout: 10_000 })
      await page.click('[data-testid=wls-generate-confirm-ok]')

      await page.waitForFunction(
        () => {
          const s = window.__wlsEditor
            ?.getCurrentPageShapes()
            .find((x) => x.type === 'wls-node' && x.props?.kind === 'generate')
          return s?.props?.meta?.providerId === 'mock' && (s?.props?.meta?.artifacts ?? []).some((a) => a.status === 'succeeded')
        },
        null,
        { timeout: 60_000 }
      )
      const after = (await generateMeta())?.artifacts?.find((a) => a.status === 'succeeded')?.url || ''
      assert(
        !after.includes('/api/comfyui/view'),
        `切回 mock 后产物仍是 ComfyUI 直链（引擎选择没生效）：${after}`
      )
    })

    await step('⑧ 无未捕获页面错误（真实网络路径不引入崩溃）', async () => {
      // ComfyUI 直链是跨端口资源，媒体加载失败不算 JS 错误；这里只看未捕获异常
      assert(pageErrors.length === 0, `存在未捕获页面错误：${pageErrors.join(' | ')}`)
    })
  } finally {
    await browser?.close().catch(() => {})
    server.child.kill()
  }

  console.log(failures === 0 ? '\n=== ComfyUI 出片 E2E 全部通过 ===' : `\n=== ComfyUI 出片 E2E 失败 ${failures} 项 ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('E2E 运行异常：', err)
  process.exit(1)
})
