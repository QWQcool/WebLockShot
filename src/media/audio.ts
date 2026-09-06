/**
 * 纯前端 TTS 口播语音合成引擎
 * 基于 Web Speech API (window.speechSynthesis)
 * 环境安全：在 Node.js 单测环境中自动降级，避免崩溃
 */

export type TtsOptions = {
  lang?: string
  pitch?: number
  rate?: number
  onEnd?: () => void
  onError?: (err: unknown) => void
}

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

export function stopTts(): void {
  if (!isTtsSupported()) return
  try {
    window.speechSynthesis.cancel()
  } catch {}
}

/**
 * 智能估算语速：
 * 中文普通话正常语速约 4~5 字/秒。
 * 根据台词字数与镜头预定时长 durationSec 动态计算播放速率 (0.8 ~ 2.0)，确保台词在分镜时间内朗读完毕。
 */
export function calculateSpeechRate(textLength: number, durationSec: number): number {
  if (durationSec <= 0 || textLength <= 0) return 1.0
  const charsPerSec = textLength / durationSec
  // 基准: 4.2 字/秒 对应 rate 1.0
  const rawRate = charsPerSec / 4.2
  // Web Speech API rate 范围通常在 0.5 ~ 2.0，推荐限制在 0.85 ~ 1.8 之间以保证听感自然
  return Math.min(Math.max(Number(rawRate.toFixed(2)), 0.85), 1.8)
}

export function speakShotText(
  text: string,
  durationSec: number,
  options: TtsOptions = {}
): SpeechSynthesisUtterance | null {
  if (!isTtsSupported() || !text || !text.trim()) {
    return null
  }

  stopTts()

  try {
    const cleanText = text.trim()
    const utterance = new window.SpeechSynthesisUtterance(cleanText)
    utterance.lang = options.lang || 'zh-CN'
    utterance.pitch = options.pitch ?? 1.0
    
    // 如果外部没有显式指定 rate，则根据台词长度与分镜时长自适应计算
    utterance.rate = options.rate ?? calculateSpeechRate(cleanText.length, durationSec)

    if (options.onEnd) {
      utterance.onend = () => options.onEnd?.()
    }
    if (options.onError) {
      utterance.onerror = (e) => options.onError?.(e)
    }

    window.speechSynthesis.speak(utterance)
    return utterance
  } catch (err) {
    console.warn('[WebLockShot TTS] 语音播放异常:', err)
    return null
  }
}

export class VoiceoverEngine {
  private _enabled = true

  get enabled(): boolean {
    return this._enabled
  }

  set enabled(val: boolean) {
    this._enabled = val
    if (!val) {
      stopTts()
    }
  }

  speak(text: string, durationSec: number, options?: TtsOptions) {
    if (!this._enabled) return null
    return speakShotText(text, durationSec, options)
  }

  stop() {
    stopTts()
  }
}

export const voiceoverEngine = new VoiceoverEngine()
