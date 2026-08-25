import type { TokenConfig } from '../types'

export class TokenClientError extends Error {
  readonly kind: 'config' | 'network' | 'http' | 'empty'

  constructor(kind: TokenClientError['kind'], message: string) {
    super(message)
    this.kind = kind
    this.name = 'TokenClientError'
  }
}

export function completionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  if (base.endsWith('/v1')) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

export function assertTokenConfig(config: TokenConfig): void {
  if (!config.baseUrl.trim()) {
    throw new TokenClientError('config', '还没有填写 API Base URL')
  }
  if (!config.apiKey.trim()) {
    throw new TokenClientError('config', '还没有填写 API Key。密钥只存在本标签页，不会写入仓库')
  }
  if (!config.model.trim()) {
    throw new TokenClientError('config', '还没有填写模型名')
  }
}

type ChatMessage = { role: 'system' | 'user'; content: string }

export async function chatCompletionsText(
  config: TokenConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  assertTokenConfig(config)
  const url = completionsUrl(config.baseUrl)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        temperature: 0.7,
        messages,
      }),
      signal,
    })
  } catch {
    throw new TokenClientError(
      'network',
      '无法连到该 API。若在浏览器里跨域失败，请换 OpenRouter 或硅基流动等允许 CORS 的端点',
    )
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const hint = body.slice(0, 180).replace(/\s+/g, ' ')
    throw new TokenClientError(
      'http',
      `接口返回 ${response.status}${hint ? `：${hint}` : ''}`,
    )
  }

  const data: unknown = await response.json().catch(() => null)
  const text = pickContent(data)
  if (!text) {
    throw new TokenClientError('empty', '模型没有返回文本内容')
  }
  return text
}

function pickContent(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const choices = (data as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const message = (choices[0] as { message?: { content?: unknown } }).message
  const content = message?.content
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part === 'object' && part && 'text' in part) {
          return String((part as { text: unknown }).text)
        }
        return ''
      })
      .join('')
    return joined.trim() ? joined : null
  }
  return null
}
