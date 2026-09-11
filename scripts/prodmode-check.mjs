#!/usr/bin/env node
/**
 * 生产模式回归（tldraw 许可闸门 + 本项目诚实提示）
 *
 * 为什么需要它（2026-09-11 用户实机反馈「点击功能时画布内容忽然全部消失」）：
 *   tldraw@5.4.0 的许可闸门判定 `getIsDevelopment()` =
 *     `hostname.endsWith('.localhost') ? false : (protocol === 'http:' || (protocol === 'https:' && 回环主机))`
 *   即 **http 一律豁免；https 只有 localhost / 127.x / ::1 豁免**。
 *   所以本地（http://127.0.0.1）与既有全部实机套件永远看不到该现象，
 *   而线上 GitHub Pages（https + 公网域名）必然命中：
 *   无 license key → 状态 `unlicensed-production` → **5 秒后 <Tldraw> 被替换成空 div**，
 *   画布与 tldraw 自带 UI 全部消失（外层自有 UI 仍在，故「页面没崩但画布空了」）。
 *
 * 本套件用 **HTTPS + 非回环主机名** 复现线上形态，双向断言：
 *   A) 生产模式：闸门确实触发 + 本项目如实提示出现 + 页面不崩 + 画布数据不丢；
 *   B) 开发模式（http://127.0.0.1）：闸门不触发 + 提示不出现（证明提示不是误报）。
 *
 * 诚实边界：本套件**不绕过、不去水印**，只验证「如实告知」这条防线；
 * 需要 openssl 生成自签证书，缺失时如实跳过（exit 0）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, ensureDist, loadPlaywright, randomPort, skipEnv } from './lib/browser-env.mjs'
import { findOpenssl, makeCert, startStaticServer } from './lib/tls-static-server.mjs'

const argv = process.argv.slice(2)
const FLAG = (name) => argv.includes(`--${name}`)
const SKIP_BUILD = FLAG('skip-build')
const HEADED = FLAG('headed')

/** 生产形态主机名（非回环、非 *.localhost，从而命中 tldraw 的生产判定） */
const PROD_HOST = 'wls.prod.test'
const TMP_DIR = join(ROOT, '.tmp-prodmode')

/**
 * 构建产物里已烘焙的 tldraw license key 的**到期日**（形如 `tldraw-YYYY-MM-DD/<载荷>.<签名>`）。
 * 用它决定本套件的**预期分支**：
 *   - 未烘焙 → 生产环境应触发闸门（验证「如实提示」这条防线）；
 *   - 已烘焙 → 生产环境**不应**触发闸门（顺带验证 key 有效，可作为「key 过期/无效」的监控）。
 *
 * 为什么要连到期日一起取出来：tldraw 官方文档明确「评估（试用）许可**没有宽限期**，
 * 到期立即失效」，而失效 = 生产环境 5 秒后停止渲染 = **所有访客的画布一起消失**。
 * 所以到期日必须能被 CI 提前看见（见下方 30 天告警）。
 *
 * 注意：只做字符串探测，不读取也不打印 key 的载荷与签名。
 */
function detectBakedLicenseKey(distDir) {
  let files = []
  try {
    files = readdirSync(join(distDir, 'assets')).filter((f) => f.endsWith('.js'))
  } catch {
    return null
  }
  for (const f of files) {
    const m = /tldraw-(\d{4}-\d{2}-\d{2})\//.exec(readFileSync(join(distDir, 'assets', f), 'utf8'))
    if (m) return m[1]
  }
  return null
}

// ---------------- 断言工具 ----------------

let failures = 0
let warnings = 0
function check(ok, label, extra = '') {
  if (ok) console.log(`  ✔ ${label}${extra ? `（${extra}）` : ''}`)
  else {
    failures++
    console.error(`  ❌ ${label}${extra ? ` —— ${extra}` : ''}`)
  }
}

/**
 * 只告警不失败（不阻断部署）。
 * 用途：license key 过期/失效属「授权运维事件」，不该卡住部署——按用户要求降级为告警，
 * 但仍要如实打印，且继续校验「诚实提示」兜底是否生效。
 */
function warn(label, extra = '') {
  warnings++
  console.warn(`  ⚠ ${label}${extra ? `（${extra}）` : ''}`)
}

/** 读取当前页面的画布持久化快照（用于验证「画布数据不丢」） */
const canvasStorage = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.entries(localStorage).filter(([k]) => /weblockshot|canvas/i.test(k))
    )
  )

// ---------------- 主流程 ----------------

