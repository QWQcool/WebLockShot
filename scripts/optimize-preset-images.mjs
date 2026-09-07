/**
 * 预设图片瘦身脚本：public/presets 下 >150KB 的位图统一压缩到 ~100KB 级。
 * 用法：node scripts/optimize-preset-images.mjs
 * 策略：等比缩放至最大宽度 720px（竖图/横图均保持比例），JPEG quality 78 + mozjpeg。
 */
import { readdir, stat, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const TARGET_DIR = fileURLToPath(new URL('../public/presets/', import.meta.url))
const MAX_WIDTH = 720
const QUALITY = 78
const THRESHOLD_BYTES = 150 * 1024 // 仅处理超过 150KB 的图片

async function main() {
  const files = await readdir(TARGET_DIR)
  let saved = 0

  for (const file of files) {
    if (!/\.(jpe?g|png)$/i.test(file)) continue
    const filePath = path.join(TARGET_DIR, file)
    const info = await stat(filePath)
    if (info.size <= THRESHOLD_BYTES) {
      console.log(`跳过 ${file} (${(info.size / 1024).toFixed(1)}KB)`)
      continue
    }

    // 纯内存处理：先读入 Buffer，避免 Windows 文件句柄占用与环境 unlink 限制
    const inputBuffer = await readFile(filePath)
    const optimized = await sharp(inputBuffer)
      .rotate() // 按 EXIF 自动校正
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer()

    await writeFile(filePath, optimized)
    saved += info.size - optimized.length
    console.log(
      `压缩 ${file}: ${(info.size / 1024).toFixed(1)}KB -> ${(optimized.length / 1024).toFixed(1)}KB`
    )
  }

  console.log(`完成，共节省 ${(saved / 1024).toFixed(1)}KB`)
}

main()
