import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TLDRAW_LICENSE_ENV_KEY,
  TLDRAW_LICENSE_GRACE_MS,
  TLDRAW_LICENSE_MARKER_TESTID,
  currentTldrawLicenseMode,
  hasTldrawLicenseKey,
  isLoopbackHostname,
  isTldrawDevEnvironment,
  resolveTldrawLicenseMode,
} from '../tldrawLicense.ts'

/**
 * 口径来源：tldraw@5.4.0 构建产物内的 `getIsDevelopment()` 与许可闸门常量。
 * 这些断言是「本地全绿、线上画布消失」这一事故的**规格化固化**：
 * 一旦 tldraw 升级改变了豁免口径，这里会先失败。
 */

test('回环主机判定（localhost / 127.x / ::1，含 IPv6 方括号）', () => {
  for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
    assert.equal(isLoopbackHostname(h), true, h)
  }
  for (const h of ['qwqcool.github.io', 'example.com', '192.168.1.10', 'wls.prod.test', '']) {
    assert.equal(isLoopbackHostname(h), false, h)
  }
})

test('开发环境豁免口径：http 一律豁免；https 仅回环豁免；*.localhost 被 tldraw 显式排除', () => {
  // http 一律算开发环境（这正是本地 127.0.0.1 与 http 预览永远看不到该现象的原因）
  assert.equal(isTldrawDevEnvironment('http:', 'qwqcool.github.io'), true)
  assert.equal(isTldrawDevEnvironment('http:', '127.0.0.1'), true)
  // https + 回环 → 豁免
  assert.equal(isTldrawDevEnvironment('https:', 'localhost'), true)
  assert.equal(isTldrawDevEnvironment('https:', '127.0.0.1'), true)
  assert.equal(isTldrawDevEnvironment('https:', '[::1]'), true)
  // https + 公网域名 → 生产（闸门生效）
  assert.equal(isTldrawDevEnvironment('https:', 'qwqcool.github.io'), false)
  // tldraw 的显式短路：以 `.localhost` 结尾反而**不算**开发环境（与直觉相反，照抄其口径）
  assert.equal(isTldrawDevEnvironment('https:', 'app.localhost'), false)
})

test('许可模式判定：有 key 优先 licensed；否则开发豁免 / 生产未授权', () => {
  assert.equal(
    resolveTldrawLicenseMode({ protocol: 'https:', hostname: 'qwqcool.github.io', hasKey: true }),
    'licensed'
  )
  assert.equal(
    resolveTldrawLicenseMode({ protocol: 'https:', hostname: 'qwqcool.github.io', hasKey: false }),
    'unlicensed-production'
  )
  assert.equal(
    resolveTldrawLicenseMode({ protocol: 'http:', hostname: 'anything.example', hasKey: false }),
    'dev-exempt'
  )
})

test('许可 key 读取：仅认 VITE_TLDRAW_LICENSE_KEY 的非空字符串', () => {
  assert.equal(TLDRAW_LICENSE_ENV_KEY, 'VITE_TLDRAW_LICENSE_KEY')
  assert.equal(hasTldrawLicenseKey({}), false)
  assert.equal(hasTldrawLicenseKey({ VITE_TLDRAW_LICENSE_KEY: '   ' }), false)
  assert.equal(hasTldrawLicenseKey({ VITE_TLDRAW_LICENSE_KEY: 123 }), false)
  assert.equal(hasTldrawLicenseKey({ VITE_TLDRAW_LICENSE_KEY: 'tldraw-x.y.z' }), true)
})

test('常量与标记与 tldraw 源码一致（宽限 5s / 闸门标记 testid）', () => {
  assert.equal(TLDRAW_LICENSE_GRACE_MS, 5000)
  assert.equal(TLDRAW_LICENSE_MARKER_TESTID, 'tl-license-expired')
})

test('非浏览器环境（node --test）安全回落 dev-exempt，不抛错', () => {
  assert.equal(typeof window, 'undefined')
  assert.equal(currentTldrawLicenseMode(), 'dev-exempt')
})
