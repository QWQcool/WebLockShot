import test from 'node:test'
import assert from 'node:assert/strict'
import { extractZip, safeEntryName } from './zip-extract.mjs'
import { buildZip, textEntry } from '../src/export/zip.ts'

test('伴生服务 zip 解包：store 模式往返一致（打包 -> 解包还原）', () => {
  const entries = [
    textEntry('draft_content.json', '{"fps":30,"duration":7000000}'),
    textEntry('draft_meta_info.json', '{"draft_name":"测试草稿"}'),
    textEntry('assets/Shot_1_s1.mp4', 'fake-video-bytes-0123456789abcdef'),
    textEntry('README-使用说明.txt', '解压后放入剪映草稿目录'),
  ]

  const zip = buildZip(entries)
  const extracted = extractZip(Buffer.from(zip))

  assert.equal(extracted.length, 4)
  const byName = new Map(extracted.map((e) => [e.name, e.data.toString('utf8')]))
  assert.equal(byName.get('draft_content.json'), '{"fps":30,"duration":7000000}')
  assert.equal(byName.get('assets/Shot_1_s1.mp4'), 'fake-video-bytes-0123456789abcdef')
  assert.equal(byName.get('README-使用说明.txt'), '解压后放入剪映草稿目录')
})

test('伴生服务 zip 解包：非 zip 输入给出明确错误', () => {
  assert.throws(() => extractZip(Buffer.from('this is not a zip file')), /不是有效的 zip 文件/)
})

test('伴生服务 zip 解包：路径穿越条目被归一化拦截', () => {
  assert.equal(safeEntryName('../../evil.exe'), 'evil.exe')
  assert.equal(safeEntryName('assets/../../x'), 'assets/x')
  assert.equal(safeEntryName('normal/path.txt'), 'normal/path.txt')
  assert.equal(safeEntryName('/'), null)
})
