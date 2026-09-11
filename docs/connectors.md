# 连接器（Connectors）—— 目标形态与当前边界

> 归属：CANVAS_PLAN.md §6.3 / §9 D4。画布「🔌 连接器」面板 = Miora 图6 1:1 复刻。

## 1. 当前状态（诚实边界，必读）

| 项 | 现状 |
|---|---|
| 面板形态 | ✅ 已实现（推荐连接器 2 列卡片网格 7 卡片位 + 自定义添加） |
| 伴生服务路由 | ✅ `/api/connectors`（list）+ `/:id/auth`、`/:id/run`（占位，如实 501） |
| `/healthz` 能力位 | `connectors: 'interface'`（未接入）/ `'ready'`（D8 可选依赖接入后） |
| 真实第三方接入 | ⛔ **未接入**。本期不引 `@modelcontextprotocol/sdk`、不接任何真实第三方 |
| 纯前端模式（无伴生服务） | ⛔ 卡片可浏览，但**无功能可用**（面板顶部如实标注） |
| 伪造数据 | ⛔ 零。卡片不显示下载量/连接数，`configured` 恒为 `false`，绝不显示「已连接」 |

**为什么这么做**：连接器的真实效果依赖实际部署伴生服务 + 第三方授权 + 网络可达。本仓库的既定传统是
「接口先行 + 诚实标注」——把协议层与 UI 形态做好、用单测钉住，真实接入留到有真实环境时（可选依赖，见 D8）。

## 2. 目录（图6 七卡片位）

| id | 名称 | 分类 | 说明 |
|---|---|---|---|
| `notion` | Notion | 效率办公 | 整合页面、数据源与团队知识库内容 |
| `tencent-docs` | 腾讯文档 | 效率办公 | 访问和管理在线文档、表格与文件 |
| `airtable` | Airtable | 效率办公 | 管理表格、字段与记录 |
| `linear` | Linear | 开发工具 | 管理 Issue、项目与开发计划 |
| `github` | GitHub | 开发工具 | 访问和管理仓库、Issue 与拉取请求 |
| `resend` | Resend | 效率办公 | 发送邮件、管理联系人与营销广播 |
| `brevo` | Brevo | 营销推广 | 发送邮件和短信，管理联系人与营销活动 |

> 目录定义在前端 `src/canvas/connectors.ts`（`RECOMMENDED_CONNECTORS`）与伴生服务
> `server/connectors.mjs`（`CONNECTOR_CATALOG`），两侧单测分别钉住同一组 id，避免静默漂移。
> 品牌 Logo 不随仓库分发（商标/许可），卡片图标用**首字母字形 + 品牌近似底色**占位。

## 3. 三类目标形态（未来真实接入的设计意图）

### 形态 A：正向只读拉取（第三方 → 画布）

本地 Agent 经连接器把外部系统的数据拉进画布，作为创作输入。

- 典型场景：从 Notion / 腾讯文档 拉取「本期选品清单」→ 自动在画布摆出 `product` 素材节点；
  从 Linear / GitHub 拉取待处理 Issue → 摆出 `brief` 节点（需求描述入 `meta.text`）。
- 契约影响：只写 `product` / `brief` 的既有 meta（`product.title`、`brief.text`），**不新增节点类型**。
- 授权：第三方 PAT / OAuth；密钥只存伴生服务侧，绝不进前端存储。

### 形态 B：正向写回（画布 → 第三方）

画布产物回流到外部系统，形成交付闭环。

- 典型场景：`deliver` 产物（成片/封面）上传到 Airtable 记录行；`script` 产物作为 GitHub Issue
  评论/附件；成片通过 Resend / Brevo 邮件或短信触达。
- 契约影响：读既有产物引用（`asset` 卡 `meta.url`、`generate` 的 `meta.artifacts`），
  大资产先 hydrate 再上传；**不回写业务契约**（外部系统 id 只存连接器侧映射）。
- 授权：API Key / OAuth；写操作需显式确认（对齐「钱包出片前确认」交互）。

### 形态 C：反向驱动（本地 Agent → 画布，MCP Server）

伴生服务暴露 MCP server 端点，本地 Agent（Codex / Claude Code 等）可**读取画布拓扑**并
**执行操作**（建节点 / 连线 / 触发节点执行），画布实时反映。

- 典型场景：在 IDE 里对 Agent 说「把这条需求拆成脚本+分镜节点并连起来」→ 画布自动摆节点。
- 契约影响：复用 `CanvasDoc` / `skillManifest` 的既有校验入口（外部写入必须过 zod，非法整体拒绝）。
- 安全：默认关闭；开启需显式配置 + 本地回环地址；写入操作走与 UI 相同的校验与持久化链路。
- 归属：D8（可选依赖）实现，`connectors` 能力位届时由 `'interface'` 切为 `'ready'`。

## 4. 协议层（当前 mock）

```
GET  /api/connectors              → { mode: 'interface'|'ready', connectors: [...] }
POST /api/connectors/:id/auth     → 501（授权回调占位，如实说明未接入）
POST /api/connectors/:id/run      → 501（执行占位，如实说明未接入）
```

- 未安装 `@modelcontextprotocol/sdk` 时伴生服务零报错（不 import 该包），能力位恒 `'interface'`。
- 单测：`server/connectors.test.mjs`（目录一致性 / 两态渲染 / 占位路由 501 / 未知 id 404 / 405 / 集成挂载）。
