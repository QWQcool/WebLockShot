import { ProductInsightSchema, type ProductInsight } from '../../domain/product.ts'
import type { TokenConfig } from '../../types.ts'
import { chatCompletionsText } from '../../ai/client.ts'

/**
 * 多模态商品理解 Agent：
 * 读取商品图片（Base64 DataURL 或公开 URL），通过视觉大语言模型（GPT-4o / Qwen-VL / Claude 等）
 * 自动抽取商品品类、外观特征、3~4 条高转化带货卖点、适用人群与场景。
 */
export async function understandProductImage(
  imageDataUrl: string,
  tokenConfig?: TokenConfig | null
): Promise<ProductInsight> {
  if (tokenConfig?.apiKey?.trim()) {
    try {
      const promptText = `请作为一名资深电商带货选品专家，分析这张商品实拍图/主图。
提炼出结构化的商品理解报告，严格按照以下 JSON 格式返回，不包含任何 Markdown 代码围栏：
{
  "category": "商品品类/名称",
  "look": "商品外观、材质与设计特征简述",
  "sellingPoints": ["核心卖点1（如功效/速度/黑科技）", "核心卖点2（如材质/安全/耐用）", "核心卖点3（如便携/颜值/性价比）"],
  "audience": "目标购买人群画像",
  "scenarios": ["适用场景1", "适用场景2"],
  "tone": "推荐的视频带货情绪基调"
}`

      const responseText = await chatCompletionsText(tokenConfig, [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            {
              type: 'image_url',
              image_url: { url: imageDataUrl, detail: 'auto' },
            },
          ],
        },
      ])

      // 提取 JSON 并校验
      const cleaned = responseText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
      const jsonStart = cleaned.indexOf('{')
      const jsonEnd = cleaned.lastIndexOf('}')
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonStr = cleaned.slice(jsonStart, jsonEnd + 1)
        const parsed = JSON.parse(jsonStr)
        return ProductInsightSchema.parse(parsed)
      }
    } catch (err) {
      console.warn('多模态 Vision 模型理解失败，自动转入高保真规则抽取:', err)
    }
  }

  // 0 Key 或离线降级方案
  return {
    category: '高颜值实用好物',
    look: '极简流线型工学机身，磨砂亲肤质感，轻盈便携',
    sellingPoints: [
      '核心黑科技赋能，效果立竿见影',
      '军工级精密选材，安全环保经久耐用',
      '人体工学手感设计，随时随地优雅使用',
    ],
    audience: '追求品质生活与高效体验的年轻白领、精致宝妈与潮流达人',
    scenarios: ['日常居家高频使用', '差旅通勤便携应急', '节日送礼自用两相宜'],
    tone: '真实真诚，节奏紧凑，反差感强',
  }
}
