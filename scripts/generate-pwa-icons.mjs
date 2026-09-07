/**
 * PWA 图标生成（一次性工具）：由内置 SVG 渲染 192/512/maskable-512 PNG。
 * 用法：node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public')

const iconSvg = (size, padding = 0) => {
  const inner = size - padding * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${padding ? 0 : size * 0.18}" fill="#0b0f14"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${inner * 0.46}" fill="#22d3ee"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${inner * 0.46}" fill="none" stroke="#67e8f9" stroke-width="${inner * 0.03}"/>
  <text x="${size / 2}" y="${size / 2 + inner * 0.12}" font-family="Arial, sans-serif" font-weight="800" font-size="${inner * 0.3}" fill="#0b0f14" text-anchor="middle">WLS</text>
</svg>`
}

const jobs = [
  { file: 'pwa-192.png', size: 192, padding: 0 },
  { file: 'pwa-512.png', size: 512, padding: 0 },
  // maskable：内容缩进安全区，背景铺满
  { file: 'pwa-maskable-512.png', size: 512, padding: 96 },
]

for (const { file, size, padding } of jobs) {
  await sharp(Buffer.from(iconSvg(size, padding)))
    .resize(size, size)
    .png()
    .toFile(join(PUBLIC, file))
  console.log(`generated public/${file} (${size}x${size}${padding ? ', maskable' : ''})`)
}
