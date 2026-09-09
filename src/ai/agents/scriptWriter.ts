import type { Script, ScriptBeat } from '../../domain/script.ts'
import { ScriptSchema } from '../../domain/script.ts'
import {
  STRUCTURE_TEMPLATES,
  pickTemplateId,
  weightedSampleHook,
  type StructureTemplate,
  type WinRateLookup,
} from '../../prompts/library/structures.ts'
import type { TokenConfig } from '../../types.ts'

export type ScriptWriterInput = {
  productTitle: string
  sellingPoints: string[]
  templateId?: string
  /** 商品种类（如 美妆护肤/数码潮玩），用于按元数据路由结构模板 */
  category?: string
  tokenConfig?: TokenConfig | null
  platform?: string
  /**
   * S3：显式注入钩子胜率查询器（画布 script 节点双模记忆：server records / IndexedDB 均由
   * 调用方经 buildWinRateLookup 构建后传入）。未传时保持既有行为（内部走 IndexedDB），
   * sell 模式零改动。
   */
  hookWinRateLookup?: WinRateLookup
}

/**
 * 规则模板扩写器：0 key 演示模式与无网络时的高质量生成引擎
 */
export function generateLocalScript(
  productTitle: string,
  sellingPoints: string[],
  template: StructureTemplate,
  hookWinRateLookup?: WinRateLookup
): Script {
  const pName = productTitle.trim() || '本命好物'
  const sp1 = sellingPoints[0] || '核心黑科技，瞬间见效'
  const sp2 = sellingPoints[1] || '食品级安全材质，温和不刺激'
  const sp3 = sellingPoints[2] || '高颜值便携设计，随时随地可用'

  // 胜率加权采样钩子（有回流数据时按真实胜率路由，否则用先验均匀分布）
  const hookSample =
    weightedSampleHook(template, hookWinRateLookup).text ||
    `别再瞎买了！关于【${pName}】，这几个真相你必须知道！`

  const beats: ScriptBeat[] = [
    {
      order: 1,
      role: 'hook',
      goal: '前3秒黄金留人，制造强烈反差与好奇心',
      action: `镜头大特写：主播面部神情严肃/手持【${pName}】对比道具，视觉冲击直接拉满`,
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: hookSample.replace('【商品】', pName),
      },
      caption: `🔥 ${hookSample.slice(0, 18)}...`,
      emotion: '震惊 / 严肃反转',
    },
    {
      order: 2,
      role: 'pain',
      goal: '揭示用户痛点与糟糕现状，激起强烈共鸣',
      action: `镜头中景：展示过去遇到问题的尴尬翻车场景，细节狼狈，引发焦虑`,
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: `以前每次遇到这种情况都特别崩溃，又费时间又花冤枉钱，真的受够了！`,
      },
      caption: '❌ 传统做法又贵又踩雷！',
      emotion: '共情 / 痛惜',
    },
    {
      order: 3,
      role: 'reveal',
      goal: '主角光环登场，亮出解决痛点的终极救星',
      action: `镜头推近特写：【${pName}】从暗处推入高光处，金属光泽/精致做工细节毕现`,
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: `直到我挖到了这款【${pName}】，${sp1}，彻底帮我解决了大麻烦！`,
      },
      caption: `✨ 救星来了：${pName}`,
      emotion: '惊喜 / 自信',
    },
    {
      order: 4,
      role: 'demo',
      goal: '实操展示核心功能，演示丝滑解压体验',
      action: `镜头跟随主体：沉浸式演示使用步骤，一触即发，展现核心功效与细节`,
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: `看好了，只要轻轻这么一弄，${sp2}，效果立竿见影！`,
      },
      caption: `💡 实操演示：${sp2.slice(0, 16)}`,
      emotion: '专注 / 解压',
    },
    {
      order: 5,
      role: 'proof',
      goal: '硬核数据证言与前后效果对比，彻底打消购买疑虑',
      action: `分屏对比特写：左侧翻车旧方法 vs 右侧【${pName}】完美结果，品质细节一目了然`,
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: `不管是质检报告还是实际对比，${sp3}，用过的朋友都在回购！`,
      },
      caption: `📊 对比实测：${sp3.slice(0, 16)}`,
      emotion: '坚定 / 可信',
    },
    {
      order: 6,
      role: 'cta',
      goal: '促单指令收尾，引导下方立即抢购',
      action: `镜头特写：主播把【${pName}】稳稳推向镜头，配合限时折扣标签动画上屏`,
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: `今天厂家直发冲销量，左下角小黄车限时特惠，手慢真的无！`,
      },
      caption: '🛒 点击下方链接，限时特惠抢购！',
      emotion: '紧迫 / 热情',
    },
  ]

  return {
    logline: `围绕【${pName}】通过【${template.name}】套路构建的 6 拍高转化带货脚本`,
    templateId: template.id,
    beats,
    ctaLine: '点击左下角小黄车立即抢购，限时特惠手慢无！',
    lengthTargetSec: 18,
  }
}

