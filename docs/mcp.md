# MCP 双向桥接（D8）—— 可选依赖与反向驱动画布

> 归属：CANVAS_PLAN.md §9 D8。**默认零依赖不变**；装了可选依赖才启用。

## 1. 能力位与依赖

| 状态 | `/healthz` | 行为 |
|---|---|---|
| **未装 `@modelcontextprotocol/sdk`**（默认） | `connectors: 'interface'` · `mcp: 'off'` | 连接器面板如实标注「接口就绪 · 未接入」；`/api/mcp/*` 全部 501 + 安装指引；**服务器零报错** |
| **已装**（`npm i @modelcontextprotocol/sdk` 后重启） | `connectors: 'ready'` · `mcp: 'ready'` | 正向标杆连接器开放（GitHub）；反向驱动画布桥接启用 |

探测实现：`server/mcp.mjs` 的 `detectMcpSdk()` 用 **try/catch 动态 import**（`await import('@modelcontextprotocol/sdk/server/mcp.js')`），
失败即降级为 `false`——**绝不静态 import**，因此未装依赖时服务器启动、测试、运行全链路无影响。

> 本仓库的 CI/测试环境**不安装**该可选依赖，因此默认路径（501 + 指引）是被持续覆盖的路径；
> `ready` 路径通过**注入**（`opts.mcpSdkInstalled` / `opts.mcpSdkImport`）在单测中完整覆盖。

## 2. 正向：标杆连接器（第三方 → 画布）

GitHub（首个标杆连接器，PAT 授权）：

```
POST /api/connectors/github/run
  body: { "op": "list-issues", "repo": "owner/name" }
  → 200 { ok, connectorId, op, repo, items: [{ number, title, url }] }
  → 401 未配置 WLS_GITHUB_TOKEN（诚实说明，凭据只存服务端）
  → 502 GitHub API 非 2xx（如实回传状态码，不伪造结果）
```

- 凭据：环境变量 `WLS_GITHUB_TOKEN`（Personal Access Token），**只存伴生服务侧，绝不落前端存储**；
- 面板交互：连接器面板 → GitHub 卡「📥 拉取 Issue」→ 填 `owner/name` → 展示拉取结果；
- 闭环形态：Issue 标题可作为画布 `brief` 节点的需求来源（Agent 侧串接，见下）。

## 3. 反向：本地 Agent 驱动画布（画布 ← 本地 Agent）

伴生服务暴露画布拓扑镜像与操作队列；画布端（`connectors === 'ready'` 时）每 2 秒同步一次：

```
GET  /api/mcp/status                → { ready, sdkInstalled, tools, guidance }
GET  /api/mcp/canvas                → { version, topology }（Agent 读取画布拓扑）
PUT  /api/mcp/canvas                → 画布端推送拓扑镜像 { nodes, edges }
POST /api/mcp/ops                   → Agent 提交操作批 { ops: [...] }（等价工具 canvas_apply_ops）
GET  /api/mcp/ops?since=N           → 画布端拉取 seq > N 的操作批
```

**MCP 工具（反向驱动可用能力）**

| 工具 | 作用 |
|---|---|
| `canvas_read_topology` | 读取当前画布拓扑（节点 / 连线） |
| `canvas_apply_ops` | 提交建节点 / 连线操作，画布实时反映 |

**操作批格式**

```json
{
  "ops": [
    { "type": "create-node", "id": "n1", "kind": "brief",  "x": 0,   "y": 0,   "meta": { "text": "需求原文" } },
    { "type": "create-node", "id": "n2", "kind": "script", "x": 360, "y": 0 },
    { "type": "create-edge", "id": "e1", "from": "n1", "to": "n2" }
  ]
}
```

- `kind` 白名单 = 前端 `CANVAS_NODE_KINDS`（10 类），服务端与前端两侧单测钉住一致性；
- **整体拒绝不半应用**：缺 id / id 重复 / 类型非法 / 自环 / 端点不存在 / 超批上限（50）→ 400 + 中文原因；
- 画布端二次校验（`validateMcpOps`）+ **id 加盐隔离**（`shape:wls-mcp-<salt>-<rawId>`），
  Agent 重复下发不会重复建节点；已存在的 shape 幂等跳过；
- 应用走**单一 `editor.run` batch**（`markHistoryStoppingPoint`），Ctrl+Z 可整批撤销；
- 非法批被拒时画布内提示条如实显示原因，不静默吞掉。

## 4. 安全与边界

- 桥接端点默认随伴生服务监听地址暴露；公网部署请设置 `WLS_AUTH_TOKEN`（既有鉴权覆盖 `/api/*`）并配合 `WLS_HOST`；
- 服务端**不执行业务语义**（不调用生成引擎、不扣费），只做拓扑镜像与操作校验——生成等重动作仍由画布端用户确认（对齐「出片前费用确认」）；
- 未装依赖时：`/api/mcp/*` 全部 501 + 指引，画布端**完全不启动桥接循环**（行为与 D4 现状零差异）。
