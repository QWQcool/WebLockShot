import skillMd from '../../.cursor/skills/shot-stage/SKILL.md?raw'
import type { Shot, Story, StoryInput } from '../types'
import { withoutAlts } from '../shotHistory'

export function storySystemPrompt(): string {
  return [
    '你是竖屏短剧的分镜编剧，服务于「出可灵之前的粗剪台」。',
    '只输出一个可 JSON.parse 的对象，不要 Markdown 围栏，不要解释，不要 HTML。',
    '必须遵守下列契约：',
    skillMd,
    '额外：不要输出 alts。characters 至少 2 人。每镜 purpose 必须能单独读懂。钩子必须落在第 6 镜。input.theme 必须填写。',
  ].join('\n\n')
}

export function generateUserPrompt(input: StoryInput): string {
  return [
    '请把下面四项拆成 6 镜 Story JSON（整份 Story，不是数组）。',
    `主题：${input.theme}`,
    `人物：${input.character}`,
    `冲突：${input.conflict}`,
    `钩子：${input.hook}`,
    '竖屏 9:16。每镜 2–5 秒。道具只用 none / door / note / lock。',
  ].join('\n')
}

export function redoShotSystemPrompt(): string {
  return [
    '你只重写短剧粗剪里的【一镜】。',
    '只输出该镜的 Shot 对象（可 JSON.parse），不要包在 story 里，不要 Markdown 围栏，不要 alts。',
    '必须遵守下列契约中的 Shot 词典：',
    skillMd,
    'purpose 必须仍推进同一件事；可以换 motionId、shotSize、line、prop。不要改角色 id。若用户指定了 durationSec，必须用该秒数。',
  ].join('\n\n')
}

export function redoShotUserPrompt(
  story: Story,
  shot: Shot,
  durationSec: number,
): string {
  return [
    storyContext(story),
    `请重写镜 ${shot.id}（order ${shot.order}）。当前 purpose：${shot.purpose}`,
    `durationSec 必须是 ${durationSec}。`,
  ].join('\n')
}

export function reviseShotUserPrompt(
  story: Story,
  shot: Shot,
  note: string,
  durationSec: number,
): string {
  return [
    storyContext(story),
    `请基于已有的镜 ${shot.id}（order ${shot.order}）做修改，不要另起炉灶。当前 purpose：${shot.purpose}`,
    `用户补充（台词 / 运动模板 / 内容）：${note}`,
    `durationSec 必须是 ${durationSec}。`,
  ].join('\n')
}

function storyContext(story: Story): string {
  return [
    `主题：${story.input.theme}`,
    `片名：${story.title}`,
    `人物：${story.input.character}`,
    `冲突：${story.input.conflict}`,
    `钩子：${story.input.hook}`,
    `当前故事 JSON：${JSON.stringify({
      characters: story.characters,
      setting: story.setting,
      shots: story.shots.map((s) => withoutAlts(s)),
    })}`,
  ].join('\n')
}
