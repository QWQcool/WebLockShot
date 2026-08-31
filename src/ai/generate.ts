import {
  clearGenerateSession,
  writeGenerateSession,
  writeLastGoodStory,
  type GenerateSession,
} from '../persist'
import type { Shot, Story, TokenConfig } from '../types'
import { chatCompletionsText } from './client'
import {
  envelopeSystemPrompt,
  envelopeUserPrompt,
  nextShotUserPrompt,
  redoShotSystemPrompt,
} from './prompts'
import { parseModelText, parseShotJson, parseStoryEnvelope } from './schema'

export async function runSequentialGenerate(args: {
  token: TokenConfig
  session: GenerateSession
  signal?: AbortSignal
  onSession: (session: GenerateSession) => void
  onProgress: (label: string) => void
}): Promise<Story> {
  let session = args.session

  if (!session.envelope) {
    args.onProgress('正在锁定角色与场景…')
    const text = await chatCompletionsText(
      args.token,
      [
        { role: 'system', content: envelopeSystemPrompt() },
        { role: 'user', content: envelopeUserPrompt(session.input) },
      ],
      args.signal,
    )
    const parsed = parseModelText(text, (raw) =>
      parseStoryEnvelope(raw, { minCharacters: 2 }),
    )
    if (!parsed.ok) {
      throw new Error(`故事外壳不合格：${parsed.error}。未完成会话已保存，可继续。`)
    }
    session = { ...session, envelope: parsed.value }
    writeGenerateSession(session)
    args.onSession(session)
  }

  const envelope = session.envelope
  if (!envelope) {
    throw new Error('内部错误：缺少故事外壳。未完成会话已保存，可继续。')
  }
  const charIds = new Set(envelope.characters.map((c) => c.id))

  while (session.shots.length < 6) {
    const order = (session.shots.length + 1) as 1 | 2 | 3 | 4 | 5 | 6
    args.onProgress(`正在生成第 ${order} 镜（已保存 ${session.shots.length}/6）`)
    const text = await chatCompletionsText(
      args.token,
      [
        { role: 'system', content: redoShotSystemPrompt() },
        { role: 'user', content: nextShotUserPrompt(envelope, session.shots, order) },
      ],
      args.signal,
    )
    const parsed = parseModelText(text, (raw) => parseShotJson(raw, charIds))
    if (!parsed.ok) {
      throw new Error(`第 ${order} 镜不合格：${parsed.error}。已保存 ${session.shots.length}/6 镜，可继续。`)
    }
    const shot: Shot = { ...parsed.value, order }
    session = { ...session, shots: [...session.shots, shot] }
    writeGenerateSession(session)
    args.onSession(session)
  }

  const story: Story = {
    ...envelope,
    input: session.input,
    shots: session.shots,
  }
  writeLastGoodStory(story)
  clearGenerateSession()
  args.onSession({ ...session, shots: story.shots })
  return story
}
