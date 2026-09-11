/**
 * D4 连接器 API（CANVAS_PLAN.md §6.3 / §9 D4）
 *
 * 能力（协议层 mock，**不引 `@modelcontextprotocol/sdk`、不接真实第三方**）：
 * - GET  /api/connectors            → { mode, connectors: [...] }（目录 + 就绪态）
 * - POST /api/connectors/:id/auth   → 授权回调占位（未接入如实 501）
 * - POST /api/connectors/:id/run    → 执行占位（未接入如实 501）
 * - /healthz 能力位 connectors: 'interface' | 'ready'（D8 可选依赖接入后切 ready）
 *
 * 诚实红线：本期任何连接器都**没有真实功能**；路由返回的 `configured` 恒为 false，
 * status 恒为 'interface'（或 D8 的 'ready'），绝不伪造「已连接 / 已同步」。
 *
 * 目录与前端 src/canvas/connectors.ts 的 RECOMMENDED_CONNECTORS 保持一致（同 7 个 id），
 * 由两侧单测分别钉住，避免静默漂移。
 */

/** 官方推荐连接器目录（id 与前端一致；图6 七卡片位） */
export const CONNECTOR_CATALOG = [
  { id: 'notion', name: 'Notion', category: '效率办公', description: '整合页面、数据源与团队知识库内容' },
  { id: 'tencent-docs', name: '腾讯文档', category: '效率办公', description: '访问和管理在线文档、表格与文件' },
  { id: 'airtable', name: 'Airtable', category: '效率办公', description: '管理表格、字段与记录' },
  { id: 'linear', name: 'Linear', category: '开发工具', description: '管理 Issue、项目与开发计划' },
  { id: 'github', name: 'GitHub', category: '开发工具', description: '访问和管理仓库、Issue 与拉取请求' },
  { id: 'resend', name: 'Resend', category: '效率办公', description: '发送邮件、管理联系人与营销广播' },
  { id: 'brevo', name: 'Brevo', category: '营销推广', description: '发送邮件和短信，管理联系人与营销活动' },
]

export const CONNECTOR_IDS = CONNECTOR_CATALOG.map((c) => c.id)

/** 未接入时的统一诚实说明 */
export const CONNECTOR_INTERFACE_DETAIL =
  '接口就绪 · 未接入（协议层 mock；未安装 @modelcontextprotocol/sdk）'

/**
 * 构造 /api/connectors 处理器。
 * @param {{ mode?: 'interface' | 'ready', logger?: object }} opts
 *   mode 默认 'interface'（D4 现状）；D8 检测到 SDK 后传 'ready'。
 */
export function createConnectorsHandler({
  mode = 'interface',
  logger,
  githubToken,
  fetchImpl,
} = {}) {
  const token = typeof githubToken === 'string' && githubToken.trim() ? githubToken.trim() : null
  const doFetch = fetchImpl || ((...args) => fetch(...args))

  const listPayload = () => ({
    mode,
    connectors: CONNECTOR_CATALOG.map((c) => ({
      ...c,
      // D8：GitHub 为标杆连接器，配置了 PAT 即如实标注「已配置凭据」（仍未接入前 configured=false）
      configured: c.id === 'github' ? Boolean(token) : false,
      status: mode === 'ready' ? 'ready' : 'interface',
      ...(mode === 'ready' ? {} : { detail: CONNECTOR_INTERFACE_DETAIL }),
    })),
  })

  /** 正向标杆连接器：GitHub 拉取 Issue（REST，PAT 由伴生服务侧持有，绝不进前端存储） */
  const runGithub = async (req, res) => {
    if (!token) {
      sendJson(res, 401, {
        ok: false,
        mode,
        connectorId: 'github',
        error:
          'GitHub 连接器未授权：请在伴生服务侧配置 WLS_GITHUB_TOKEN（Personal Access Token）后重启。凭据只存服务端，不落前端。',
      })
      return
    }
    let body = {}
    try {
      body = JSON.parse((await readBody(req)).toString('utf8'))
    } catch {
      body = {}
    }
    const op = typeof body.op === 'string' ? body.op : 'list-issues'
    if (op !== 'list-issues') {
      sendJson(res, 400, { ok: false, error: `不支持的 GitHub 操作：${op}（当前仅 list-issues）` })
      return
    }
    const repo = typeof body.repo === 'string' ? body.repo.trim() : ''
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      sendJson(res, 400, { ok: false, error: 'repo 必须形如 owner/name' })
      return
    }
    try {
      const r = await doFetch(
        `https://api.github.com/repos/${repo}/issues?state=open&per_page=10`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'weblockshot-companion',
          },
        }
      )
      if (!r.ok) {
        sendJson(res, 502, { ok: false, error: `GitHub API 返回 ${r.status}（凭据或仓库权限可能有误）` })
        return
      }
      const data = await r.json()
      const items = (Array.isArray(data) ? data : []).map((it) => ({
        number: it?.number,
        title: typeof it?.title === 'string' ? it.title.slice(0, 200) : '',
        url: typeof it?.html_url === 'string' ? it.html_url : '',
      }))
      logger?.info?.({ repo, count: items.length }, '[connectors] GitHub Issue 拉取成功')
      sendJson(res, 200, { ok: true, connectorId: 'github', op, repo, items })
    } catch (err) {
      sendJson(res, 502, {
        ok: false,
        error: `GitHub 请求失败：${err instanceof Error ? err.message : '未知错误'}`,
      })
    }
  }

  return async function handleConnectors(req, res, urlPath) {
    if (urlPath === '/api/connectors') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: '仅支持 GET' })
        return
      }
      sendJson(res, 200, listPayload())
      return
    }

    // /api/connectors/:id/auth | /api/connectors/:id/run
    const m = /^\/api\/connectors\/([^/]+)\/(auth|run)$/.exec(urlPath)
    if (m) {
      const id = decodeURIComponent(m[1])
      const action = m[2]
      const entry = CONNECTOR_CATALOG.find((c) => c.id === id)
      if (!entry) {
        sendJson(res, 404, { error: `未知连接器：${id}` })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: '仅支持 POST' })
        return
      }
      // D8 正向标杆连接器：GitHub 拉取 Issue（仅在 MCP SDK 已装 = ready 态开放）
      if (id === 'github' && action === 'run' && mode === 'ready') {
        await runGithub(req, res)
        return
      }
      logger?.info?.({ id, action, mode }, '[connectors] 占位路由被调用（无真实功能）')
      sendJson(res, 501, {
        ok: false,
        mode,
        connectorId: id,
        action,
        error:
          action === 'auth'
            ? `「${entry.name}」授权回调未接入：本期仅接口 + 协议层 mock，未接真实第三方。`
            : `「${entry.name}」执行未接入：本期仅接口 + 协议层 mock，无真实功能可用。`,
      })
      return
    }

    sendJson(res, 404, { error: '未知连接器路由' })
  }
}

function sendJson(res, status, payload) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** 读取请求体（上限 64KB） */
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
