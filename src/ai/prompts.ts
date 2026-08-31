import skillMd from '../../.cursor/skills/shot-stage/SKILL.md?raw'
import type { Shot, Story, StoryEnvelope, StoryInput } from '../types'
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

export function envelopeSystemPrompt(): string {
  return [
    '你是竖屏短剧的分镜编剧，服务于「出可灵之前的粗剪台」。',
    '只输出故事外壳：id、title、input、characters、setting。不要 shots，不要 alts，不要 Markdown 围栏，不要 HTML。',
    '必须遵守下列契约中的角色与场景规则：',
    skillMd,
    '额外：characters 至少 2 人。input 必须回写用户给出的主题 / 人物 / 冲突 / 钩子。',
  ].join('\n\n')
}

export function envelopeUserPrompt(input: StoryInput): string {
  return [
    '请只输出 Story 外壳 JSON（不要 shots）。',
    `主题：${input.theme}`,
    `人物：${input.character}`,
    `冲突：${input.conflict}`,
    `钩子：${input.hook}`,
    '竖屏 9:16。先锁定角色外貌锚点和场景，镜头下一步再拆。',
  ].join('\n')
}

export function nextShotUserPrompt(
  envelope: StoryEnvelope,
  shots: Shot[],
  order: 1 | 2 | 3 | 4 | 5 | 6,
): string {
  return [
    `主题：${envelope.input.theme}`,
    `片名：${envelope.title}`,
    `人物：${envelope.input.character}`,
    `冲突：${envelope.input.conflict}`,
    `钩子：${envelope.input.hook}`,
    `故事外壳：${JSON.stringify({
      characters: envelope.characters,
      setting: envelope.setting,
    })}`,
    `已完成镜头：${JSON.stringify(shots.map((s) => withoutAlts(s)))}`,
    `请只输出镜 ${order} 的 Shot 对象。id 建议 "s${order}"，order 必须是 ${order}。`,
    order === 6
      ? '钩子必须落在这一镜。'
      : '不要提前把钩子说完；这一镜只推进到当前结构位置。',
    'durationSec 在 2–5。不要带 alts。',
  ].join('\n')
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
