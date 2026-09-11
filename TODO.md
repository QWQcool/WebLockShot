# 待做功能清单（TODO）

> 口径：每条都必须写清 **问题 / 实测证据 / 建议做法 / 验收标准**。
> 「实测证据」指仓库内可复现的脚本输出或实机数据，不接受「我觉得」。
> 修完后按本仓库既有惯例收口：**四门槛（lint / build / 单测 / 实机 E2E）+ 负向验收 + 诚实标注 + commit & push**。

- 状态：P0 = 影响可用性，优先做；P1 = 高价值；P2 = 锦上添花
- 最后更新：2026-09-11

---

## P0 · 移动端 / 触摸适配

**问题**：手机浏览器打开线上站点，画布区基本不可用——顶栏按钮被压成竖排文字，画布大片空白，触摸也无法操作。

**实测证据**（`iPhone 12/13` 视口 390×844，`isMobile + hasTouch`，脚本见下方复现命令）：

| 指标 | 实测值 | 说明 |
|---|---|---|
| `.wls-canvas-topbar` | 390 宽 × **223 高** | 桌面约 60px；按钮被挤成 **42px 宽** → 文字竖排（「＋ 新项目」竖着排） |
| `.wls-canvas-root` | **969 宽** | 视口只有 390 → 画布区被裁掉大半，这是「画布空白」的直接原因 |
| `.wls-chat-dock` | **943 宽**（x=13） | 对话栏严重溢出，只能看到左边一小段 |
| `.wls-minimap` | x=761 | 小地图完全在视口外 |
| tldraw 底部工具条 | x=266 / 宽 438 | 超出视口 |
| **横向溢出元素** | **129 个** | 右边界超出视口 2px 以上 |
| `document.scrollWidth` | 390 | 溢出**被裁剪**而非可滚动 → 用户既看不到也**滑不过去** |
| 触摸目标尺寸 | 全部 ≥24px | 这一项没问题（问题在布局溢出，不在目标太小） |

**根因**：`src/canvas/canvas.css` 里只有一条 `@media (max-width: 768px)`，处理了节点面板（改横排）与对话栏宽度，
**完全没有处理顶栏**；顶栏按钮不换行也不收缩，把整行撑到 900+ px，而画布容器继承了同一行的宽度。

**建议做法**（按顺序）：
1. 顶栏在窄屏改为**可横向滚动的一行**或**两行折叠 + 「更多」抽屉**；按钮加 `flex-shrink: 0` + `white-space: nowrap`，禁止文字竖排；
2. `.wls-canvas-root` / `.wls-chat-dock` 加 `min-width: 0` 与 `width: 100%`，杜绝被子元素撑宽；
3. 画布容器改 `overflow: hidden` + 明确的 `width: 100%`，并在窄屏把节点面板改为**底部横向滚动条**（现在是 `max-height: 9.5rem` 的换行块，占掉 152px 高度）；
4. 小地图 / 快捷键提示在窄屏默认隐藏（`@media (max-width: 768px) { .wls-minimap, .wls-shortcuts-toggle { display: none } }`）；
5. 触摸：核对 tldraw 的手势（单指平移 / 双指缩放）在 `hasTouch` 下可用；对话栏输入时避免软键盘顶起后画布高度塌陷（`100dvh` 而非 `100vh`）。

**验收标准**：
- 390×844 与 360×640 两个视口下：**横向溢出元素 = 0**、`document.scrollWidth === innerWidth`；
- 顶栏高度 ≤ 120px，无竖排文字；
- 画布区可见面积 ≥ 视口高度的 45%；
- 触摸可完成「进入画布 → 对话栏发一句话 → 节点落位」；
- 新增 `npm run e2e:mobile`（Playwright `isMobile + hasTouch`）纳入 CI，并做**负向验收**（还原旧 CSS 应立刻红）。

