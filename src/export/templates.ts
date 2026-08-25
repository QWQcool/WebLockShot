import {
  MOTION_LABEL,
  SHOT_SIZE_LABEL,
  type Character,
  type Shot,
  type Story,
} from '../types'

const NEGATIVE =
  '换脸、人物外貌中途改变、横屏 16:9、屏幕内乱码或错别字、突然多出无关人物、卡通滤镜、电影宽银幕黑边、口型表演、与上一镜外貌不一致'

export function buildPromptPack(story: Story): string {
  const theme = story.input.theme ? `主题：${story.input.theme}。` : ''
  const header = [
    `# 竖屏提示词包 · 《${story.title}》`,
    '',
    `> 画幅 **9:16**。${theme}请到可灵或即梦自行粘贴。WEB锁镜只锁镜头，不代出视频。`,
    '',
    '## 角色一致性',
    '后续各镜必须沿用同一外貌锚点，禁止换脸、换服装、换年龄。',
    ...story.characters.map((c) => `- **${c.name}**（${c.id}）：${c.anchor}`),
    '',
    '## 场景锚点',
    `${story.setting.place}。${story.setting.time}。光线：${story.setting.light}。`,
  ].join('\n')

  const shots = story.shots.map((shot) => formatShot(story, shot)).join('\n\n')
  return `${header}\n\n${shots}\n`
}

function formatShot(story: Story, shot: Shot): string {
  const people = peopleOf(story, shot)
  const speaker = speakerOf(story, shot)
  const line = shot.line.trim()
    ? `${speaker ? speaker.name + '：' : ''}${shot.line}`
    : '无对白'
  return [
    `## 镜 ${shot.order} · ${shot.durationSec}s · ${SHOT_SIZE_LABEL[shot.shotSize]} · ${MOTION_LABEL[shot.motionId]}`,
    `**这一镜推进：** ${shot.purpose}`,
    `**主体：** ${people.map((p) => `${p.name}，${p.anchor}`).join('；') || '空镜，不见人脸'}`,
    `**运镜：** ${MOTION_LABEL[shot.motionId]}`,
    `**景别：** ${SHOT_SIZE_LABEL[shot.shotSize]}`,
    `**场景：** ${story.setting.place}。${story.setting.time}。${story.setting.light}。${propHint(shot)}`,
    `**台词（字幕上屏，不要求口型）：** ${line}`,
    `**负面：** ${NEGATIVE}`,
  ].join('\n')
}

function peopleOf(story: Story, shot: Shot): Character[] {
  return shot.cast
    .map((id) => story.characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c))
}

function speakerOf(story: Story, shot: Shot): Character | undefined {
  if (!shot.lineSpeaker) return undefined
  return story.characters.find((c) => c.id === shot.lineSpeaker)
}

function propHint(shot: Shot): string {
  switch (shot.prop) {
    case 'door':
      return '画面右侧是门或电梯门，缝里漏出外面的光。'
    case 'note':
      return '一张字条、通知或工牌作为近景道具出现。'
    case 'lock':
      return '门锁 / 门禁 / 锁屏面板有指示灯。'
    default:
      return ''
  }
}
