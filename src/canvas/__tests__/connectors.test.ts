import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONNECTOR_CATEGORIES,
  CUSTOM_CONNECTORS_KEY,
  RECOMMENDED_CONNECTORS,
  addCustomConnector,
  buildCustomConnector,
  connectorListResponseSchema,
  customToEntry,
  describeConnectorStatus,
  localCatalogEntries,
  mergeConnectorEntries,
  readCustomConnectors,
  removeCustomConnector,
  validateCustomConnectorInput,
} from '../connectors.ts'

/** 内存 Storage stub（注入式，node 环境无 localStorage） */
function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    _map: map,
  }
}

/* ---------------- 目录 ---------------- */

test('RECOMMENDED_CONNECTORS：7 卡片位 + id 与伴生服务目录一致', () => {
  assert.equal(RECOMMENDED_CONNECTORS.length, 7)
  assert.deepEqual(
    RECOMMENDED_CONNECTORS.map((c) => c.id),
    ['notion', 'tencent-docs', 'airtable', 'linear', 'github', 'resend', 'brevo']
  )
  for (const c of RECOMMENDED_CONNECTORS) {
    assert.ok(CONNECTOR_CATEGORIES.includes(c.category), `${c.id} 分类必须在白名单内`)
    assert.ok(c.glyph.length > 0)
    assert.ok(c.tint.startsWith('#'))
  }
})

test('localCatalogEntries：离线渲染全部如实标注未接入', () => {
  const entries = localCatalogEntries()
  assert.equal(entries.length, 7)
  for (const e of entries) {
    assert.equal(e.status, 'interface')
    assert.equal(e.configured, false)
  }
})

/* ---------------- 自定义连接器校验 ---------------- */

test('validateCustomConnectorInput：合法通过；空白名/超长/非法分类整体拒绝', () => {
  const ok = validateCustomConnectorInput({
    name: '  内部 CRM  ',
    category: '开发工具',
    description: ' 读写客户记录 ',
  })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.input.name, '内部 CRM', 'trim 后落库')
    assert.equal(ok.input.description, '读写客户记录')
  }

  assert.equal(validateCustomConnectorInput({ name: '   ', category: '效率办公', description: '' }).ok, false)
  assert.equal(validateCustomConnectorInput({ name: 123, category: '效率办公', description: '' }).ok, false)
  assert.equal(
    validateCustomConnectorInput({ name: 'x'.repeat(41), category: '效率办公', description: '' }).ok,
    false
  )
  assert.equal(validateCustomConnectorInput({ name: 'ok', category: '不存在分类', description: '' }).ok, false)
  assert.equal(
    validateCustomConnectorInput({ name: 'ok', category: '效率办公', description: 'y'.repeat(121) }).ok,
    false
  )
})

test('buildCustomConnector：id 前缀 cc_ + 字段原样', () => {
  const c = buildCustomConnector({ name: '内部 CRM', category: '开发工具', description: '读写客户记录' }, 1000, 'abc123')
  assert.equal(c.id, 'cc_rs_abc123')
  assert.equal(c.name, '内部 CRM')
  assert.equal(c.category, '开发工具')
  assert.equal(c.createdAt, 1000)
})

/* ---------------- 状态文案 ---------------- */

test('describeConnectorStatus：三态中文口径（不美化）', () => {
  assert.match(describeConnectorStatus('interface'), /未接入/)
  assert.match(describeConnectorStatus('ready'), /已接入/)
  assert.match(describeConnectorStatus('error'), /探测失败/)
})

/* ---------------- 合并视图 ---------------- */

test('mergeConnectorEntries：服务端缺失回退本地官方目录 + 追加自定义', () => {
  const custom = [buildCustomConnector({ name: '内部 CRM', category: '开发工具', description: '' }, 1, 'x')]
  const fallback = mergeConnectorEntries(null, custom)
  assert.equal(fallback.length, 8)
  assert.equal(fallback[0].id, 'notion')
  assert.equal(fallback[7].name, '内部 CRM')
  assert.equal(fallback[7].status, 'interface')

  const remote = [
    { id: 'notion', name: 'Notion', category: '效率办公', description: 'x', configured: false, status: 'interface' as const },
  ]
  const merged = mergeConnectorEntries(remote, [])
  assert.equal(merged.length, 1, '有服务端目录时不叠加本地官方目录')
})

