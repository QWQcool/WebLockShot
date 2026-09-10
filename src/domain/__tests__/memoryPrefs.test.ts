import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MEMORY_ENABLED_STORAGE_KEY,
  readMemoryEnabled,
  writeMemoryEnabled,
} from '../memoryPrefs.ts'

/** 最小内存 Storage 桩（对齐 canvasStore 测试注入模式） */
function stubStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

test('memoryPrefs：缺省（无存储/无键）默认开启', () => {
  assert.equal(readMemoryEnabled(null), true)
  assert.equal(readMemoryEnabled(stubStore()), true)
})

test('memoryPrefs：写入后读取往返（true/false 双向）', () => {
  const store = stubStore()
  writeMemoryEnabled(false, store)
  assert.equal(readMemoryEnabled(store), false)
  writeMemoryEnabled(true, store)
  assert.equal(readMemoryEnabled(store), true)
})

test('memoryPrefs：持久化值为 JSON 布尔（刷新保持语义）', () => {
  const store = stubStore()
  writeMemoryEnabled(false, store)
  assert.equal(store.getItem(MEMORY_ENABLED_STORAGE_KEY), 'false')
})

test('memoryPrefs：脏值（非布尔 JSON / 非法 JSON）按默认开启处理，不抛错', () => {
  assert.equal(readMemoryEnabled(stubStore({ [MEMORY_ENABLED_STORAGE_KEY]: '"yes"' })), true)
  assert.equal(readMemoryEnabled(stubStore({ [MEMORY_ENABLED_STORAGE_KEY]: 'not-json' })), true)
  assert.equal(readMemoryEnabled(stubStore({ [MEMORY_ENABLED_STORAGE_KEY]: 'null' })), true)
})

test('memoryPrefs：显式关闭值在脏数据之外如实读取', () => {
  assert.equal(readMemoryEnabled(stubStore({ [MEMORY_ENABLED_STORAGE_KEY]: 'false' })), false)
})
