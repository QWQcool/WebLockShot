import { parseStoryJson, type ParseResult } from './ai/schema'
import type { Story } from './types'

export function serializeStory(story: Story): string {
  return `${JSON.stringify(story, null, 2)}\n`
}

export function filenameForStory(story: Story): string {
  const slug = story.id
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `weblockshot-${slug || 'story'}.json`
}

export function parseStoryFile(text: string): ParseResult<Story> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '文件不是合格 JSON' }
  }
  return parseStoryJson(raw, { allowAlts: true })
}

export function downloadStoryJson(story: Story): void {
  const blob = new Blob([serializeStory(story)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filenameForStory(story)
  a.rel = 'noopener'
  a.click()
  URL.revokeObjectURL(url)
}
