import { z } from 'zod'
import { chatCompletionsText } from '../client.ts'
import type { TokenConfig } from '../../types.ts'

export type PolishStyle = 'cinematic' | 'luxury' | 'cyberpunk' | 'minimal' | 'fresh'

export type PolishedPromptResult = {
  polishedPrompt: string
  negativePrompt: string
  cameraMovement: string
  lighting: string
  styleLabel: string
  tags: string[]
}

export const STYLE_OPTIONS: { id: PolishStyle; label: string; desc: string }[] = [
  { id: 'cinematic', label: '🎬 电影写实', desc: '好莱坞胶片质感、景深虚化、大片光影' },
  { id: 'luxury', label: '💎 高端轻奢', desc: '高级冷白、次表面散射、精致反射与微距' },
  { id: 'cyberpunk', label: '⚡ 赛博科技', desc: '冷色调霓虹流光、机械构件、悬浮粒子' },
  { id: 'minimal', label: '🥛 极简纯净', desc: '高调纯白空间、漫反射柔光、通透几何感' },
  { id: 'fresh', label: '🍃 清新自然', desc: '晨光微熹、水汽凝结、自然透亮光泽' },
]

const FALLBACK_EXPANSIONS: Record<
  PolishStyle,
  {
    lighting: string
    camera: string
    negative: string
    tags: string[]
    buildPrompt: (raw: string, variation: number) => string
  }
> = {
  cinematic: {
    lighting: '85mm 电影镜头主光，轮廓逆光勾勒，高动态范围自然柔焦',
    camera: '慢速平滑推镜 (Slow Dolly-in)，45 度低机位向上平移',
    negative: 'low quality, blurry, distorted, jitter, oversaturated, deformed, cartoon, 3d render',
    tags: ['电影级画质', '85mm景深', '胶片颗粒', '升格慢镜头'],
    buildPrompt: (raw, v) =>
      v === 0
        ? `Cinematic film still, 8K ultra realistic. ${raw}. Shot on Arri Alexa with 85mm anamorphic lens, shallow depth of field, delicate volumetric lighting and subtle film grain, dramatic studio lighting highlighting metallic and glossy textures, smooth slow-motion camera dolly-in, photorealistic masterpiece.`
        : `Hollywood cinematic capture. ${raw}. Golden hour warm rim lighting contrasting cool shadows, gentle handheld tracking motion, pristine atmospheric dust particles, pristine specular highlights, highly detailed, photorealistic 8k.`,
  },
  luxury: {
    lighting: '双柔光箱漫反射，边缘轮廓高光，通透水润次表面散射 (SSS)',
    camera: '微距镜头 (Macro 100mm) 极近景对焦，弧形环绕轨道平移',
    negative: 'cheap, dull, noisy, pixelated, plastic, bad reflections, overexposed',
    tags: ['轻奢质感', '次表面散射', '超微距细节', '纯净水光感'],
    buildPrompt: (raw, v) =>
      v === 0
        ? `Ultra-luxury commercial aesthetics. ${raw}. Macro extreme close-up, subsurface scattering with ethereal translucent glow, mirror-like pristine water reflections, soft studio diffusion lighting, platinum and crystal accents, pristine crisp focus, ultra-clean commercial aesthetic, 8K.`
        : `High-end luxury brand visual. ${raw}. Slow elegant 30-degree orbital camera rotation, liquid droplet surface tension, velvety soft shadows, pristine clarity, pristine studio rim highlight, 8k resolution.`,
  },
  cyberpunk: {
    lighting: '深青色 (Teal) 遇玫粉霓虹双色打光，金属边缘反光，暗黑未来氛围',
    camera: '倾斜动态机位 (Dutch Angle)，快速变焦后平滑悬停',
    negative: 'vintage, flat, washed out, retro, dull colors, low contrast',
    tags: ['赛博霓虹', '未来科技', '金属反光', '动态悬浮'],
    buildPrompt: (raw, v) =>
      v === 0
        ? `Cyberpunk futuristic aesthetic, high-tech dark cyan and electric magenta neon illumination. ${raw}. Brushed titanium chassis, glowing laser etched circuits, hovering with subtle anti-gravity micro-tremors, anamorphic blue lens flare, raytracing reflections, Unreal Engine 5 render style, 8K.`
        : `Sci-fi commercial showcase. ${raw}. Dynamic camera orbit with mechanical optical zoom, holographic hud glow, dark wet asphalt backdrop, high contrast specular highlights, hyperdetailed, 8k.`,
  },
  minimal: {
    lighting: '无影纯白空间，大面积漫反射顶光，柔和渐变阴影',
    camera: '正视平视机位，纯水平向右平移 (Smooth Pan Right)',
    negative: 'cluttered, messy, harsh shadows, noisy, oversaturated',
    tags: ['包豪斯极简', '无影柔光', '几何对称', '清爽质朴'],
    buildPrompt: (raw, v) =>
      v === 0
        ? `Minimalist modern design, studio white void background. ${raw}. Pristine soft studio ambient lighting, elegant matte finish with subtle porcelain reflections, perfectly centered composition, gentle smooth right panning camera, pure and serene, 8K.`
        : `Clean architectural minimalism. ${raw}. Subtle architectural shadows, monochromatic neutral tones, slow elegant backward zoom, organic geometry, spotless pristine presentation, 8k resolution.`,
  },
  fresh: {
    lighting: '晨光穿透漫射光，微光斑折射，水滴凝结通透清澈',
    camera: '俯视倾角 45 度缓慢下落，焦点由虚到实拉出',
    negative: 'dark, moody, artificial, heavy shadows, dry, lifeless',
    tags: ['晨曦漫射', '自然生机', '水雾凝露', '清透水灵'],
    buildPrompt: (raw, v) =>
      v === 0
        ? `Fresh organic aesthetics, morning sunlight caustics. ${raw}. Dewdrops glistening on surface with sparkling prismatic refractions, soft natural breeze flutter, rack focus from soft blur to razor-sharp crispness, vibrant natural life, 8K.`
        : `Natural botanic purity. ${raw}. Gentle downward tilting camera, translucent mist particles drifting slowly, glowing golden rim light, organic refreshing sensation, pristine photorealistic 8k.`,
  },
}

