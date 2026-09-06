import type { Script } from '../../domain/script.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import type { Story } from '../../types.ts'

/**
 * 将 Story 镜头与带货 Script 编译为可供视频生成模型（可灵/即梦/Mock）调用的 VisualPlan
 */
export function compileVisualPlans(
  story: Story,
  script?: Script,
  productImage?: string
): VisualPlan[] {
  return story.shots.map((shot, idx) => {
    const beat = script?.beats[idx]
    const captionText = beat?.caption || shot.line || ''

    // 构建正向视觉提示词：景别 + 主体 + 动作 + 光影质感 + 垂直短视频构图
    const positiveElements = [
      `9:16 vertical commercial video shot`,
      `high-end commercial lighting`,
      `shot size: ${shot.shotSize}`,
      `camera motion: ${shot.motionId}`,
      `scene: ${shot.purpose}`,
      shot.line ? `action/interaction: ${shot.line}` : null,
      captionText ? `commercial overlay style text: "${captionText}"` : null,
      `photorealistic, 8k resolution, crisp detail, cinematic color grading`,
    ].filter(Boolean)

    return {
      shotId: shot.id,
      order: shot.order,
      kind: productImage ? 'image2video' : 'text2video',
      positive: positiveElements.join(', '),
      negative:
        'blurry, deformed, oversaturated, amateur footage, glitch, low quality, artifacts, watermark, logo distortion',
      ratio: '9:16',
      durationSec: shot.durationSec || 3,
      caption: captionText,
      referenceImage: productImage,
    }
  })
}
