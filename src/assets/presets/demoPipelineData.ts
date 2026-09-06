import type { Script } from '../../domain/script.ts'
import type { Story } from '../../types.ts'
import type { VisualPlan } from '../../domain/sellVisual.ts'
import type { ShotJob } from '../../domain/shotJob.ts'
import type { CriticReviewResult } from '../../ai/agents/scriptCritic.ts'
import { hairDryerImg } from './index.ts'
import { scriptToStory } from '../../director/nodes/storyboardNode.ts'
import { compileVisualPlans } from '../../director/nodes/visualizerNode.ts'

export const DEMO_SCRIPT: Script = {
  logline: '高速负离子静音电吹风 11万转速干抚平毛躁带货剧本',
  templateId: 't1_pain_opening',
  ctaLine: '今天直播间首发特惠，下方小黄车立即领券抢购，手慢无！',
  lengthTargetSec: 20,
  beats: [
    {
      order: 1,
      role: 'hook',
      goal: '前3秒黄金留人，制造强烈反差与好奇心',
      action: '镜头大特写：主播面部神情严肃，拿起高速负离子静音电吹风直对镜头，强劲气流瞬间吹飞水雾，视觉冲击直接拉满',
      caption: '普通吹风机吹10分钟头发焦枯？换它3分钟彻底干透！',
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: '吹头发还在像烤肉一样忍受高温？今天教你3分钟吹干且柔顺的黑科技！',
      },
    },
    {
      order: 2,
      role: 'pain',
      goal: '深挖用户传统痛点，唤醒换新焦虑',
      action: '镜头快速切换：左侧传统劣质吹风机烘烤下毛躁分叉的发丝特写，干枯无光泽，画面呈现灰暗压抑色调',
      caption: '高温干枯、炸毛分叉、早起吹头浪费20分钟！',
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: '每次洗完头吹半小时，发尾又枯又脆还炸毛，真正伤发的就是传统电热丝！',
      },
    },
    {
      order: 3,
      role: 'reveal',
      goal: '本命救星正式亮相，高级感拉满',
      action: '中景推向特写：高速负离子静音电吹风置于高级大理石台面，环形极光氛围灯渐亮，机身泛出深空灰金属冷冽光泽',
      caption: '高速负离子静音电吹风：11万转高速马达，3分钟速干！',
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: '看这里！这就是11万转速干黑科技——高速负离子静音电吹风！',
      },
    },
    {
      order: 4,
      role: 'demo',
      goal: '微距展现核心卖点，硬核功能眼见为实',
      action: '超微距特写：高速马达精密叶轮飞速旋转，2亿级负离子随低温强风喷涌而出，湿漉漉的发丝在风柱中如丝缎般瞬间柔顺服帖',
      caption: '2亿级高浓度负离子，57℃恒温绝不伤发！',
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: '2亿级高浓度负离子抚平毛躁，智能恒温算法每秒控温100次，绝不烫头皮！',
      },
    },
    {
      order: 5,
      role: 'proof',
      goal: '强力信任背书，彻底打消最后顾虑',
      action: '分屏对比：左侧传统吹风机梳头卡顿扯断，右侧使用本产品后一梳到底，丝般顺滑，并展示专业沙龙级质检报告认证章',
      caption: '沙龙造型师力荐，权威机构检测抚平毛躁率98.6%',
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: '顶级沙龙造型师联名力荐，用过一次你就再也回不去以前的笨重吹风机！',
      },
    },
    {
      order: 6,
      role: 'cta',
      goal: '制造紧迫感，强促限时锁单',
      action: '主播将高速负离子静音电吹风与精美旅行收纳盒推向镜头前，屏幕下方浮现“限时半价券/赠顺发梳”高亮倒计时徽章',
      caption: '首发直降立省100元！前50名再赠定制磁吸风嘴',
      audio: {
        kind: 'vo',
        speaker: '主播',
        text: '今天直播间首发特惠，下方小黄车立即领券抢购，手慢无！',
      },
    },
  ],
}

export const DEMO_CRITIC: CriticReviewResult = {
  score: 96,
  passed: true,
  summary: '剧本节奏紧凑，前3秒留存反差感鲜明，技术背书过硬，符合抖音快手S级带货脚本标准。',
  strengths: [
    '第 1 镜黄金 3 秒钩子视觉冲击极强，气流吹水雾动态留人率高；',
    '痛点与 11 万转核心技术卖点逻辑承接紧密，反差感鲜明；',
    '第 4 镜 2 亿负离子微距特写与第 5 镜梳发分屏对比提供了无可辩驳的信任背书。',
  ],
  suggestions: [
    '第 6 镜促单话术紧迫感充足，建议在小黄车气泡中进一步提示七天无理由以降低决策门槛。',
  ],
}

export const DEMO_STORY: Story = scriptToStory(DEMO_SCRIPT, '高速负离子静音电吹风')

export const DEMO_VISUAL_PLANS: VisualPlan[] = compileVisualPlans(
  DEMO_STORY,
  DEMO_SCRIPT,
  hairDryerImg
)

export const DEMO_JOBS: ShotJob[] = [
  {
    shotId: 's1',
    taskKey: 'job-demo-s1',
    provider: 'kling',
    status: 'succeeded',
    progress: 100,
    attempt: 1,
    asset: {
      shotId: 's1',
      url: hairDryerImg,
      durationSec: 3,
      sizeBytes: 1024 * 1280,
    },
  },
  {
    shotId: 's2',
    taskKey: 'job-demo-s2',
    provider: 'kling',
    status: 'succeeded',
    progress: 100,
    attempt: 1,
    asset: {
      shotId: 's2',
      url: hairDryerImg,
      durationSec: 4,
      sizeBytes: 1024 * 1450,
    },
  },
  {
    shotId: 's3',
    taskKey: 'job-demo-s3',
    provider: 'comfyui',
    status: 'succeeded',
    progress: 100,
    attempt: 1,
    asset: {
      shotId: 's3',
      url: hairDryerImg,
      durationSec: 3,
      sizeBytes: 1024 * 980,
    },
  },
  {
    shotId: 's4',
    taskKey: 'job-demo-s4',
    provider: 'comfyui',
    status: 'succeeded',
    progress: 100,
    attempt: 1,
    asset: {
      shotId: 's4',
      url: hairDryerImg,
      durationSec: 4,
      sizeBytes: 1024 * 1620,
    },
  },
  {
    shotId: 's5',
    taskKey: 'job-demo-s5',
    provider: 'mock',
    status: 'succeeded',
    progress: 100,
    attempt: 1,
    asset: {
      shotId: 's5',
      url: hairDryerImg,
      durationSec: 3,
      sizeBytes: 1024 * 750,
    },
  },
  {
    shotId: 's6',
    taskKey: 'job-demo-s6',
    provider: 'mock',
    status: 'succeeded',
    progress: 100,
    attempt: 1,
    asset: {
      shotId: 's6',
      url: hairDryerImg,
      durationSec: 3,
      sizeBytes: 1024 * 890,
    },
  },
]