/**
 * LLM 润色输出 Schema：废除裸 JSON.parse + as 断言，
 * 结构不合法时安全降级为内置模板，不让脏数据流入 UI。
 */
export const PolishedPromptSchema = z.object({
  polishedPrompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  cameraMovement: z.string().optional(),
  lighting: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export type LLMPolishedRaw = z.infer<typeof PolishedPromptSchema>

/**
 * 用 zod 严格校验 LLM 返回的润色结果；失败返回 null
 */
export function parseLLMPolishedPrompt(raw: string): LLMPolishedRaw | null {
  try {
    const cleaned = raw
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim()
    const json = JSON.parse(cleaned)
    const result = PolishedPromptSchema.safeParse(json)
    if (result.success) {
      return result.data
    }
    console.warn(
      '[PromptPolisher] LLM 润色输出未通过 zod 校验:',
      result.error.issues.slice(0, 5)
    )
    return null
  } catch (err) {
    console.warn('[PromptPolisher] LLM 输出不是合法 JSON:', err)
    return null
  }
}

/**
 * 提示词智能润色 / 扩写 Agent
 * 接收用户自然语言短语，扩写为高质量可灵 / 即梦专业级视频提示词
 */
export async function polishPrompt(params: {
  rawIdea: string
  style: PolishStyle
  variation?: number
  tokenConfig?: TokenConfig | null
}): Promise<PolishedPromptResult> {
  const { rawIdea, style, variation = 0, tokenConfig } = params
  const trimmed = rawIdea.trim() || '高品质商品特写展示'
  const styleConf = FALLBACK_EXPANSIONS[style] || FALLBACK_EXPANSIONS.cinematic
  const currentOption = STYLE_OPTIONS.find((s) => s.id === style)

  // 1. 若配置了 API Key，调用真实大模型扩写
  if (tokenConfig && tokenConfig.apiKey) {
    try {
      const promptSystem = `你是一位顶尖的 AI 视频生成运镜导演与提示词工程专家（精通快手可灵 Kling、字节即梦 Jimeng、Sora）。
请将用户的简单描述扩写为一段顶级质感的 AI 视频生成提示词。
风格诉求：${currentOption?.label} (${currentOption?.desc})。
变体迭代轮次：第 ${variation + 1} 次（如果不是第 1 次，请变换全新机位与视觉角度）。

请输出严格 JSON 格式：
{
  "polishedPrompt": "扩写后的英文+中文高质感提示词（包含主体细节、摄影机焦段、运镜轨迹、光影、材质质感、帧率氛围）",
  "negativePrompt": "该视频对应的负向提示词",
  "cameraMovement": "中文摄影机运镜简述（例如：85mm微距镜头平滑推移+30度环绕）",
  "lighting": "中文光影布光简述（例如：双柔光箱漫反射+轮廓逆光高亮）",
  "tags": ["标签1", "标签2", "标签3", "标签4"]
}`

      const rawJson = await chatCompletionsText(tokenConfig, [
        { role: 'system', content: promptSystem },
        { role: 'user', content: `用户原始需求：${trimmed}` },
      ])

      const parsed = parseLLMPolishedPrompt(rawJson)
      if (parsed) {
        return {
          polishedPrompt: parsed.polishedPrompt,
          negativePrompt: parsed.negativePrompt || styleConf.negative,
          cameraMovement: parsed.cameraMovement || styleConf.camera,
          lighting: parsed.lighting || styleConf.lighting,
          styleLabel: currentOption?.label || '高品质大片',
          tags: parsed.tags && parsed.tags.length > 0 ? parsed.tags : styleConf.tags,
        }
      }
      // 校验失败：落到下方内置模板降级路径
    } catch (err) {
      console.warn('[PromptPolisher] 大模型润色失败，无缝降级为内置高级模版:', err)
    }
  }

  // 2. 0 Key 或离线状态降级：内置工业级工程模板引擎
  return {
    polishedPrompt: styleConf.buildPrompt(trimmed, variation % 2),
    negativePrompt: styleConf.negative,
    cameraMovement: styleConf.camera,
    lighting: styleConf.lighting,
    styleLabel: currentOption?.label || '高品质大片',
    tags: styleConf.tags,
  }
}