**复现命令**（本次实测用的探针，可直接搬成正式套件）：
```bash
# 390×844 + isMobile + hasTouch，量测溢出元素数 / 关键容器宽度 / 触摸目标
node scripts/e2e-mobile.mjs        # 待创建（可先复用本次探针逻辑）
```

---

## P1 · 节点执行历史面板（可回看的运行日志）

**问题**：节点跑过什么、耗时多久、失败原因是什么，现在只能看节点内的即时反馈；一旦刷新或点了别的节点，信息就没了。
排查「为什么这次出片失败」只能靠翻控制台。

**现状证据**：数据其实**都已经在**——`src/director/executor.ts`（串行队列 + 重试）、
`src/domain/wallet.ts`（冻结/核销/退款事务）、`src/domain/__tests__/feedback.test.ts` 覆盖的回流记录；
缺的是**可视化回看**这一层。

**建议做法**（参考 n8n / Dify / Langflow 的执行历史）：
1. 新增 `RunRecord` 结构：`{ id, nodeId, kind, startedAt, endedAt, status, cost, error, outputRef }`，
   由 ExecutorEngine 在每个节点动作前后落一条（**单一收口**，不要在 UI 层各自记）；
2. 存储复用现有 IndexedDB 层（`src/persist/`），滚动保留最近 N 条（例如 200 条）+ 手动清空；
3. UI：画布右下或顶栏加「🕘 运行历史」入口，抽屉式列表；每条可点开看输入/输出摘要与失败原因；
4. 与钱包打通：历史里直接显示该次消耗的灵感币与是否发生退款（**这是本项目独有的信息**，同类工具没有）；
5. 诚实标注：演示引擎产生的记录要标注「演示 · 非真实生成」。

**验收标准**：
- 走完一次「脚本 → 分镜 → 出片」，历史面板出现 ≥3 条记录，字段完整（状态/耗时/费用）；
- 制造一次失败（例如断网或伪造 4xx），历史里能看到失败原因，且钱包显示已退款；
- 刷新页面后历史仍在；
- 新增单测（RunRecord 生成/裁剪逻辑）+ E2E 断言（面板可开合 + 记录数递增）；
- 负向验收：去掉落点后 E2E 应失败。

---

## P1 · MCP 工具清单产品化（让外部 Agent 驱动画布）

**问题**：MCP 双向桥接已经做了（`server/mcp.mjs`、`src/canvas/mcpOps.ts`、`docs/mcp.md`），
但**可发现性不足**——外部 Agent（Claude Code / Codex）要接进来，得先读源码才知道有哪些工具、参数是什么。

**现状证据**：
- 已暴露工具 **2 个**：`canvas_read_topology`、`canvas_apply_ops`（`server/mcp.mjs:25`）；
- 端点：`GET /api/mcp/status`、`GET /api/mcp/canvas`、`POST|GET /api/mcp/ops`；
- 操作类型：创建节点 / 创建连线，带 `validateMcpOps` 校验与 `filterNewOps` 去重；
- 未安装 MCP SDK 时如实降级为 `mcp:off` + 501 指引（这条要保留）。

**建议做法**：
1. **机器可读工具清单**：把 2 个工具的 JSON Schema 抽成单一数据源，同时供
   `tools/list`（MCP 协议）、`/api/mcp/status` 与文档使用（现在是手写散落）；
2. **复制即用的接入配置**：`docs/mcp.md` 里给出 Claude Code / Codex 的完整配置片段（含本地启动命令与端口），
   让外部 Agent 三步内接上；
3. **扩充工具面**（按价值排序）：
   - `canvas_run_node`（触发指定节点执行，复用 ExecutorEngine + 钱包，**外部 Agent 就能真的让画布出片**）；
   - `canvas_list_nodes`（列出节点与状态，比读全拓扑更省 token）；
   - `canvas_export_draft`（导出剪映草稿 zip，返回下载路径）；
4. **画布内可见**：连接器面板里的 MCP 卡片显示「当前可用工具」清单与在线状态（现在只有一个状态位）；
5. **端到端演示**：录一段「外部 Agent 通过 MCP 在画布上建节点并触发出片」的 GIF 放进 README——
   这是同类开源项目里少见的差异化展示。