test('customToEntry：自定义连接器同样如实标注未接入', () => {
  const e = customToEntry(buildCustomConnector({ name: '内部 CRM', category: '营销推广', description: 'd' }, 1, 'x'))
  assert.equal(e.status, 'interface')
  assert.equal(e.configured, false)
  assert.equal(e.category, '营销推广')
})

/* ---------------- 存储：读取/追加/删除 ---------------- */

test('readCustomConnectors：空/坏 JSON/非数组 → 空；坏条目跳过；同 id 留最新', () => {
  assert.deepEqual(readCustomConnectors(memStorage()), [])
  assert.deepEqual(readCustomConnectors(memStorage({ [CUSTOM_CONNECTORS_KEY]: '{not json' })), [])
  assert.deepEqual(readCustomConnectors(memStorage({ [CUSTOM_CONNECTORS_KEY]: '"str"' })), [])

  const good = buildCustomConnector({ name: 'A', category: '效率办公', description: '' }, 10, 'a')
  const bad = { id: 'cc_bad', name: '', category: '效率办公', description: '', createdAt: 1 }
  const store = memStorage({ [CUSTOM_CONNECTORS_KEY]: JSON.stringify([bad, good]) })
  const list = readCustomConnectors(store)
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'A')

  // 同 id 留最新（后写覆盖前写）
  const v1 = buildCustomConnector({ name: 'A', category: '效率办公', description: '' }, 10, 'a')
  const v2 = { ...v1, name: 'A2' }
  const store2 = memStorage({ [CUSTOM_CONNECTORS_KEY]: JSON.stringify([v1, v2]) })
  const list2 = readCustomConnectors(store2)
  assert.equal(list2.length, 1)
  assert.equal(list2[0].name, 'A2')
})

test('addCustomConnector：成功追加；同名拒绝；非法输入拒绝', () => {
  const store = memStorage()
  const first = addCustomConnector(store, { name: '内部 CRM', category: '开发工具', description: '' })
  assert.equal(first.ok, true)
  if (first.ok) assert.equal(first.connectors.length, 1)

  const dup = addCustomConnector(store, { name: '内部 CRM', category: '效率办公', description: '' })
  assert.equal(dup.ok, false)
  if (!dup.ok) assert.match(dup.reason, /同名/)

  const invalid = addCustomConnector(store, { name: '  ', category: '效率办公', description: '' })
  assert.equal(invalid.ok, false)

  // 落库可读回
  assert.equal(readCustomConnectors(store).length, 1)
})

test('removeCustomConnector：按 id 删除并持久化', () => {
  const store = memStorage()
  const r = addCustomConnector(store, { name: '内部 CRM', category: '开发工具', description: '' })
  assert.equal(r.ok, true)
  if (!r.ok) return
  const id = r.connectors[0].id
  const after = removeCustomConnector(store, id)
  assert.equal(after.length, 0)
  assert.equal(readCustomConnectors(store).length, 0)
})

/* ---------------- 服务端响应契约 ---------------- */

test('connectorListResponseSchema：合法通过；非法（未知 status/mode）拒绝', () => {
  const valid = connectorListResponseSchema.safeParse({
    mode: 'interface',
    connectors: [
      { id: 'notion', name: 'Notion', category: '效率办公', description: 'd', configured: false, status: 'interface' },
    ],
  })
  assert.equal(valid.success, true)

  assert.equal(
    connectorListResponseSchema.safeParse({ mode: 'weird', connectors: [] }).success,
    false
  )
  assert.equal(
    connectorListResponseSchema.safeParse({
      mode: 'interface',
      connectors: [{ id: 'x', name: 'x', category: 'c', description: '', configured: true, status: 'connected' }],
    }).success,
    false
  )
})
