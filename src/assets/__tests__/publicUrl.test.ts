import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { joinBase, publicUrl } from '../publicUrl.ts'
import { BUILTIN_CHARACTER_MODEL_URL } from '../../canvas/stage3dAssets.ts'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('publicUrl：joinBase 拼接边界（尾斜杠 / 首斜杠 / 空 base 均正确）', () => {
  // GitHub Pages 子路径（vite base）
  assert.equal(joinBase('/WebLockShot/', 'models/a.glb'), '/WebLockShot/models/a.glb')
  // base 无尾斜杠也要补上（否则会拼成 /WebLockShotmodels/…）
  assert.equal(joinBase('/WebLockShot', 'models/a.glb'), '/WebLockShot/models/a.glb')
  // 本地 dev / 根路径托管
  assert.equal(joinBase('/', 'models/a.glb'), '/models/a.glb')
  // 路径带首斜杠不能产生双斜杠
  assert.equal(joinBase('/WebLockShot/', '/models/a.glb'), '/WebLockShot/models/a.glb')
  assert.equal(joinBase('/', '//scenes/x.webp'), '/scenes/x.webp')
})

test('publicUrl：非浏览器环境回落根路径（与改造前一致，node --test 可跑）', () => {
  assert.equal(publicUrl('models/a.glb'), '/models/a.glb')
  assert.equal(publicUrl('/presets/x.jpg'), '/presets/x.jpg')
  assert.equal(publicUrl('scenes/ecommerce.webp'), '/scenes/ecommerce.webp')
})

test('3D 素体模型 URL 来自统一解析器（非手写根绝对路径）', () => {
  assert.equal(BUILTIN_CHARACTER_MODEL_URL, '/models/quaternius-universal-character.glb')
})

/**
 * 防回归（2026-09-11 线上白屏事故的根因）：源码里**禁止**写死 public 资源的根绝对路径。
 * 子路径部署下 `/models/x.glb` 会 404，而本地根路径托管全绿——只有这条断言能提前拦住。
 */
test('防回归：src 下不得写死 public 资源的根绝对路径字面量', () => {
  const FORBIDDEN = /(['"`])\/(models|scenes|presets|icons|pwa-[^'"`]*)\//g
  const offenders: string[] = []

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (name === '__tests__') continue // 测试内的路径是 fixture，不是线上资源请求
        walk(p)
        continue
      }
      if (!/\.(ts|tsx)$/.test(name)) continue
      if (p.endsWith(join('assets', 'publicUrl.ts'))) continue // 解析器自身实现
      const lines = readFileSync(p, 'utf8').split('\n')
      lines.forEach((line, i) => {
        const trimmed = line.trim()
        // 纯注释行跳过：文档里会出现「写死 `/models/…` 会 404」这类反例说明
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        if (FORBIDDEN.test(line)) {
          offenders.push(`${p.replace(SRC_DIR, 'src')}:${i + 1}: ${trimmed}`)
        }
        FORBIDDEN.lastIndex = 0
      })
    }
  }
  walk(SRC_DIR)

  assert.deepEqual(offenders, [], `发现手写的根绝对路径（子路径部署会 404）：\n${offenders.join('\n')}`)
})
