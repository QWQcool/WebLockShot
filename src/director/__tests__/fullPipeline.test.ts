import test from 'node:test'
import assert from 'node:assert/strict'

// 领域模型与核心节点
import { writeScript } from '../../ai/agents/scriptWriter.ts'
import { critiqueScript } from '../../ai/agents/scriptCritic.ts'
import { scriptToStory } from '../nodes/storyboardNode.ts'
import { compileVisualPlans } from '../nodes/visualizerNode.ts'
import { ExecutorEngine } from '../nodes/executorNode.ts'
import { buildJianyingDraft } from '../../export/jianyingDraft.ts'
import type { VideoProvider, VideoGenRequest, PollResult } from '../../media/types.ts'

test('全量电商链路端到端自动化测试：从商品导入、AI剧本、分镜编译、渲染调度到剪映草稿导出与重置', async () => {
  // 1. 商品定义
  const productTitle = '机能防泼水数码收纳包'
  const sellingPoints = [
    '高密度军规防泼水面料',
    '内衬精密风琴分区，一目了然',
    '抗震抗摔，差旅通勤一包搞定',
  ]

  // 2. 剧本扩写与审核 Agent
  const script = await writeScript({
    productTitle,
    sellingPoints,
    templateId: 't1_pain_opening',
    tokenConfig: null, // 验证 0-key 纯本地启发式降级
  })

  assert.equal(script.beats.length, 6, '剧本必须包含 6 个拍点')
  assert.equal(script.beats[0].role, 'hook', '首镜必须为 hook')
  assert.equal(script.beats[5].role, 'cta', '末镜必须为 cta')

  const review = await critiqueScript(script, null)
  assert.ok(review.score >= 80, `审稿打分应在合理区间，实际得分: ${review.score}`)
  assert.ok(review.strengths.length > 0, '应给出卖点优势')

  // 3. 剧本编译为 6 镜 Story
  const story = scriptToStory(script, productTitle)
  assert.equal(story.shots.length, 6, 'Story 必须包含 6 个镜头')
  assert.equal(story.shots[0].order, 1)
  assert.equal(story.shots[5].order, 6)
  story.shots.forEach((shot) => {
    assert.ok(shot.line && shot.line.length > 0, `镜头 ${shot.id} 必须包含有效口播台词`)
    assert.ok(shot.durationSec >= 2 && shot.durationSec <= 5, '单镜时长应在 2~5 秒')
  })

  // 4. 分镜编译为 6 张视觉卡（VisualPlans）
  const visualPlans = compileVisualPlans(story, script, '/presets/tech_bag.jpg')
  assert.equal(visualPlans.length, 6, '必须编译出 6 个 VisualPlan')
  assert.equal(visualPlans[0].ratio, '9:16', '必须为 9:16 竖屏')
  assert.equal(visualPlans[0].kind, 'image2video', '带主图时应标记为图生视频')
  assert.ok(visualPlans[0].positive.includes('9:16 vertical commercial video'), '提示词应包含竖屏商业关键词')

  // 5. 调度引擎排队与出片执行
  const mockProvider: VideoProvider = {
    id: 'mock',
    async submit(req: VideoGenRequest) {
      return { taskId: `task_${req.shotId}` }
    },
    async poll(): Promise<PollResult> {
      return { status: 'succeeded', progress: 100 }
    },
    async getAsset(taskId: string) {
      return {
        shotId: taskId.replace('task_', ''),
        url: `blob:http://localhost/asset_${taskId}.webm`,
        durationSec: 3,
      }
    },
    estimateCost() {
      return '¥0'
    },
  }

  const engine = new ExecutorEngine(mockProvider)
  const initialJobs = await engine.enqueueShots(visualPlans, 'mock')
  assert.equal(initialJobs.length, 6, '必须为 6 个镜头成功创建任务')

  // 等待调度队列串行执行完毕
  let allDone = false
  for (let i = 0; i < 40; i++) {
    const list = engine.getJobs()
    if (list.length === 6 && list.every((j) => j.status === 'succeeded')) {
      allDone = true
      break
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  assert.ok(allDone, '所有 6 镜任务均应在串行队列中成功出片 (status = succeeded)')
  const completedJobs = engine.getJobs()

  // 6. 剪映草稿工程导出验证
  const jianyingDraft = buildJianyingDraft({
    story,
    visualPlans,
    jobs: completedJobs,
    projectTitle: '收纳包带货工程',
  })

  assert.equal(jianyingDraft.canvas_config.width, 1080)
  assert.equal(jianyingDraft.canvas_config.height, 1920)
  assert.equal(jianyingDraft.canvas_config.ratio, '9:16')
  assert.equal(jianyingDraft.materials.videos.length, 6, '必须打包 6 个视频素材')
  assert.equal(jianyingDraft.materials.texts.length, 6, '必须打包 6 个字幕素材')
  assert.equal(jianyingDraft.tracks.length, 2, '包含视频主轨道和字幕轨道')
  assert.equal(jianyingDraft.tracks[0].segments.length, 6)
  assert.equal(jianyingDraft.tracks[1].segments.length, 6)

  // 7. 新建下一条带货视频（重置全链路状态）
  engine.loadJobs([])
  assert.equal(engine.getJobs().length, 0, '新建下一个爆款视频时，调度队列任务必须被彻底清空')
})
