import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SCENE_GALLERY_CARDS,
  SCENE_GALLERY_TOPOLOGY,
  sceneCardRoutingIssues,
} from '../sceneGallery.ts'
import { routeOrchestrationScene } from '../contract.ts'

test('SCENE_GALLERY_CARDS：六类场景 + 序号 01~06 + 字段齐备（图8 1:1）', () => {
  assert.equal(SCENE_GALLERY_CARDS.length, 6)
  assert.deepEqual(
    SCENE_GALLERY_CARDS.map((c) => c.number),
    ['01', '02', '03', '04', '05', '06']
  )
  assert.deepEqual(
    SCENE_GALLERY_CARDS.map((c) => c.title),
    ['品牌设计', '电商物料', '影视文娱', '游戏内容', '产品 UI/UX', '宣传物料']
  )
  for (const c of SCENE_GALLERY_CARDS) {
    assert.ok(c.subtitle.length > 0, `${c.title} 需有副标题`)
    assert.ok(c.tagline.length > 0, `${c.title} 需有标语`)
    assert.ok(c.prompt.length >= 20, `${c.title} 预填 prompt 需足够具体`)
    assert.ok(c.glyph.length > 0)
    assert.equal(c.gradient.length, 2)
    assert.ok(c.gradient[0].startsWith('#') && c.gradient[1].startsWith('#'))
  }
})

test('sceneCardRoutingIssues：六卡 prompt 关键词路由必须回到各自 scene（预填→编排不落错场景）', () => {
  const issues = sceneCardRoutingIssues()
  assert.deepEqual(issues, [], `路由不一致：${issues.join('；')}`)
})

test('场景 prompt 路由逐项核对（显式断言，防关键词漂移）', () => {
  for (const c of SCENE_GALLERY_CARDS) {
    assert.equal(routeOrchestrationScene(c.prompt), c.scene, `${c.title} 应路由到 ${c.scene}`)
  }
})

test('SCENE_GALLERY_TOPOLOGY：建议拓扑与演示编排同链（5 节点顺序固定）', () => {
  assert.deepEqual(
    SCENE_GALLERY_TOPOLOGY.map((n) => n.kind),
    ['brief', 'script', 'storyboard', 'generate', 'deliver']
  )
  for (const n of SCENE_GALLERY_TOPOLOGY) {
    assert.ok(n.label.length > 0)
    assert.ok(n.icon.length > 0)
  }
})
