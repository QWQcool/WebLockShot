/**
 * 跨环境安全的预设商品素材解析器
 * 1. 解决 Node.js 单测中不能 import .jpg 的问题 (ERR_UNKNOWN_FILE_EXTENSION)
 * 2. 解决 GitHub Pages 子目录部署 (/WebLockShot/) 下的静态资源 404 路径拼接问题
 *    （BASE_URL 拼接统一收口到 `../publicUrl.ts`，此处只负责拼 presets/ 前缀）
 */
import { publicUrl } from '../publicUrl.ts'

export function resolveAsset(filename: string): string {
  return publicUrl(`presets/${filename}`)
}

export const hairDryerImg = resolveAsset('hair_dryer.jpg')
export const clayMaskImg = resolveAsset('clay_mask.jpg')
export const techBagImg = resolveAsset('tech_bag.jpg')
export const sneakerImg = resolveAsset('sneaker.svg')
export const foodDessertImg = resolveAsset('food_dessert.svg')
export const diamondRingImg = resolveAsset('diamond_ring.svg')
export const cyberWatchImg = resolveAsset('cyber_watch.svg')
export const silkDressImg = resolveAsset('silk_dress.svg')
export const superCarImg = resolveAsset('super_car.svg')

export function getPresetImageByKeyword(titleOrKeyword?: string): string {
  const t = (titleOrKeyword || '').toLowerCase()
  if (t.includes('吹风') || t.includes('发') || t.includes('dryer')) return hairDryerImg
  if (t.includes('面膜') || t.includes('泥') || t.includes('mask') || t.includes('精华') || t.includes('serum')) return clayMaskImg
  if (t.includes('包') || t.includes('收纳') || t.includes('bag')) return techBagImg
  if (t.includes('鞋') || t.includes('穿搭') || t.includes('sneaker') || t.includes('shoe')) return sneakerImg
  if (t.includes('甜品') || t.includes('巧克力') || t.includes('美食') || t.includes('food') || t.includes('dessert')) return foodDessertImg
  if (t.includes('钻') || t.includes('珠宝') || t.includes('首饰') || t.includes('ring') || t.includes('jewelry')) return diamondRingImg
  if (t.includes('表') || t.includes('机械') || t.includes('watch')) return cyberWatchImg
  if (t.includes('裙') || t.includes('丝绸') || t.includes('dress') || t.includes('silk')) return silkDressImg
  if (t.includes('车') || t.includes('跑车') || t.includes('car')) return superCarImg
  return hairDryerImg
}

export const ALL_PRESET_ASSETS = [
  { id: 'hair_dryer', name: '高速吹风机 (数码)', src: hairDryerImg },
  { id: 'clay_mask', name: '水润精华露 (美妆)', src: clayMaskImg },
  { id: 'tech_bag', name: '防水机能包 (箱包)', src: techBagImg },
  { id: 'sneaker', name: '潮流机能鞋 (潮牌)', src: sneakerImg },
  { id: 'food_dessert', name: '熔岩甜品 (美食)', src: foodDessertImg },
  { id: 'diamond_ring', name: '璀璨钻戒 (珠宝)', src: diamondRingImg },
  { id: 'cyber_watch', name: '机械手表 (腕表)', src: cyberWatchImg },
  { id: 'silk_dress', name: '高定礼服 (服饰)', src: silkDressImg },
  { id: 'super_car', name: '超级跑车 (汽车)', src: superCarImg },
]