**验收标准**：
- `GET /api/mcp/status` 返回的工具清单与 `tools/list` 一致（单一数据源，有单测守护）；
- `docs/mcp.md` 的配置片段可被第三方**照抄即用**（在干净目录实测一次并记录结果）；
- 新增工具的权限边界写清楚（默认只读 / 写操作需显式开启），并保留「未安装 SDK → 501 + 指引」；
- 有端到端实机证据（截图或 GIF）。

---

## P2 · 提示词库多来源导入

**现状**：`src/prompts/library/` 已有结构与钩子路由（`structures.ts` / `hookRouting.ts` + 单测），但**来源单一**（内置）。
**做法**：支持「自定义标准 JSON 来源」（URL 或本地文件导入 + 校验），前端直连并缓存到 IndexedDB；内置来源标注许可与出处。
**验收**：导入一个自定义来源后脚本生成能用到新钩子；非法 JSON 被拒绝并给出原因；有单测 + E2E。

## P2 · 一键部署文档化

**现状**：已有 `Dockerfile` / `.dockerignore` 与 CI 的 `Docker Build Verify`，但 README 没给「一行启动」。
**做法**：补 `docker-compose.yml` + README 三行说明（`git clone` → `docker compose up -d` → 打开 `localhost:3000`）。
**验收**：在干净环境实测一次并记录；README 的「快速开始」里可见。

## P2 · 画布节点插件化（暂缓，先不做）

参考 `infinite-canvas` 的远程插件 + TS SDK。**暂缓理由**：在没有用户之前，生态类投入回报极低；
当前 9 类节点已覆盖主链路，先把 P0/P1 做扎实。留作长期方向。

---

## 已在 README「已知限制」中记录、暂不单列

- `image`（图像生成）节点未实现（占位 + 如实标注）；
- 3D 动作预设 8 个，「挥手 / 转身」在内置动画库中无对应片段（如实替代、不伪造）；
- `editorPageToCanvasDraft` 边提取为 O(n²)（节点规模大时落盘变慢，建议改 Map 索引）；
- Skill 市场全量渲染 100 项（1340 个 DOM 节点），未做虚拟列表；
- tldraw 为商业许可：当前免费 trial **2026-12-20 到期**，`npm run e2e:prod` 会在剩余 ≤30 天时告警；
- PWA 为 `registerType: 'prompt'`（刻意选择：自动更新会打断进行中的生成任务）。

---

## 附：新会话如何启动

把下面这段直接贴进新会话即可（`TODO.md` 已包含全部背景与验收标准，新会话无需重读长历史）：

```text
仓库：c:\Users\v_chchsli\Desktop\WebLockShot（GitHub: QWQcool/WebLockShot）
任务：按 TODO.md 的待做清单推进，从 P0 开始。

工作约定（本仓库既有惯例，必须遵守）：
1. 每条任务都要先复现/取证，再改代码；不接受「我觉得」。
2. 收口门槛：npm run lint（0 errors）、npm run build、npm run test:node、npm run e2e（17 步）
   —— 涉及部署形态时还要跑 npm run e2e:basepath / e2e:prod。
3. 每个修复都要做**负向验收**：把 bug 还原回去，确认新增的测试真的会红。
4. 保持「诚实标注」口径：未实现的能力界面里要如实写「未实现」，不摆样例数据、不伪造评分。
5. 不引入绕过第三方许可校验 / 去水印的任何手段（见 NOTICE）。
6. 改完 commit + push 到 main，并确认 CI（Deploy GitHub Pages / Docker Build Verify）双绿。

本轮先做：P0 移动端 / 触摸适配（TODO.md 里有完整实测数据与验收标准，
390×844 视口下当前有 129 个元素横向溢出、顶栏高 223px、画布容器宽 969px）。
建议顺手把它固化成 npm run e2e:mobile 并纳入 CI。
```
