/**
 * 极简 ZIP 解包器（零依赖）
 *
 * 支持 store(0) 与 deflate(8) 两种压缩方法——足以处理 WebLockShot 导出的草稿包
 * 及常见工具生成的标准 zip。仅解包常规文件，忽略目录项与加密包。
 */
import { inflateRawSync } from 'node:zlib'

function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      return i
    }
  }
  return -1
}

/**
 * 解析 zip 字节流，返回 [{ name, data: Buffer }]
 */
export function extractZip(buf) {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('不是有效的 zip 文件（未找到 EOCD）')

  const view = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const dv = new DataView(view)
  const entryCount = dv.getUint16(eocd + 10, true)
  let offset = dv.getUint32(eocd + 16, true)

  const entries = []
  for (let i = 0; i < entryCount; i++) {
    if (dv.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`中央目录损坏（条目 ${i}）`)
    }
    const method = dv.getUint16(offset + 10, true)
    const compressedSize = dv.getUint32(offset + 20, true)
    const nameLen = dv.getUint16(offset + 28, true)
    const extraLen = dv.getUint16(offset + 30, true)
    const commentLen = dv.getUint16(offset + 32, true)
    const localOffset = dv.getUint32(offset + 42, true)
    const name = Buffer.from(buf.subarray(offset + 46, offset + 46 + nameLen)).toString('utf8')

    if (!name.endsWith('/')) {
      // 常规文件：读本地头定位数据区
      const localNameLen = dv.getUint16(localOffset + 26, true)
      const localExtraLen = dv.getUint16(localOffset + 28, true)
      const dataStart = localOffset + 30 + localNameLen + localExtraLen
      const raw = buf.subarray(dataStart, dataStart + compressedSize)

      let data
      if (method === 0) {
        data = Buffer.from(raw)
      } else if (method === 8) {
        data = inflateRawSync(raw)
      } else {
        throw new Error(`不支持的压缩方法 ${method}（文件: ${name}）`)
      }
      entries.push({ name, data })
    }

    offset += 46 + nameLen + extraLen + commentLen
  }

  return entries
}

/** 防路径穿越：归档内名称归一化 */
export function safeEntryName(name) {
  const normalized = name.replace(/\\/g, '/')
  const parts = normalized.split('/').filter((p) => p && p !== '.' && p !== '..')
  if (parts.length === 0) return null
  return parts.join('/')
}
