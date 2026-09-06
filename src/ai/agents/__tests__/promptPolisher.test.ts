import test from 'node:test'
import assert from 'node:assert/strict'
import { polishPrompt, STYLE_OPTIONS } from '../promptPolisher.ts'

test('提示词智能润色 Agent：0-Key 模式下的高质量内置模板扩写', async () => {
  const res = await polishPrompt({
    rawIdea: '口红涂抹特写，高级冷白皮，水光质感',
    style: 'luxury',
    variation: 0,
  })

  assert.ok(res.polishedPrompt.length > 30, '扩写提示词应具有足够的细节长度')
  assert.ok(res.negativePrompt.length > 10, '应包含负向提示词约束')
  assert.ok(res.cameraMovement.includes('微距'), '机位应包含运镜轨迹描述')
  assert.ok(res.lighting.length > 0, '应包含布光参数')
  assert.equal(res.styleLabel, '💎 高端轻奢')
  assert.ok(res.tags.length >= 3, '应提取标签')
})

test('提示词智能润色 Agent：不满意重新润色应产出不同机位变体', async () => {
  const v1 = await polishPrompt({
    rawIdea: '高速负离子电吹风',
    style: 'cinematic',
    variation: 0,
  })

  const v2 = await polishPrompt({
    rawIdea: '高速负离子电吹风',
    style: 'cinematic',
    variation: 1,
  })

  assert.notEqual(v1.polishedPrompt, v2.polishedPrompt, '不同变体轮次应产出差异化提示词')
})

test('提示词风格库：包含至少 5 种精选调色与运镜风格', () => {
  assert.equal(STYLE_OPTIONS.length, 5)
  const ids = STYLE_OPTIONS.map((s) => s.id)
  assert.ok(ids.includes('cinematic'))
  assert.ok(ids.includes('luxury'))
  assert.ok(ids.includes('cyberpunk'))
  assert.ok(ids.includes('minimal'))
  assert.ok(ids.includes('fresh'))
})
