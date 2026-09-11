/**
 * 画布实机测试公共环境（T1 E2E / T3 性能基准共用）
 *
 * 提供：Playwright 多路径解析（缺失即诚实跳过）、dist 构建保障、伴生服务启停、健康等待。
 * 不提供断言/流程逻辑——那些留在各自脚本里，保持职责单一。
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

/** 画布节点 shape type（contract.ts CANVAS_NODE_SHAPE_TYPE） */
export const NODE_SHAPE_TYPE = 'wls-node'

/**
 * 依次尝试：项目 node_modules → 全局 npm root → npx 缓存目录。
 * 返回 playwright 模块或 null（null = 环境未安装，调用方走诚实跳过）。
 */
export function loadPlaywright() {
  const candidates = [ROOT]
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (globalRoot) candidates.push(globalRoot)
  } catch {
    /* npm 不可用时忽略 */
  }
  const npxCache = join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
  try {
    for (const dir of readdirSync(npxCache)) candidates.push(join(npxCache, dir, 'node_modules'))
  } catch {
    /* 无 npx 缓存时忽略 */
  }
  for (const base of candidates) {
    try {
      return require(require.resolve('playwright', { paths: [base] }))
    } catch {
      /* 继续下一个候选 */
    }
  }
  return null
}

/** 环境不满足时的诚实退出（exit 0，不伪装通过） */
export function skipEnv(title, reason) {
  console.log(`\n=== ${title} 已跳过（环境不满足）===`)
  console.log(`原因：${reason}`)
  console.log('启用方式：')
  console.log('  npm i -D playwright && npx playwright install chromium')
  console.log('（套件在无 Playwright 的环境下如实跳过，不伪装通过）')
  process.exit(0)
}

/** 保障 dist 存在：--skip-build 时缺失则回退完整构建 */
export function ensureDist({ skipBuild = false } = {}) {
  if (!skipBuild) {
    console.log('· 构建 dist（--skip-build 可复用现有产物）…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
    return
  }
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.log('· dist 缺失，回退为完整构建…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
  }
}

export async function waitHealthy(base, deadlineMs = 20_000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) return true
    } catch {
      /* 未就绪，继续等 */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

/**
 * 启动伴生服务（托管 dist）。
 * 注意：必须同时消费 stdout 与 stderr——只消费一路会让另一路写满 64KB 管道缓冲后阻塞进程。
 */
export function startCompanionServer(port, { storage = 'memory', tmpDir = '.tmp-e2e' } = {}) {
  const draftDir = join(ROOT, tmpDir, 'drafts')
  mkdirSync(draftDir, { recursive: true })
  const child = spawn(
    process.execPath,
    ['server/weblockshot-server.mjs', '--port', String(port), '--dist', join(ROOT, 'dist'), '--draft-dir', draftDir],
    {
      cwd: ROOT,
      env: { ...process.env, WLS_STORAGE: storage, WLS_LOG_LEVEL: 'error' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  let log = ''
  child.stdout.on('data', (d) => (log += String(d)))
  child.stderr.on('data', (d) => (log += String(d)))
  return { child, getLog: () => log }
}

/** 随机端口（避开常用端口区间） */
export function randomPort(base = 23_000, span = 2_000) {
  return base + Math.floor(Math.random() * span)
}
