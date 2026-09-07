import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STRUCTURE_TEMPLATES,
  pickTemplateId,
  weightedSampleHook,
} from '../structures.ts'
import { computeWinRates } from '../../../domain/feedback.ts'
import type { FeedbackRecord } from '../../../domain/feedback.ts'

test('钩子库元数据：每个模板带品类/情绪轴/胜率先验且长度自洽', () => {
  for (const tpl of STRUCTURE_TEMPLATES) {
    assert.ok(tpl.categories.length >= 1, `${tpl.name} 必须声明适用品类`)
    assert.equal(tpl.emotionArc.length, 6, `${tpl.name} 情绪轴必须 6 拍`)
    assert.ok(tpl.baselineWinRate >= 0 && tpl.baselineWinRate <= 1)
    if (tpl.hookWinRates) {
      assert.equal(tpl.hookWinRates.length, tpl.hookSamples.length, '钩子胜率须与钩子一一对应')
    }
    if (tpl.hookTypes) {
      assert.equal(tpl.hookTypes.length, tpl.hookSamples.length, '钩子类型须与钩子一一对应')
    }
  }
})

test('元数据路由：按品类命中模板，未命中返回 undefined', () => {
  assert.equal(pickTemplateId('美妆护肤'), 't1_pain_opening')
  assert.equal(pickTemplateId('数码潮玩'), 't3_unboxing_review')
  assert.equal(pickTemplateId('情侣送礼'), 't4_story_insert')
  assert.equal(pickTemplateId('平替好物'), 't5_price_anchor')
  assert.equal(pickTemplateId('收纳神器'), 't2_contrast_reveal')
  assert.equal(pickTemplateId('不存在的品类'), undefined)
  assert.equal(pickTemplateId(undefined), undefined)
})

test('胜率加权采样：高胜率钩子被优先选中（确定性 rng）', () => {
  const tpl = STRUCTURE_TEMPLATES[0]
  // 命中钩子 #3 胜率拉满，其余 0
  const lookup = (_id: string, i: number) => (i === 3 ? 1 : 0)
  const picked = weightedSampleHook(tpl, lookup, () => 0.99)
  assert.equal(picked.index, 3)
  assert.equal(picked.text, tpl.hookSamples[3])
})

test('胜率加权采样：全零权重回退均匀分布，永不空转', () => {
  const tpl = STRUCTURE_TEMPLATES[0]
  const lookup = () => 0
  const picked = weightedSampleHook(tpl, lookup, () => 0.5)
  assert.ok(picked.index >= 0 && picked.index < tpl.hookSamples.length)
})

test('回流聚合：Laplace 平滑胜率计算正确', () => {
  const records: FeedbackRecord[] = [
    mkRecord('t1', 0, 0.4), // win
    mkRecord('t1', 0, 0.2), // lose
    mkRecord('t1', 0, 0.5), // win
    mkRecord('t2', 1, 0.1), // lose
  ]
  const agg = computeWinRates(records)

  const t1 = agg.byTemplate.get('t1')
  assert.ok(t1)
  assert.equal(t1.trials, 3)
  assert.equal(t1.wins, 2)
  assert.ok(Math.abs(t1.winRate - 3 / 5) < 1e-9, 'Laplace: (2+1)/(3+2)=0.6')

  const hook = agg.byHook.get('t2#1')
  assert.ok(hook)
  assert.equal(hook.wins, 0)
  assert.ok(Math.abs(hook.winRate - 1 / 3) < 1e-9, 'Laplace: (0+1)/(1+2)')
})

function mkRecord(templateId: string, hookIndex: number, view3sRate: number): FeedbackRecord {
  return {
    id: `fb_${templateId}_${hookIndex}_${view3sRate}`,
    videoTitle: 't',
    templateId,
    hookIndex,
    view3sRate,
    completionRate: 0.1,
    createdAt: 0,
  }
}
