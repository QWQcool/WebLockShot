#!/usr/bin/env node
/**
 * 关键纯函数层覆盖率基线（CANVAS_PLAN.md §9 T2）
 *
 * 用 Node 内置 `--experimental-test-coverage` 跑 node 侧单测（复用 package.json 的
 * `test:node` 文件清单，零重复维护），抽取画布契约 / 纯函数层文件的覆盖率，与 80% 门槛比对。
 *
 * 诚实口径：
 *   - 未达标**不阻塞**（exit 0），逐项列出缺口（本切片只做基线，不做门槛卡点）
 *   - `--strict` 时任一目标文件行覆盖率 < 80% → exit 1（供将来接入 CI 卡点）
 *   - 目标文件在覆盖表中缺失（未被任何 node 单测触达）→ 如实记为「未覆盖」
 *
 * 用法：
 *   npm run test:coverage
 *   npm run test:coverage -- --strict
 *   npm run test:coverage -- --json   # 机器可读输出
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const argv = process.argv.slice(2)
const STRICT = argv.includes('--strict')
const JSON_OUT = argv.includes('--json')
const THRESHOLD = 80

/** 目标纯函数层（T2 验收清单）；key = 覆盖表中的文件 basename */
const TARGETS = [
  ['contract.ts', 'src/canvas/contract.ts', '画布节点/边/Skill/编排契约'],
  ['stage3dMeta.ts', 'src/canvas/stage3dMeta.ts', '3D 摆台 meta 契约'],
  ['stage3dScenes.ts', 'src/canvas/stage3dScenes.ts', '3D 程序化场景预设'],
  ['stage3dAnim.ts', 'src/canvas/stage3dAnim.ts', '3D 动作预设映射'],
  ['memorySource.ts', 'src/canvas/memorySource.ts', '记忆双模聚合源'],
  ['feedback.ts', 'src/domain/feedback.ts', '回流 Laplace 胜率聚合（唯一聚合层）'],
  ['projectStore.ts', 'src/canvas/projectStore.ts', '多画布项目索引/迁移'],
  ['minimap.ts', 'src/canvas/minimap.ts', '小地图坐标换算'],
  ['mcpOps.ts', 'src/canvas/mcpOps.ts', 'MCP 操作批校验/幂等'],
  ['sceneGallery.ts', 'src/canvas/sceneGallery.ts', '六类创作场景卡片路由'],
]

/** 去掉 ANSI 颜色码（用 RegExp 构造避免 lint 的「控制字符字面量」告警） */
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (s) => s.replace(ANSI_RE, '')

/** 从 package.json 的 test:node 提取测试文件清单（单一来源，避免重复维护） */
function testFiles() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
  const script = pkg.scripts['test:node']
  if (!script) throw new Error('package.json 缺少 scripts.test:node')
  return script
    .split(/\s+/)
    .filter((t) => /\.(test\.ts|test\.mjs)$/.test(t))
}

function runCoverage() {
  const files = testFiles()
  return execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--experimental-test-coverage', '--test', ...files],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
}

/** 解析 node 覆盖表：`ℹ <file> | line % | branch % | funcs % | uncovered lines` */
function parseTable(raw) {
  const rows = new Map()
  for (const line of stripAnsi(raw).split(/\r?\n/)) {
    if (!line.startsWith('ℹ')) continue
    const body = line.slice(1).trim()
    if (body.startsWith('-') || body.startsWith('start of') || body.startsWith('end of')) continue
    const cells = body.split('|').map((c) => c.trim())
    if (cells.length < 4) continue
    const [file, linePct, branchPct, funcsPct] = cells
    if (file === 'file' || file === 'all files') continue
    const num = (v) => (v === '' || v === undefined ? null : Number(v))
    const base = file.split(/[\\/]/).pop()
    rows.set(base, {
      file,
      line: num(linePct),
      branch: num(branchPct),
      funcs: num(funcsPct),
      uncovered: cells[4] ?? '',
    })
  }
  return rows
}

function main() {
  const rows = parseTable(runCoverage())
  const report = TARGETS.map(([base, path, desc]) => {
    const row = rows.get(base)
    return {
      file: path,
      desc,
      line: row?.line ?? null,
      branch: row?.branch ?? null,
      funcs: row?.funcs ?? null,
      uncovered: row?.uncovered ?? '',
      pass: row?.line !== null && row?.line !== undefined && row.line >= THRESHOLD,
    }
  })

  if (JSON_OUT) {
    console.log(JSON.stringify({ threshold: THRESHOLD, targets: report }, null, 2))
  } else {
    console.log(`\n=== 画布关键纯函数层覆盖率基线（门槛 ${THRESHOLD}% 行覆盖）===`)
    console.log('文件                                  行%     分支%   函数%   判定   说明')
    for (const r of report) {
      const pct = (v) => (v === null ? '  n/a' : String(v).padStart(6))
      console.log(
        `${r.file.padEnd(38)}${pct(r.line)} ${pct(r.branch)} ${pct(r.funcs)}   ` +
          `${r.pass ? '✅' : '⚠️ '}    ${r.desc}`
      )
    }
    const gaps = report.filter((r) => !r.pass)
    const covered = report.length - gaps.length
    console.log(`\n达标 ${covered}/${report.length}（未达标项如实记录，不伪造覆盖率）`)
    for (const g of gaps) {
      console.log(
        `  ⚠️  ${g.file}：行覆盖 ${g.line === null ? '未覆盖（无单测触达）' : `${g.line}%`}` +
          (g.uncovered ? ` · 未覆盖行 ${g.uncovered.slice(0, 80)}` : '')
      )
    }
  }

  const failed = report.filter((r) => !r.pass).length
  if (STRICT && failed > 0) {
    console.error(`\n--strict：${failed} 项未达 ${THRESHOLD}% 行覆盖门槛`)
    process.exit(1)
  }
  process.exit(0)
}

main()