/**
 * 剥离 LLM 输出中可能包裹的 Markdown 围栏与前后噪音文本
 */
function stripJsonFences(raw: string): string {
  return raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
}

/**
 * 用 zod Schema 严格校验 LLM 返回的脚本体；
 * 非法结构（beats 缺失、role 非法、长度不符等）返回 null 而非 as 断言透传脏数据。
 */
export function parseLLMScript(raw: string): Script | null {
  try {
    const json = JSON.parse(stripJsonFences(raw))
    const result = ScriptSchema.safeParse(json)
    if (result.success) {
      return result.data
    }
    console.warn(
      '[ScriptWriter] LLM 脚本输出未通过 zod 校验:',
      result.error.issues.slice(0, 5)
    )
    return null
  } catch (err) {
    console.warn('[ScriptWriter] LLM 输出不是合法 JSON:', err)
    return null
  }
}

/**
 * ScriptWriter Agent 主入口：支持 LLM 智能扩写与 Local Fallback
 */
export async function writeScript(input: ScriptWriterInput): Promise<Script> {
  // 结构路由优先级：显式 templateId > 品类元数据路由 > 默认第一套
  const routedTemplateId = input.templateId || pickTemplateId(input.category)
  const selectedTemplate =
    STRUCTURE_TEMPLATES.find((t) => t.id === routedTemplateId) ||
    STRUCTURE_TEMPLATES[0]

  // 回流胜率查询器：显式注入优先（S3 画布双模记忆）；未传时走既有 IndexedDB 逻辑
  let hookWinRateLookup = input.hookWinRateLookup
  if (!hookWinRateLookup) {
    try {
      const { getWinRateLookup } = await import('../../domain/feedback.ts')
      hookWinRateLookup = await getWinRateLookup()
    } catch {
      // 测试/非浏览器环境：忽略
    }
  }

  // 如果没有配 key，走纯前端高质量规则扩写器（0 key 演示模式）
  if (!input.tokenConfig?.apiKey) {
    return generateLocalScript(
      input.productTitle,
      input.sellingPoints,
      selectedTemplate,
      hookWinRateLookup
    )
  }

  // 若提供了 TokenConfig，可调用 LLM（校验失败自动重试一次，再失败降级本地引擎）
  try {
    const { chatCompletionsText } = await import('../client.ts')
    const systemPrompt = `你是一名抖音带货爆款编导。请根据用户提供的商品信息和选定的套路模板，扩写出一份严格包含 6 拍（beats）的带货脚本 JSON。
硬约束：
1. 输出必须是合法的 JSON 对象，不加 Markdown 围栏；
2. beats 长度必须为 6，order 为 1~6；
3. 第 1 拍 role 必须为 'hook'（强悬念/痛点前置）；
4. 第 6 拍 role 必须为 'cta'（限时催单）；
5. 其它拍依次为 pain, reveal, demo, proof；
6. 必须包含 logline, templateId, beats, ctaLine, lengthTargetSec 字段。`

    const userMsg = `商品标题：${input.productTitle}
核心卖点：${input.sellingPoints.join('；')}
套路模板：${selectedTemplate.name}（${selectedTemplate.tagline}）`

    // 最多尝试 2 次：第一次输出未通过 Schema 校验时，附上错误要点要求模型修正
    let correctionHint = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await chatCompletionsText(
        input.tokenConfig,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: correctionHint ? `${userMsg}\n\n上一次输出未通过结构校验，请严格修正：${correctionHint}` : userMsg },
        ]
      )

      const script = parseLLMScript(res)
      if (script) {
        return script
      }
      correctionHint = '必须是合法 JSON；beats 恰好 6 个元素且 order 1~6；role 依次为 hook, pain, reveal, demo, proof, cta；字段名与示例完全一致。'
    }
    console.warn('[ScriptWriter] LLM 输出两次校验均失败，降级为本地高质量扩写引擎')
  } catch (err) {
    console.warn('LLM 扩写失败或未提供有效配置，自动降级为本地高质量扩写引擎:', err)
  }

  return generateLocalScript(
    input.productTitle,
    input.sellingPoints,
    selectedTemplate,
    hookWinRateLookup
  )
}
