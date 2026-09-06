import type { Script, ScriptBeat } from '../../domain/script.ts'
import type { Shot, ShotSize, MotionId, Story, StoryEnvelope } from '../../types.ts'

/**
 * 将带货拍点转化为 Shot 对象的辅助映射器（符合 sell-stage 契约）
 */
export function beatToShot(beat: ScriptBeat): Shot {
  const mappingByOrder: Record<
    number,
    { size: ShotSize; motion: MotionId; fallbackPurpose: string }
  > = {
    1: { size: 'cu', motion: 'push_in', fallbackPurpose: '前3秒吸睛钩子：制造悬念/反差' },
    2: { size: 'ws', motion: 'pan_left', fallbackPurpose: '共情痛点场景：还原翻车尴尬' },
    3: { size: 'cu', motion: 'enter_stage', fallbackPurpose: '核心产品亮相：主角高光特写' },
    4: { size: 'ms', motion: 'follow', fallbackPurpose: '功能实操演示：丝滑使用动作' },
    5: { size: 'ecu', motion: 'pull_out', fallbackPurpose: '品质数据证言：前后效果对比' },
    6: { size: 'cu', motion: 'line_pop', fallbackPurpose: '促单指令CTA：限时特惠抢购' },
  }

  const defaultMeta = mappingByOrder[beat.order] || {
    size: 'cu' as ShotSize,
    motion: 'push_in' as MotionId,
    fallbackPurpose: beat.goal,
  }

  const orderNum = Math.max(1, Math.min(6, beat.order)) as 1 | 2 | 3 | 4 | 5 | 6

  return {
    id: `s${orderNum}`,
    order: orderNum,
    purpose: beat.goal || defaultMeta.fallbackPurpose,
    shotSize: defaultMeta.size,
    motionId: defaultMeta.motion,
    durationSec: 3,
    cast: ['c1'],
    line: beat.audio?.text || beat.action || '',
    lineSpeaker: beat.audio?.speaker || '主播',
    prop: 'none',
  }
}

/**
 * Storyboard Node:
 * 将带货 Script 转化为标准 6 镜 Story 实体（严守 src/types.ts 契约，与原有 ShotStage 完全兼容）
 */
export function scriptToStory(
  script: Script,
  productTitle: string = '热卖爆品'
): Story {
  const envelope: StoryEnvelope = {
    id: `sell_story_${Date.now()}`,
    title: `【带货】${productTitle} - 爆款视频分镜`,
    input: {
      theme: `带货推广：${productTitle}`,
      character: '专业带货主播 / 体验官',
      conflict: '传统方法费时费钱又踩雷，急需高性价比解决方案',
      hook: script.beats[0]?.audio?.text || '反常识爆款开场',
    },
    characters: [
      {
        id: 'c1',
        name: '带货主播',
        color: '#E63946',
        anchor: '身穿简约专业黑T恤的带货主播，面带亲和力微笑',
      },
    ],
    setting: {
      place: '极简带货直播间 / 暖光静物展台',
      time: '开播高光时段',
      light: '明亮柔和专业演播室柔光箱与侧向轮廓光',
    },
  }

  const shots: Shot[] = script.beats.map(beatToShot)

  return {
    ...envelope,
    shots,
  }
}