async function main() {
  console.log('=== 生产模式回归（tldraw 许可闸门 + 诚实提示）===')

  const playwright = loadPlaywright()
  if (!playwright) skipEnv('生产模式回归', '未找到 playwright 包')
  const { chromium } = playwright

  const openssl = findOpenssl()
  if (!openssl) skipEnv('生产模式回归', '未找到 openssl（生成自签证书需要；Git for Windows 自带）')

  ensureDist({ skipBuild: SKIP_BUILD })
  const distDir = join(ROOT, 'dist')
  const licenseExpiry = detectBakedLicenseKey(distDir)
  const licensed = Boolean(licenseExpiry)
  console.log(
    licensed
      ? `· 构建产物已烘焙 tldraw license key（到期日 ${licenseExpiry}）→ 预期：生产环境**不**触发闸门（并验证 key 有效）`
      : '· 未烘焙 tldraw license key → 预期：生产环境触发闸门 + 展示诚实提示'
  )
  // 到期提醒：试用许可无宽限期，到期当天生产环境会立刻停止渲染（所有访客画布一起消失）。
  // 按既有口径只告警、不阻断部署（授权续期属运维事件）。
  if (licensed) {
    const daysLeft = Math.ceil((Date.parse(`${licenseExpiry}T23:59:59Z`) - Date.now()) / 86_400_000)
    console.log(`· license key 剩余有效天数：${daysLeft} 天`)
    if (daysLeft <= 0) {
      warn('tldraw license key 已过期 —— 生产环境画布将停止渲染，请立即续期')
    } else if (daysLeft <= 30) {
      warn(`tldraw license key 将在 ${daysLeft} 天后过期（试用许可无宽限期）—— 请提前续期，否则线上画布会对所有访客消失`)
    }
  }
  const tls = makeCert(openssl, { host: PROD_HOST, tmpDir: TMP_DIR })

  const prodPort = randomPort(27_000)
  const devPort = randomPort(29_000)
  const prodServer = await startStaticServer({ tls, port: prodPort, distDir })
  const devServer = await startStaticServer({ tls: null, port: devPort, distDir })
  console.log(`· 生产形态：https://${PROD_HOST}:${prodPort}/（自签证书，忽略校验）`)
  console.log(`· 对照形态：http://127.0.0.1:${devPort}/`)

  let browser = null
  try {
    browser = await chromium.launch({
      headless: !HEADED,
      args: [`--host-resolver-rules=MAP ${PROD_HOST} 127.0.0.1`, '--ignore-certificate-errors'],
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (/Executable doesn't exist|please run the following command/i.test(msg)) {
        skipEnv('生产模式回归', `Chromium 可执行文件缺失（${msg.split('\n')[0]}）`)
      }
      throw err
    })

    // ---------- A) 生产模式（https + 非回环域名） ----------
    console.log('\n--- A) 生产形态：https://' + PROD_HOST + ' ---')
    const prodCtx = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      serviceWorkers: 'block',
      ignoreHTTPSErrors: true,
      reducedMotion: 'reduce',
    })
    const prodPage = await prodCtx.newPage()
    prodPage.setDefaultTimeout(30_000)
    const prodErrors = []
    prodPage.on('pageerror', (e) => prodErrors.push(e.message))

    const nav = await prodPage.goto(`https://${PROD_HOST}:${prodPort}/`, { waitUntil: 'domcontentloaded' })
    check(nav?.ok() ?? false, 'HTTPS 生产形态可访问', `HTTP ${nav?.status()}`)
    check(
      (await prodPage.evaluate(() => window.location.protocol)) === 'https:',
      '页面协议为 https（tldraw 生产判定前提）'
    )

    await prodPage.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 30_000 })
    await prodPage.click('[data-testid=co-enter]')
    await prodPage.waitForSelector('[data-testid=canvas-workbench]', { timeout: 20_000 })
    await prodPage.locator('.wls-palette-item').first().click()
    await prodPage.waitForTimeout(1200)
    const beforeGate = await canvasStorage(prodPage)
    check(Object.keys(beforeGate).length > 0, '画布数据已写入本地存储（闸门前）', Object.keys(beforeGate).join(','))

    // 等过 tldraw 的 5s 宽限期
    await prodPage.waitForTimeout(6500)

    const gateFired = await prodPage.evaluate(
      () => Boolean(document.querySelector('[data-testid="tl-license-expired"]'))
    )
    const noticeCount = await prodPage.locator('[data-testid=tldraw-license-notice]').count()
    const prodNodeDom = await prodPage.evaluate(() => document.querySelectorAll('.wls-node').length)
    const paletteAlive = await prodPage.locator('.wls-palette-item').count()
    const afterGate = await canvasStorage(prodPage)
    // 顶部说明条文案：它位于 <Tldraw> 子树内，闸门触发后会随编辑器一起被卸载，
    // 所以这里必须「有则读、无则空」，不能用 textContent() 直接等（会超时）。
    const hintCount = await prodPage.locator('.wls-canvas-hint').count()
    const hintText = hintCount > 0 ? (await prodPage.locator('.wls-canvas-hint').first().textContent()) || '' : ''
    const noticeText = noticeCount > 0 ? (await prodPage.textContent('[data-testid=tldraw-license-notice]')) || '' : ''

    if (licensed) {
      // ---- 已配置 license key：预期「不触发闸门」 ----
      // key 有效性只告警（不阻断部署）：过期/失效属授权运维事件，仍要如实打印。
      if (gateFired) {
        warn('已配置 license key 但生产环境闸门仍触发 —— key 可能已过期或无效（按约定不阻断部署）')
        // key 失效时，兜底链路必须仍然可用：如实提示条要出现，且要讲清「为什么画布没了」
        check(noticeCount > 0, 'key 失效时应退回「如实提示」兜底（提示条已展示）')
        check(/5 秒/.test(noticeText), 'key 失效：提示条说明含「约 5 秒后停止渲染」这一事实')
        check(/VITE_TLDRAW_LICENSE_KEY/.test(noticeText), 'key 失效：提示条仍给出官方解决路径')
      } else {
        check(true, '已配置 license key：生产环境闸门未触发（key 有效）')
        check(noticeCount === 0, '已配置 license key：不显示许可提示（提示不是误报）')
        check(
          !/5 秒停渲染/.test(hintText),
          '已配置 license key：顶部说明条不再展示 tldraw 限制文案（过期文案回归）',
          hintText.slice(0, 60)
        )
        check(prodNodeDom > 0, '已配置 license key：生产环境画布正常渲染节点', `${prodNodeDom} 个`)
      }
      check(paletteAlive > 0, '外层自有 UI 正常（节点面板仍在）', `${paletteAlive} 项`)
      check(
        JSON.stringify(afterGate) === JSON.stringify(beforeGate),
        '画布数据未丢失（键值变化只影响渲染授权）'
      )
      check(prodErrors.length === 0, '生产形态全程零 pageerror', prodErrors.slice(0, 3).join(' | ') || 'ok')
    } else {
      // ---- 未配置 license key：预期「触发闸门 + 如实提示」 ----
      check(gateFired, 'tldraw 生产许可闸门确实触发（证明本套件真的复现了线上形态）')
      check(noticeCount > 0, '本项目「诚实提示」已展示（不再是莫名空画布）')
      check(/VITE_TLDRAW_LICENSE_KEY/.test(noticeText), '提示含官方解决路径（不提供绕过手段）')
      check(/不提供任何绕过许可校验/.test(noticeText), '提示明确声明不绕过许可校验')
      // 说明条在闸门后会被卸载 → 「为什么画布没了」必须由提示条自己讲清（含 5 秒停渲染这一事实）
      check(/5 秒/.test(noticeText), '提示条说明含「约 5 秒后停止渲染」这一事实')
      check(paletteAlive > 0, '外层自有 UI 未崩（节点面板仍在）', `${paletteAlive} 项`)
      check(
        JSON.stringify(afterGate) === JSON.stringify(beforeGate),
        '画布数据未丢失（闸门只影响渲染，不动存储）'
      )
      check(prodErrors.length === 0, '生产形态全程零 pageerror', prodErrors.slice(0, 3).join(' | ') || 'ok')
    }
    await prodCtx.close()

    // ---------- B) 对照：开发形态（http）不应出现提示 ----------
    console.log('\n--- B) 对照形态：http://127.0.0.1 ---')
    const devCtx = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    })
    const devPage = await devCtx.newPage()
    devPage.setDefaultTimeout(30_000)
    await devPage.goto(`http://127.0.0.1:${devPort}/`, { waitUntil: 'domcontentloaded' })
    await devPage.waitForSelector('[data-testid=canvas-onboarding]', { timeout: 30_000 })
    await devPage.click('[data-testid=co-enter]')
    await devPage.waitForSelector('[data-testid=canvas-workbench]', { timeout: 20_000 })
    await devPage.locator('.wls-palette-item').first().click()
    await devPage.waitForTimeout(6500)

    const devGate = await devPage.evaluate(
      () => Boolean(document.querySelector('[data-testid="tl-license-expired"]'))
    )
    check(!devGate, '开发形态（http）闸门不触发（tldraw 豁免）')
    const devNotice = await devPage
      .locator('[data-testid=tldraw-license-notice]')
      .count()
    check(devNotice === 0, '开发形态不显示许可提示（提示不是误报）')
    const devShapes = await devPage.evaluate(
      () => document.querySelectorAll('.wls-node').length
    )
    check(devShapes > 0, '开发形态画布正常渲染节点', `${devShapes} 个`)
    await devCtx.close()
  } finally {
    await browser?.close().catch(() => {})
    prodServer.close()
    devServer.close()
  }

  if (warnings > 0) console.warn(`\n（告警 ${warnings} 项，不阻断部署）`)
  console.log(
    failures === 0
      ? '\n=== 生产模式回归：全部通过 ==='
      : `\n=== 生产模式回归：${failures} 项失败 ===`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n❌ 套件异常终止：', err instanceof Error ? err.message : err)
  process.exit(1)
})
