import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateSpeechRate, isTtsSupported, stopTts, speakShotText } from '../audio.ts'

test('TTS 引擎：Node 环境安全防护（无 window / 无 speechSynthesis 时安全降级）', () => {
  // 在 Node.js 环境下，isTtsSupported 必须返回 false，且不会抛出未定义异常
  assert.equal(isTtsSupported(), false)
  // 调用 stopTts 和 speakShotText 应安全返回，不崩溃
  assert.doesNotThrow(() => stopTts())
  const res = speakShotText('测试台词', 3)
  assert.equal(res, null)
})

test('TTS 语速自适应算法：根据台词字数与镜头时长动态计算 rate', () => {
  // 正常语速 4.2 字/秒：12 字在 3 秒播完 -> rate 接近 1.0 (约 0.95)
  const normalRate = calculateSpeechRate(12, 3)
  assert.ok(normalRate >= 0.85 && normalRate <= 1.1, `正常语速应在合理区间，实际为 ${normalRate}`)

  // 极长台词：28 字在 3 秒播完 -> 需加速，但不应超出 1.8 上限
  const fastRate = calculateSpeechRate(28, 3)
  assert.ok(fastRate > 1.2, `长台词应提速，实际为 ${fastRate}`)
  assert.ok(fastRate <= 1.8, '最高语速不应超过 1.8')

  // 极短台词：2 个字在 5 秒播完 -> 降速，但不应低于 0.85 下限
  const slowRate = calculateSpeechRate(2, 5)
  assert.ok(slowRate >= 0.85, '最低语速不应低于 0.85')

  // 边界值保护
  assert.equal(calculateSpeechRate(0, 5), 1.0)
  assert.equal(calculateSpeechRate(10, 0), 1.0)
})
