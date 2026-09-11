# 降级 / 迁移矩阵（CANVAS_PLAN.md §9 T5）

> 生成：2026-09-11 03:33:11 · 由 `npm run degrade` 实机实测产出（本文件为生成物，请用脚本刷新而非手改）

## 口径

- 每项在**真实浏览器 + 生产构建 dist** 下跑，独立上下文（隔离 localStorage / IndexedDB）。
- 「无伴生服务」用最小静态文件服务器模拟：`/healthz` 与 `/api/*` 一律 404（真实静态托管形态）。
- 「无 WebGL」用 init script 把 `getContext('webgl*')` 置空模拟。
- 判定：出现崩溃 / 白屏 / 静默失败即 ❌；降级必须**如实标注**，不得伪装可用。

## 矩阵

| 结论 | 场景 | 预期降级表现 | 实测 |
|---|---|---|---|
| ✅ | ① 旧单画布 → 多画布迁移 | 老键 weblockshot.canvas.v1 的 3 节点 1 边复制进默认项目；老键保留；无报错 | 画布节点 3 · 索引 1 项目 · 迁移文档 3 节点/1 边 · 老键保留 true · pageerror 0 |
| ✅ | ② 无 WebGL | 3D 台显示降级提示（不渲染 canvas）；返回后画布编排照常；无报错 | 降级提示「🚫当前浏览器不支持 WebGL，3D 运镜台无法渲染摆台数据已保留；请更换支持 WebGL 的浏览器后重试（诚实降级，」· 视口 canvas 0 个 · 返回后编排：正常 · pageerror 0 |
| ✅ | ③ 无伴生服务（纯静态托管） | 画布全功能本地可用；MCP 徽章不出现；记忆图谱标注「纯前端模式」；连接器面板标注无功能可用；无报错 | 编排 正常 · MCP 徽章 0 个 · 记忆源「纯前端模式 · 仅存本地」· 连接器「纯前端模式 · 无功能可用」· pageerror 0 |
| ✅ | ④ 无 LLM Key | 编排走演示引擎且文案明确标注「非真实 LLM」，不伪装成真实生成 | 提示条：「🧪 演示编排 · 非真实 LLM：已布置 5 个节点、4 条连线↩️ 撤销本次编排✕」 |
| ✅ | ⑤ WLS_STORAGE=memory / sqlite | memory：memory=off、/api/memory/records 501、前端自动降级本地；sqlite：memory=sqlite、接口 200、图谱标注「伴生服务 sqlite」 | memory → storage=memory memory=off API 501；sqlite → storage=sqlite memory=sqlite API 200；图谱标注「伴生服务 sqlite」 |
| ✅ | ⑥ ComfyUI 离线 | 反代返回错误响应（不挂起），伴生服务进程存活；不伪造生成结果 | GET /api/comfyui/system_stats → 502 {"error":"代理请求失败: connect ECONNREFUSED 127.0.0.1:8188"} · healthz 200 |

## 结论

通过 6/6。
全部降级路径优雅、标注诚实、无崩溃无白屏。

## 说明（口径诚实性）

- `WLS_STORAGE` 只支持 `memory`（默认）与 `sqlite` 两个取值；「未启用 sqlite」即 `memory`，
  能力位 `memory: 'off'`，记忆接口 501，前端自动降级为本地 IndexedDB 并如实标注。
- ComfyUI 未运行时，`/api/comfyui` 反代返回上游连接错误（不挂起、不伪造），
  画布内的图像生成 / 局部重绘入口在未配置 Provider 时本就不会被调用。
