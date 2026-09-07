/**
 * 手写 ZIP 打包器 (Store 模式，零依赖)
 *
 * 仅使用「不压缩存储」(method = 0 store)，纯前端即可把 draft_content.json
 * 与视频/音频素材打成标准 .zip 包，无需引入 JSZip 等第三方依赖。
 * 支持 UTF-8 文件名（General Purpose Flag bit 11）。
 */

export type ZipEntry = {
  /** 归档内路径，使用正斜杠，如 'assets/Shot_1.mp4' */
  name: string
  data: Uint8Array
}

/* eslint-disable no-bitwise */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosTimeDate(date: Date): { dosTime: number; dosDate: number } {
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f)
  const dosDate =
    ((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  return { dosTime, dosDate }
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value & 0xffff, true)
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true)
}

/**
 * 构建 zip 归档（store 模式）。返回完整的 zip 字节流。
 */
export function buildZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const { dosTime, dosDate } = dosTimeDate(now)

  type Prepared = {
    nameBytes: Uint8Array
    data: Uint8Array
    crc: number
    localHeaderOffset: number
  }

  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  const prepared: Prepared[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name.replace(/\\/g, '/'))
    const data = entry.data
    const crc = crc32(data)

    const localHeader = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(localHeader.buffer)
    writeUint32(lv, 0, 0x04034b50) // local file header signature
    writeUint16(lv, 4, 20) // version needed
    writeUint16(lv, 6, 0x0800) // UTF-8 filename flag
    writeUint16(lv, 8, 0) // method: store
    writeUint16(lv, 10, dosTime)
    writeUint16(lv, 12, dosDate)
    writeUint32(lv, 14, crc)
    writeUint32(lv, 18, data.length) // compressed size (store)
    writeUint32(lv, 22, data.length) // uncompressed size
    writeUint16(lv, 26, nameBytes.length)
    writeUint16(lv, 28, 0) // extra length
    localHeader.set(nameBytes, 30)

    prepared.push({ nameBytes, data, crc, localHeaderOffset: offset })
    localParts.push(localHeader, data)
    offset += localHeader.length + data.length
  }

  for (const p of prepared) {
    const centralHeader = new Uint8Array(46 + p.nameBytes.length)
    const cv = new DataView(centralHeader.buffer)
    writeUint32(cv, 0, 0x02014b50) // central directory signature
    writeUint16(cv, 4, 20) // version made by
    writeUint16(cv, 6, 20) // version needed
    writeUint16(cv, 8, 0x0800) // UTF-8 flag
    writeUint16(cv, 10, 0) // method: store
    writeUint16(cv, 12, dosTime)
    writeUint16(cv, 14, dosDate)
    writeUint32(cv, 16, p.crc)
    writeUint32(cv, 20, p.data.length)
    writeUint32(cv, 24, p.data.length)
    writeUint16(cv, 28, p.nameBytes.length)
    writeUint16(cv, 30, 0) // extra
    writeUint16(cv, 32, 0) // comment
    writeUint16(cv, 34, 0) // disk number
    writeUint16(cv, 36, 0) // internal attrs
    writeUint32(cv, 38, 0) // external attrs
    writeUint32(cv, 42, p.localHeaderOffset)
    centralHeader.set(p.nameBytes, 46)
    centralParts.push(centralHeader)
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0)

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  writeUint32(ev, 0, 0x06054b50) // end of central directory
  writeUint16(ev, 4, 0) // disk number
  writeUint16(ev, 6, 0) // central dir disk
  writeUint16(ev, 8, prepared.length)
  writeUint16(ev, 10, prepared.length)
  writeUint32(ev, 12, centralSize)
  writeUint32(ev, 16, offset) // central dir offset
  writeUint16(ev, 20, 0) // comment length

  const total = localParts.reduce((acc, p) => acc + p.length, 0) + centralSize + eocd.length
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of [...localParts, ...centralParts, eocd]) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

export function textEntry(name: string, text: string): ZipEntry {
  return { name, data: new TextEncoder().encode(text) }
}

/** 便捷方法：将 Blob 转为 Uint8Array（浏览器与 Node 20+ 通用） */
export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}
