/**
 * 跨环境安全的预设商品素材解析器
 * 1. 解决 Node.js 单测中不能 import .jpg 的问题 (ERR_UNKNOWN_FILE_EXTENSION)
 * 2. 解决 GitHub Pages 子目录部署 (/WebLockShot/) 下的静态资源 404 路径拼接问题
 */

export function resolveAsset(filename: string): string {
  if (typeof window === 'undefined') {
    return `/presets/${filename}`
  }
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  const cleanBase = base.endsWith('/') ? base : `${base}/`
  return `${cleanBase}presets/${filename}`
}

export const hairDryerImg = resolveAsset('hair_dryer.jpg')
export const clayMaskImg = resolveAsset('clay_mask.jpg')
export const techBagImg = resolveAsset('tech_bag.jpg')

export function getPresetImageByKeyword(titleOrKeyword?: string): string {
  const t = (titleOrKeyword || '').toLowerCase()
  if (t.includes('吹风') || t.includes('发') || t.includes('dryer')) return resolveAsset('hair_dryer.jpg')
  if (t.includes('面膜') || t.includes('泥') || t.includes('mask')) return resolveAsset('clay_mask.jpg')
  if (t.includes('包') || t.includes('收纳') || t.includes('bag')) return resolveAsset('tech_bag.jpg')
  return resolveAsset('hair_dryer.jpg')
}
