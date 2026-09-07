import test from 'node:test'
import assert from 'node:assert/strict'
import { crc32, buildZip, textEntry } from '../zip.ts'

function findEocd(bytes: Uint8Array): number {
  // 从尾部向前找 EOCD 签名 0x06054b50 (PK\x05\x06)
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i
    }
  }
  return -1
}

test('ZIP 工具：CRC32 已知向量校验', () => {
  // 标准测试向量：CRC32("123456789") = 0xCBF43926
  const data = new TextEncoder().encode('123456789')
  assert.equal(crc32(data), 0xcbf43926)
  assert.equal(crc32(new Uint8Array(0)), 0)
})

test('ZIP 工具：store 模式归档结构可被标准解析（本地头/中央目录/EOCD）', () => {
  const entries = [
    textEntry('draft_content.json', '{"fps":30}'),
    textEntry('README-使用说明.txt', '解压后放入剪映草稿目录'),
    textEntry('assets/Shot_1_s1.mp4', 'fake-video-bytes-0123456789'),
  ]

  const zip = buildZip(entries)
  const decoder = new TextDecoder()

  // 1. 本地文件头签名 (PK\x03\x04)
  assert.equal(zip[0], 0x50)
  assert.equal(zip[1], 0x4b)
  assert.equal(zip[2], 0x03)
  assert.equal(zip[3], 0x04)

  // 2. EOCD 与条目计数
  const eocdOffset = findEocd(zip)
  assert.ok(eocdOffset > 0, '必须存在 EOCD 记录')
  const eocdView = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const entryCount = eocdView.getUint16(eocdOffset + 10, true)
  assert.equal(entryCount, 3, 'EOCD 条目数应为 3')

  // 3. 中央目录偏移与尺寸自洽
  const centralOffset = eocdView.getUint32(eocdOffset + 16, true)
  const centralSize = eocdView.getUint32(eocdOffset + 12, true)
  assert.equal(zip[centralOffset], 0x50)
  assert.equal(zip[centralOffset + 1], 0x4b)
  assert.equal(zip[centralOffset + 2], 0x01, '中央目录签名 PK\\x01\\x02')
  assert.equal(zip[centralOffset + 3], 0x02)
  assert.equal(centralOffset + centralSize, eocdOffset, '中央目录应紧贴 EOCD')

  // 4. UTF-8 文件名与内容可还原（store 模式：数据紧随本地头之后）
  const firstLocalNameLen = new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint16(26, true)
  const firstName = decoder.decode(zip.slice(30, 30 + firstLocalNameLen))
  assert.equal(firstName, 'draft_content.json')
  const firstContentStart = 30 + firstLocalNameLen
  const firstContent = decoder.decode(zip.slice(firstContentStart, firstContentStart + '{"fps":30}'.length))
  assert.equal(firstContent, '{"fps":30}')

  // 5. 压缩方法为 store (0)，本地头 CRC 与数据区一致
  const lv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  assert.equal(lv.getUint16(8, true), 0, '必须为 store 不压缩模式')
  const crc = lv.getUint32(14, true)
  assert.equal(crc, crc32(new TextEncoder().encode('{"fps":30}')))
})
