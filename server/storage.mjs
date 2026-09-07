/**
 * 服务端会话存储层（M1c 预留）。
 *
 * WLS_STORAGE=memory|sqlite 开关，默认 memory = 现状（进程内 Map，不落盘）。
 * sqlite 模式：优先 better-sqlite3（devDependencies，开发/测试环境），
 * 不可用时降级 Node 内置 node:sqlite（>=22.5），再不可用降级 memory 并告警。
 *
 * 存的是 JSON 字符串快照（BackendAdapter rest 模式的 /api/sessions/:id 后端）。
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export function resolveSqlitePath(explicit) {
  if (explicit) return explicit
  return join(ROOT, 'data', 'weblockshot-sessions.sqlite3')
}

function memoryStorage() {
  const map = new Map()
  return {
    mode: 'memory',
    get(id) {
      return map.get(id) ?? null
    },
    set(id, data) {
      map.set(id, data)
    },
    delete(id) {
      map.delete(id)
    },
    close() {},
  }
}

function sqliteStorage(db, variant) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS sessions (' +
      'id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)'
  )
  const upsert = db.prepare(
    'INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  )
  const select = db.prepare('SELECT data FROM sessions WHERE id = ?')
  const del = db.prepare('DELETE FROM sessions WHERE id = ?')
  return {
    mode: variant,
    get(id) {
      const row = select.get(id)
      return row ? row.data : null
    },
    set(id, data) {
      upsert.run(id, data, Date.now())
    },
    delete(id) {
      del.run(id)
    },
    close() {
      try {
        db.close()
      } catch {}
    },
  }
}

export async function createStorage({ mode = 'memory', sqlitePath, logger } = {}) {
  if (mode !== 'sqlite') return memoryStorage()

  const target = resolveSqlitePath(sqlitePath)

  // 1. 优先 better-sqlite3（devDependencies，开发与测试环境可用）
  try {
    const { default: Database } = await import('better-sqlite3')
    if (target !== ':memory:') {
      const { mkdirSync } = await import('node:fs')
      mkdirSync(dirname(target), { recursive: true })
    }
    return sqliteStorage(new Database(target), 'sqlite')
  } catch {
    // 继续降级
  }

  // 2. Node 内置 node:sqlite（>=22.5）
  try {
    const { DatabaseSync } = await import('node:sqlite')
    return sqliteStorage(new DatabaseSync(target), 'sqlite(node:sqlite)')
  } catch {
    // 继续降级
  }

  // 3. 兜底 memory
  logger?.warn?.(
    { storage: 'memory' },
    'sqlite 存储不可用（better-sqlite3 与 node:sqlite 均失败），已降级为 memory 模式'
  )
  return memoryStorage()
}
