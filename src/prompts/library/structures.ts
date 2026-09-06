import { z } from 'zod'
import { BEAT_ROLES } from '../../domain/script.ts'

export const BeatSkeletonItemSchema = z.object({
  order: z.number().min(1).max(6),
  role: z.enum(BEAT_ROLES),
  hint: z.string(),
  defaultDurationSec: z.number().min(2).max(5).default(3),
})

export type BeatSkeletonItem = z.infer<typeof BeatSkeletonItemSchema>

export const StructureTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  fit: z.string(),
  beatSkeleton: z.array(BeatSkeletonItemSchema).length(6),
  hookSamples: z.array(z.string()).min(3),
})

export type StructureTemplate = z.infer<typeof StructureTemplateSchema>

export const STRUCTURE_TEMPLATES: StructureTemplate[] = [
  {
    id: 't1_pain_opening',
    name: '痛点提问开场',
    tagline: '反常识问题抓人，层层递进直击刚需',
    fit: '美妆护肤、日用清洁、个护健康、数码配件',
    beatSkeleton: [
      { order: 1, role: 'hook', hint: '反常识/痛点反问，前2秒抓住停留（例如：天天洗脸皮肤却越来越差？）', defaultDurationSec: 3 },
      { order: 2, role: 'pain', hint: '放大日常槽点与焦虑场景，引发共鸣与好奇', defaultDurationSec: 3 },
      { order: 3, role: 'reveal', hint: '救星产品利落登场，主打一招破局', defaultDurationSec: 3 },
      { order: 4, role: 'demo', hint: '特写动作演示核心功能，展示易用与高效', defaultDurationSec: 3 },
      { order: 5, role: 'proof', hint: '前后对比/数据证言/权威背书，消除顾虑', defaultDurationSec: 3 },
      { order: 6, role: 'cta', hint: '限时优惠/赠品加码/下方小黄车指令收尾', defaultDurationSec: 3 },
    ],
    hookSamples: [
      '千万别盲目跟风买，除非你真的受够了……',
      '为什么有人每天做清洁，毛孔却越来越大？原因在这！',
      '如果你也被这个问题困扰了整整三年，花10秒看完这个。',
      '90%的人第一步就做错了，难怪怎么换都没用！',
    ],
  },
  {
    id: 't2_contrast_reveal',
    name: '效果强烈反差',
    tagline: '前后对比冲击眼球，视觉转化率极高',
    fit: '美妆个护、收纳神器、去污清洁、服饰显瘦',
    beatSkeleton: [
      { order: 1, role: 'hook', hint: '视觉反差/惊人结果前置，直接亮出最终变化震撼开场', defaultDurationSec: 3 },
      { order: 2, role: 'pain', hint: '回溯糟糕现状与尴尬痛点，反衬改变之难', defaultDurationSec: 3 },
      { order: 3, role: 'reveal', hint: '掏出秘密武器，交代蜕变的关键主角', defaultDurationSec: 3 },
      { order: 4, role: 'demo', hint: '一抹/一擦/一穿瞬间见效，过程极度舒适解压', defaultDurationSec: 3 },
      { order: 5, role: 'proof', hint: '左右屏/Before-After 硬核对比，细节经得起放大', defaultDurationSec: 3 },
      { order: 6, role: 'cta', hint: '库存告急提示，促成冲动决策与立刻下单', defaultDurationSec: 3 },
    ],
    hookSamples: [
      '用了不到3天，同事居然以为我偷偷换了张脸！',
      '不要眨眼！看我如何把这个灾难现场3秒变新家！',
      '同一件衣服穿出两种身材？差别只在这个小心机。',
      '左边是过去一小时，右边是刚刚30秒，效果自己看！',
    ],
  },
  {
    id: 't3_unboxing_review',
    name: '沉浸开箱测评',
    tagline: '真实视角打消疑虑，适合重品质好物',
    fit: '数码潮玩、家居好物、精致礼品、食品零食',
    beatSkeleton: [
      { order: 1, role: 'hook', hint: '神秘快递/爆款拆箱第一视角，悬念音效与手势', defaultDurationSec: 3 },
      { order: 2, role: 'pain', hint: '吐槽市面同类产品粗制滥造、踩雷不断的心酸史', defaultDurationSec: 3 },
      { order: 3, role: 'reveal', hint: '撕开封条本体亮相，特写做工与越级质感', defaultDurationSec: 3 },
      { order: 4, role: 'demo', hint: '真机实操体验核心卖点，突出声音与触觉细节', defaultDurationSec: 3 },
      { order: 5, role: 'proof', hint: '客观打分/耐久测试，真诚建议适合谁不适合谁', defaultDurationSec: 3 },
      { order: 6, role: 'cta', hint: '粉丝专享福利链接，引导左下角抓紧上车', defaultDurationSec: 3 },
    ],
    hookSamples: [
      '全网吹爆的这个小玩意，到底是不是智商税？我替你们拆了！',
      '等了足足半个月的快递终于到了，开箱瞬间真的惊艳到我！',
      '如果你正准备入手它，先看完这期无滤镜真实测评再决定！',
      '百元出头能做出这种千元质感？今天必须给它上点强度！',
    ],
  },
  {
    id: 't4_story_insert',
    name: '短剧反转植入',
    tagline: '剧情冲突吸睛到底，神转折带货完播率高',
    fit: '职场好物、情侣送礼、母婴辅食、车载应急',
    beatSkeleton: [
      { order: 1, role: 'hook', hint: '3秒微短剧高潮矛盾瞬间展开，谁也不让谁', defaultDurationSec: 3 },
      { order: 2, role: 'pain', hint: '矛盾升级至白热化，尴尬或危机到达临界点', defaultDurationSec: 3 },
      { order: 3, role: 'reveal', hint: '意想不到的神转折！主角从容拿出产品化解危机', defaultDurationSec: 3 },
      { order: 4, role: 'demo', hint: '顺畅融入剧情使用，巧妙展现硬核解决能力', defaultDurationSec: 3 },
      { order: 5, role: 'proof', hint: '对手/对方态度180度大反转，佩服追问哪里买的', defaultDurationSec: 3 },
      { order: 6, role: 'cta', hint: '打破第四面墙对镜头喊话，同款链接手慢无', defaultDurationSec: 3 },
    ],
    hookSamples: [
      '“明天你不用来上班了！”——除非你能在半小时内搞定这个。',
      '结婚纪念日男友居然送我这个？打开后我当场愣住了……',
      '在客户面前差点社死，多亏包里藏了这个救命神器！',
      '当婆婆突然突击检查厨房，我只用了这一招就让她哑口无言。',
    ],
  },
  {
    id: 't5_price_anchor',
    name: '价格锚点爆破',
    tagline: '大牌对比降维打击，极致性价比催单',
    fit: '工厂直发、平替好物、大牌同源、清仓福利',
    beatSkeleton: [
      { order: 1, role: 'hook', hint: '晒出四位数大牌专柜小票，制造价格昂贵心痛感', defaultDurationSec: 3 },
      { order: 2, role: 'pain', hint: '揭秘行业暴利真相：品牌溢价90%，原料其实全一样', defaultDurationSec: 3 },
      { order: 3, role: 'reveal', hint: '亮出来自同代工厂的宝藏平替，用料配方分毫不差', defaultDurationSec: 3 },
      { order: 4, role: 'demo', hint: '双盲测试对比，肉眼和使用感毫无区别', defaultDurationSec: 3 },
      { order: 5, role: 'proof', hint: '公布到手价对比：大牌一折还送运费险包邮到家', defaultDurationSec: 3 },
      { order: 6, role: 'cta', hint: '今天厂家冲量仅限前500单，抢完立即恢复原价', defaultDurationSec: 3 },
    ],
    hookSamples: [
      '答应我！千万别再去专柜花大几百当冤大头了！',
      '同样是原厂供应链，凭什么贴个标就要贵出10倍？',
      '今天品牌方老板不在，这波平替福利直接把价格打到骨折！',
      '一杯奶茶钱就能买到千元大牌体验，真不是在开玩笑！',
    ],
  },
]

/**
 * 钩子与卖点句式库（供 PromptBooster 与 ScriptWriter 自由调配）
 */
export const HOOK_SEEDS = {
  curiosity: [
    '很多人用了三年才知道，这才是它的正确打开方式！',
    '看似平平无奇，实际用过一次就再也回不去了。',
  ],
  urgency: [
    '库存只剩最后几批，手慢真的只能等下个月！',
    '今天拍下的朋友，额外再送全套正品替换装！',
  ],
  contrast: [
    '左边折腾半小时满头大汗，右边轻轻一拉瞬间搞定。',
    '花大价钱踩雷无数次，终于让我挖到了这个本命好物。',
  ],
}
