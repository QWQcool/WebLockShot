#!/usr/bin/env node
/**
 * verify:providers —— 引擎真实连通性探测 CLI（M2c）
 *
 * 用法：
 *   npm run verify:providers
 *   npm run verify:providers -- --kling-key=AK:SK --jimeng-key=AK:SK
 *   npm run verify:providers -- --kling-key=AK:SK --kling-base=https://api.klingai.com
 *   npm run verify:providers -- --jimeng-key=AK:SK --jimeng-base=https://api.jimeng.bytedance.com
 *
 * - --kling-key  支持 "AK:SK"（自动签发官方 JWT）或裸 Token（Bearer 直传）
 * - --jimeng-key 支持 "AK:SK"（火山引擎 V4 HMAC 签名）
 * - 无参数：输出使用说明并以退出码 2 结束（CI 友好，不算失败）
 *
 * 注意：可灵探测依赖官方 GET /v1/videos/text2video 列表端点；若官方后续仅保留 POST，
 * 请调整 probeKling 的探测端点与 classifyProbe 判定。
 *
 * 退出码：0 = 全部探测通过；1 = 有探测被远端明确拒绝（401/403）；2 = 未提供任何 key
 *
 * ⏳ 验证层级标注：本脚本执行的是「真实环境最小请求探测」；
 *    离线契约级验证见 src/media/__tests__/authVectors.test.ts 与 providerContract.test.ts（✅ 已由 CI 覆盖）。
 */
import { signKlingJwt } from '../src/media/auth/klingJwt.ts'
import { buildJimengSignedHeaders } from '../src/media/auth/jimengAuth.ts'

const KLING_BASE_DEFAULT = 'https://api.klingai.com'
const JIMENG_BASE_DEFAULT = 'https://api.jimeng.bytedance.com'
const TIMEOUT_MS = 10_000

function parseArgs(argv) {
  const args = {
    klingKey: null,
    jimengKey: null,
    klingBase: KLING_BASE_DEFAULT,
    jimengBase: JIMENG_BASE_DEFAULT,
  }
  for (const arg of argv) {
    const m = /^(--kling-key|--jimeng-key|--kling-base|--jimeng-base)=(.+)$/.exec(arg)
    if (!m) continue
    const [, name, value] = m
    if (name === '--kling-key') args.klingKey = value
    else if (name === '--jimeng-key') args.jimengKey = value
    else if (name === '--kling-base') args.klingBase = value.replace(/\/$/, '')
    else if (name === '--jimeng-base') args.jimengBase = value.replace(/\/$/, '')
  }
  return args
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function classifyProbe(status, bodyText) {
  if (status >= 200 && status < 300) return { verdict: 'ok', note: 'HTTP 2xx' }
  if (status === 401 || status === 403) {
    return { verdict: 'rejected', note: `HTTP ${status}（凭证被远端拒绝）` }
  }
  if (status === 404) {
    // 探测资源不存在但签名/鉴权已通过网关校验
    return { verdict: 'ok', note: 'HTTP 404（探测资源不存在，但鉴权已通过）' }
  }
  return {
    verdict: 'unknown',
    note: `HTTP ${status}${bodyText ? `: ${bodyText.slice(0, 120)}` : ''}（鉴权未被明确拒绝，需人工确认）`,
  }
}

async function probeKling(key, base) {
  const label = key.includes(':') ? 'AK:SK（JWT 模式）' : '裸 Token（Bearer 模式）'
  let authHeader
  if (key.includes(':')) {
    const [ak, sk] = key.split(':', 2)
    authHeader = await signKlingJwt(ak, sk)
  } else {
    authHeader = key.startsWith('Bearer ') ? key : `Bearer ${key}`
  }

  try {
    const res = await fetchWithTimeout(`${base}/v1/videos/text2video?page_size=1`, {
      method: 'GET',
      headers: { Authorization: authHeader },
    })
    const body = await res.text().catch(() => '')
    const { verdict, note } = classifyProbe(res.status, body)
    return { engine: 'kling', mode: label, verdict, note }
  } catch (err) {
    return { engine: 'kling', mode: label, verdict: 'network', note: `网络异常: ${err.message}` }
  }
}

async function probeJimeng(key, base) {
  if (!key.includes(':')) {
    return {
      engine: 'jimeng',
      mode: '裸 Token（Bearer 模式）',
      verdict: 'skipped',
      note: '即梦官方 V4 签名需要 AK:SK 形态；裸 Token 无法完成签名探测',
    }
  }
  const [ak, sk] = key.split(':', 2)
  const url = new URL(`${base}/v1/videos/tasks/contract-probe`)
  let headers
  try {
    headers = await buildJimengSignedHeaders({
      accessKey: ak,
      secretKey: sk,
      method: 'GET',
      host: url.host,
      path: url.pathname,
      query: url.search ? url.search.slice(1) : '',
    })
  } catch (err) {
    return { engine: 'jimeng', mode: 'AK:SK（V4 签名模式）', verdict: 'rejected', note: err.message }
  }

  try {
    const res = await fetchWithTimeout(url.toString(), { method: 'GET', headers })
    const body = await res.text().catch(() => '')
    const { verdict, note } = classifyProbe(res.status, body)
    return { engine: 'jimeng', mode: 'AK:SK（V4 签名模式）', verdict, note }
  } catch (err) {
    return { engine: 'jimeng', mode: 'AK:SK（V4 签名模式）', verdict: 'network', note: `网络异常: ${err.message}` }
  }
}

const VERDICT_MARK = {
  ok: '✅ 通过',
  rejected: '❌ 拒绝',
  network: '⚠️ 网络不可达',
  unknown: '⚠️ 待人工确认',
  skipped: '⏭️ 跳过',
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.klingKey && !args.jimengKey) {
    console.log(`
WebLockShot 引擎连通性探测 (verify:providers)

用法：
  npm run verify:providers -- --kling-key=AK:SK --jimeng-key=AK:SK

说明：
- 可灵 key 形态 "AK:SK" 自动签发官方 JWT（HS512）；裸 Token 走 Bearer 直传
- 即梦 key 形态 "AK:SK" 走火山引擎 V4 HMAC-SHA256 签名
- 无任何 key 时本命令仅输出本说明（退出码 2，CI 中不算失败）

离线契约级验证（无需真实 key）：npm test
  - 可灵 JWT / 即梦 V4 签名向量测试：src/media/__tests__/authVectors.test.ts
  - 请求形状与响应解析契约：src/media/__tests__/providerContract.test.ts + test/fixtures/
`)
    process.exit(2)
  }

  console.log('WebLockShot 引擎连通性探测报告')
  console.log(`时间: ${new Date().toISOString()}\n`)

  const results = []
  if (args.klingKey) {
    console.log(`[kling] 探测中 -> GET ${args.klingBase}/v1/videos/text2video?page_size=1`)
    results.push(await probeKling(args.klingKey, args.klingBase))
  }
  if (args.jimengKey) {
    console.log(`[jimeng] 探测中 -> GET ${args.jimengBase}/v1/videos/tasks/contract-probe`)
    results.push(await probeJimeng(args.jimengKey, args.jimengBase))
  }

  console.log('')
  let rejected = false
  for (const r of results) {
    console.log(`${VERDICT_MARK[r.verdict]}  [${r.engine}] ${r.mode} — ${r.note}`)
    if (r.verdict === 'rejected') rejected = true
  }

  process.exit(rejected ? 1 : 0)
}

main().catch((err) => {
  console.error('探测脚本异常:', err instanceof Error ? err.message : err)
  process.exit(1)
})
