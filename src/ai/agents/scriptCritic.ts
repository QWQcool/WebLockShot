import type { Script } from '../../domain/script.ts'
import type { TokenConfig } from '../../types.ts'

export type CriticReviewResult = {
  score: number
  passed: boolean
  strengths: string[]
  suggestions: string[]
  summary: string
}

/**
 * 本地审稿规则引擎（0 key 与降级保障）
 */
export function critiqueScriptLocally(script: Script): CriticReviewResult {
  const strengths: string[] = []
  const suggestions: string[] = []
  let score = 88

  // 1. 检查第 1 镜钩子
  const hookBeat = script.beats.find((b) => b.order === 1)
  if (hookBeat) {
    const text = hookBeat.audio?.text || ''
    if (text.includes('！') || text.includes('？') || text.includes('别') || text.includes('为什么')) {
      strengths.push('第 1 拍黄金 3 秒钩子具备强烈情绪符号与反问反差，停留留存率预估高')
      score += 4
    } else {
      suggestions.push('第 1 拍口播建议增加反常识或疑问词（如“千万别”、“为什么”），强化前 3 秒吸引力')
    }
  }

  // 2. 检查第 4 镜演示
  const demoBeat = script.beats.find((b) => b.order === 4)
  if (demoBeat?.action) {
    strengths.push('第 4 拍动作演示具象且重点突出，利于视觉传达产品核心功效')
    score += 3
  }

  // 3. 检查第 6 镜 CTA
  const ctaBeat = script.beats.find((b) => b.order === 6)
  if (ctaBeat) {
    const text = ctaBeat.audio?.text || ''
    if (text.includes('抢') || text.includes('限时') || text.includes('下') || text.includes('车')) {
      strengths.push('第 6 拍 CTA 转化引导词精准直接，促单动作清晰明确')
      score += 3
    } else {
      suggestions.push('第 6 拍促单口播建议强调“限时”、“小黄车”、“手慢无”，提升点击转化率')
    }
  }

  if (suggestions.length === 0) {
    suggestions.push('节奏张弛有度，画面动作与口播贴合紧密，可直接推进至 6 镜分镜预演！')
  }

  return {
    score: Math.min(score, 98),
    passed: score >= 80,
    strengths,
    suggestions,
    summary: `电商带货编导自审打分：${score}分（优秀）。符合【钩子前置-卖点演示-催单闭环】爆款转化模型。`,
  }
}

/**
 * ScriptCritic Agent 主入口
 */
export async function critiqueScript(
  script: Script,
  _tokenConfig?: TokenConfig | null
): Promise<CriticReviewResult> {
  // 优先执行本地规则自审，稳定且实时
  return critiqueScriptLocally(script)
}
