import {
  MOTION_LABEL,
  SHOT_SIZE_LABEL,
  type Character,
  type Shot,
  type Story,
} from '../types'

export type PromptDialect = 'kling' | 'jimeng'

const NEGATIVE_KLING =
  '换脸、人物外貌中途改变、横屏 16:9、屏幕内乱码或错别字、突然多出无关人物、卡通滤镜、电影宽银幕黑边、口型表演'

const NEGATIVE_JIMENG =
  '换脸、横屏、文字乱码、多余人物、卡通滤镜、口型同步、与上一镜外貌不一致'

export function buildPromptPack(story: Story, dialect: PromptDialect): string {
  const header =
    dialect === 'kling' ? klingHeader(story) : jimengHeader(story)

  const shots = story.shots
    .map((shot) =>
      dialect === 'kling' ? klingShot(story, shot) : jimengShot(story, shot),
    )
    .join('\n\n')

  return `${header}\n\n${shots}\n`
}

function klingHeader(story: Story): string {
  return [
    `# 可灵提示词包 · 《${story.title}》`,
    '',
    '> 画幅 **9:16**。请到可灵自行粘贴生成。WEB锁镜只锁镜头，不代出视频。',
    '',
    '## 角色一致性',
    '后续各镜必须沿用同一外貌锚点，禁止换脸、换服装、换年龄。',
    ...story.characters.map((c) => `- **${c.name}**（${c.id}）：${c.anchor}`),
    '',
    `## 场景锚点`,
    `${story.setting.place}。${story.setting.time}。光线：${story.setting.light}。`,
  ].join('\n')
}

function jimengHeader(story: Story): string {
  return [
    `# 即梦提示词包 · 《${story.title}》`,
    '',
    '> 竖屏 **9:16**。请到即梦自行粘贴。本文件由当前分镜现算，不是仓库缓存。',
    '',
    '## 人物与场景（每镜沿用）',
    ...story.characters.map((c) => `- ${c.name}：${c.anchor}`),
    `- 场景：${story.setting.place}，${story.setting.time}，${story.setting.light}`,
    '- 风格：写实短剧，手机竖屏，夜间室内，不要漫画、不要电影感宽画幅。',
  ].join('\n')
}

function klingShot(story: Story, shot: Shot): string {
  const people = peopleOf(story, shot)
  const speaker = speakerOf(story, shot)
  return [
    `## 镜 ${shot.order} · ${shot.durationSec}s · ${SHOT_SIZE_LABEL[shot.shotSize]} · ${MOTION_LABEL[shot.motionId]}`,
    `**这一镜推进：** ${shot.purpose}`,
    `**主体：** ${people.map((p) => `${p.name}，${p.anchor}`).join('；') || '空镜，不见人脸'}`,
    `**运镜：** ${MOTION_LABEL[shot.motionId]}`,
    `**景别：** ${SHOT_SIZE_LABEL[shot.shotSize]}`,
    `**场景：** ${story.setting.place}。${story.setting.time}。${story.setting.light}。${propHint(shot)}`,
    `**台词（字幕上屏，不要求口型）：** ${shot.line.trim() ? `${speaker ? speaker.name + '：' : ''}${shot.line}` : '无对白'}`,
    `**负面：** ${NEGATIVE_KLING}`,
  ].join('\n')
}

function jimengShot(story: Story, shot: Shot): string {
  const people = peopleOf(story, shot)
  const speaker = speakerOf(story, shot)
  const who = people.map((p) => `${p.name}（${p.anchor}）`).join('，')
  const line = shot.line.trim()
    ? `画面下方字幕：「${speaker ? speaker.name + '：' : ''}${shot.line}」，不要求口型。`
    : '无字幕。'
  return [
    `## 镜 ${shot.order}`,
    `画面：${story.setting.place}，${story.setting.time}，${story.setting.light}。${propHint(shot)}${who ? `画面中有${who}。` : ''}竖屏 9:16，${SHOT_SIZE_LABEL[shot.shotSize]}，${MOTION_LABEL[shot.motionId]}，时长 ${shot.durationSec} 秒。${line}`,
    `这一镜要完成：${shot.purpose}`,
    `避免：${NEGATIVE_JIMENG}`,
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
      return '画面右侧是防盗门，门缝漏出楼道光。'
    case 'note':
      return '一张手写字条从门缝推进来。'
    case 'lock':
      return '电子门锁面板有指示灯。'
    default:
      return ''
  }
}
