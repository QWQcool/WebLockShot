/**
 * 记忆系统 API（CANVAS_PLAN.md §9 S3 / §5.3）
 *
 * 能力：
 * - GET    /api/memory/records → { records: [...] }（全量回流记录）
 * - POST   /api/memory/records → 单条录入（结构对齐前端 FeedbackRecordSchema，最小校验）
 * - DELETE /api/memory/records → 清空（返回清除条数）
 * - 开关：完全对齐 tts.mjs 能力位模式 —— 存储模式为 sqlite（WLS_STORAGE=sqlite）时启用，
 *   非 sqlite 返回 501；/healthz 能力位 memory: 'sqlite' | 'off'
 *
 * 存储：复用既有 storage kv 抽象（单 key 存 JSON 数组；sqlite 模式即持久化，
 * memory 模式本就 501 不写）。记录 id/createdAt 由服务端补齐，客户端值不信任。
 */

export const MEMORY_RECORDS_KEY = 'memory-records'
/** 单条记录字段长度上限（防滥用；与前端 zod 契约量级对齐） */
export const MEMORY_TEXT_MAX = 200
export const MEMORY_RECORDS_MAX = 10000

/**
 * 最小结构校验（记录结构与前端 src/domain/feedback.ts FeedbackRecordSchema 同形状）。
 * zod 契约收口在前端读取侧；服务端只做形状/范围/类型防线。
 * @returns {{ ok: true, record: object } | { ok: false, error: string }}
 */
export function validateMemoryRecord(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: '请求体必须是 JSON 对象' }
  }
  const videoTitle = body.videoTitle
  if (typeof videoTitle !== 'string' || !videoTitle.trim()) {
    return { ok: false, error: 'videoTitle 必须是非空字符串' }
  }
  if (videoTitle.length > MEMORY_TEXT_MAX) {
    return { ok: false, error: `videoTitle 超过 ${MEMORY_TEXT_MAX} 字符上限` }
  }
  const templateId = body.templateId
  if (typeof templateId !== 'string' || !templateId.trim()) {
    return { ok: false, error: 'templateId 必须是非空字符串' }
  }
  if (templateId.length > 120) {
    return { ok: false, error: 'templateId 超过 120 字符上限' }
  }
  const hookIndex = body.hookIndex
  if (!Number.isInteger(hookIndex) || hookIndex < 0 || hookIndex > 5) {
    return { ok: false, error: 'hookIndex 必须是 0~5 的整数' }
  }
  for (const key of ['view3sRate', 'completionRate']) {
    const v = body[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      return { ok: false, error: `${key} 必须是 0~1 的数值` }
    }
  }
  const record = {
    videoTitle: videoTitle.trim().slice(0, MEMORY_TEXT_MAX),
    templateId: templateId.trim().slice(0, 120),
    hookIndex,
    view3sRate: body.view3sRate,
    completionRate: body.completionRate,
  }
  if (typeof body.hookType === 'string' && body.hookType.trim()) {
    record.hookType = body.hookType.trim().slice(0, 60)
  }
  if (typeof body.category === 'string' && body.category.trim()) {
    record.category = body.category.trim().slice(0, 60)
  }
  if (body.conversions !== undefined) {
    if (!Number.isInteger(body.conversions) || body.conversions < 0) {
      return { ok: false, error: 'conversions 必须是非负整数' }
    }
    record.conversions = body.conversions
  }
  return { ok: true, record }
}

/** 读取存储中的记录数组（损坏数据按空数组处理并重置，不半渲染） */
function readRecords(storage) {
  const raw = storage.get(MEMORY_RECORDS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch {}
  return []
}

/**
 * 构造 /api/memory/records 处理器（协议层与存储解耦：storage 可注入内存 stub 供单测）。
 * @param {{ enabled: boolean, storage: { get, set, delete, mode }, logger?: object }} opts
 */
export function createMemoryHandler({ enabled, storage, logger }) {
  return async function handleMemory(req, res, urlPath) {
    if (urlPath !== '/api/memory/records') {
      sendJson(res, 404, { error: '未知记忆路由' })
      return
    }
    if (!enabled) {
      sendJson(res, 501, {
        error: '记忆系统未启用。需要伴生服务以 sqlite 存储模式运行（WLS_STORAGE=sqlite）；纯前端模式记忆仅存本地。',
      })
      return
    }

    try {
      if (req.method === 'GET') {
        sendJson(res, 200, { records: readRecords(storage) })
        return
      }

      if (req.method === 'POST') {
        let body
        try {
          body = JSON.parse((await readBody(req)).toString('utf8'))
        } catch (err) {
          const tooLarge = err instanceof Error && err.message === 'body too large'
          sendJson(res, tooLarge ? 413 : 400, {
            error: tooLarge ? '请求体超过上限' : '请求体必须是合法 JSON',
          })
          return
        }
        const check = validateMemoryRecord(body)
        if (!check.ok) {
          sendJson(res, 400, { error: check.error })
          return
        }
        const records = readRecords(storage)
        if (records.length >= MEMORY_RECORDS_MAX) {
          sendJson(res, 429, { error: `记录数已达 ${MEMORY_RECORDS_MAX} 上限，请先清理历史数据` })
          return
        }
        const record = {
          ...check.record,
          id: `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        }
        records.push(record)
        storage.set(MEMORY_RECORDS_KEY, JSON.stringify(records))
        logger?.info?.({ id: record.id }, '[memory] 记录已录入')
        sendJson(res, 200, { ok: true, id: record.id, total: records.length })
        return
      }

      if (req.method === 'DELETE') {
        const records = readRecords(storage)
        storage.set(MEMORY_RECORDS_KEY, JSON.stringify([]))
        logger?.info?.({ cleared: records.length }, '[memory] 记录已清空')
        sendJson(res, 200, { ok: true, cleared: records.length })
        return
      }

      sendJson(res, 405, { error: '仅支持 GET/POST/DELETE' })
    } catch (err) {
      logger?.warn?.({ err: err instanceof Error ? err.message : String(err) }, '[memory] 处理异常')
      if (!res.headersSent) {
        sendJson(res, 500, { error: '记忆 API 内部错误' })
      } else {
        res.end()
      }
    }
  }
}

/** 读取请求体（上限 64KB，记录体量小；超限直接 413） */
function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (err, data) => {
      if (settled) return
      settled = true
      if (err) rejectBody(err)
      else resolveBody(data)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        finish(Object.assign(new Error('body too large'), { status: 413 }))
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(null, Buffer.concat(chunks)))
    req.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))))
  })
}

function sendJson(res, status, payload) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}
