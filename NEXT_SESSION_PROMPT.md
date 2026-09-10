# WebLockShot「Agent 创意画布」三期 · 新会话开工提示词（v1.0，2026-09-10）

> 用法：把本文件**全文**复制粘贴到新会话作为第一条消息。你（新会话的主控 Agent）将通宵连续执行 D 线 / T 线 / L-I-M 线 / 收官，直到全部完成。

---

## 你的角色与工作方式

你是 WebLockShot「Agent 创意画布」三期的主控 Agent。工作区：`c:\Users\v_chchsli\Desktop\WebLockShot`（Windows / PowerShell）。用户将长时间不在场，你需要**自主连续推进**，不要频繁请示；遇到阻塞先自行决策（记录假设），只有涉及「改变已拍板决策 / 触碰红线 / 无法自行判断」时才暂停等待。

**流水线（沿用既定，用户已授权）**：每个切片 → 开发 Agent 实现 + 自测四门槛 → 测试 Agent **独立验收** → PASS 后**由你提交并推送**该切片 → 进下一片。禁止开发 Agent 自行 commit/push。切片内小返修可由开发 Agent 直接改，但验收必须由测试 Agent 独立完成（真实鼠标路径实机，不采信开发汇报）。

**四门槛（每片必须全绿）**：`npm run build` 0 错误；`npm test` 全绿（node --test + vitest 18；偶发 server ECONNRESET 抖动重跑即过）；`npm run lint`（oxlint）0 errors（20 条存量 warnings 不算）；Playwright 真实鼠标路径实机冒烟（独立会话防 localStorage 污染）。

## 动手前必读（按顺序）

1. `CANVAS_PLAN.md` —— 唯一规格（**v1.9**，§6 三期、§9 切片表与验收标准、§7 诚实边界、§8 明确不做）。未写进「要做」的一律不做。
2. `git log --oneline -15` 与 `git branch -a` —— 当前状态。
3. 参考稿 `C:\Users\v_chchsli\Desktop\Miroa_Refer\`（图1~图8 + 设计稿 txt）——**三期以 1:1 复刻 Miora 为第一目标**。

## 当前状态（交接快照）

**已完成并推送（main）**：
| 切片 | Commit | 内容 |
|---|---|---|
| C0 | `3fead57` | 对话栏一键收起，修复 tldraw 工具条遮挡 |
| E1 | `da71866` | 记忆图谱（图4：暗色图谱视图 + 采集开关 + 双入口） |
| E2 | `b4c6cd6` | Skill 市场（图5：已安装库 + 启停 + 对话创建/上传/发布本地） |
| D1 | `d46a898` | 3D 运镜台基座（图7：全屏页 + R3F 懒加载 chunk + Quaternius 素体 CC0 + 导入入口 + gizmo + 契约持久化） |
| D2 | `019b846` | 姿势 + 多机位 + 关键帧（SkeletonUtils 多实例蒙皮 + DEF- rig 姿势库 + 机位飞行 + keyframes 入契约） |
| 规划 | `1d1a7c4` 等 | CANVAS_PLAN v1.6→v1.9 |

**D3 半成品（暂停，已入 WIP 分支）**：`wip/d3-director-frames` @ `d90a708`（+1210 行，含 `src/canvas/stage3dFrames.ts`、`FrameThumb.tsx`、`stage3dFrames.test.ts`、`GenerateNodeBody` +136、`StoryboardNodeBody` +180、契约扩展、Studio/Viewport 接线）。
**你的第一步**：评估该 WIP 是否可直接续做（`git checkout wip/d3-director-frames` 后审读代码 + 跑门槛）；若质量可接受则续做收尾，否则从 main 重做 D3（丢弃分支）。**无论哪条路，最终 D3 必须以 main 为基线的干净提交交付**（建议：续做 → 验收 → 在 WIP 分支上完成 → 合并/变基回 main 或 cherry-pick 到 main 后删除分支；二选一并在汇报中说明）。

**测试基线**：node --test **272** 项（含 1 ffmpeg skip）、vitest **18**、oxlint 0 errors/20 warnings（**计数一律以实测为准**，历史汇报出现过 277/234 等口径错误）。

## 剩余工作清单（按此顺序执行）

### D 线（三期主体，图1~图8 复刻）
- **D3 出片衔接（B+D+C 口，自由镜数）**：导出物=机位帧序列（渲染帧图 + 相机参数 + 轨迹结构化数据 + 运镜文字）；**B**=单机位首尾帧+分段描述 → generate 节点「3D 单镜直出」模式（演示引擎 + 诚实标注）；**D**=多机位帧整组 → storyboard 节点「3D 台自由分镜」来源模式（**镜数=机位数 1~12，不伪造不截断**，与 script→6 镜模式互斥 + 来源标注）；**C**=轨迹结构化数据落契约（升级口）。**红线：`src/ai/`、`src/persist.ts`、`src/types.ts` diff 必须为零**（sell 的 6 镜管线不可放宽）；`src/canvas/contract.ts` 的 `storyMetaSchema`/`storyboardMetaPayloadSchema` 不得放宽——D 路径必须**新增独立契约**并存。**技术坑**：WebGL 帧捕获必须开 `preserveDrawingBuffer`（或用同 rAF 捕获 / readPixels），否则 `toDataURL` 拿到全透明空图；tester 会**采样像素验非空白**。帧图引用必须 `idbref://`（assetStore），禁止 `blob:` 入 meta。
- **D4 连接器面板（图6 1:1）**：卡片网格（7 卡片位：Notion/腾讯文档/Airtable/Linear/GitHub/Resend/Brev）+ 自定义添加；伴生服务 `/api/connectors`（list/auth 占位/run，协议 mock，不引 SDK）；`/healthz` `connectors:'interface'`；诚实标注（未接入/纯前端无功能）；三类目标形态文档。
- **D5 画布 UX 对齐**：① 生成引擎画布内**隐式**（引擎配置藏设置，generate 节点不暴露引擎下拉）；② 画布顶栏**移除钱包余额**，改出片前「将消耗 N 灵感币」确认弹层；⑤ **图1 风格开场层**（五类场景 tab + 大输入 + 连接器条，首次进入叠加、之后折叠为现有对话栏）；遗留小修：机位 FOV 表单旁注「编辑后需飞行生效」、记忆图谱小窗口气泡与脚注避让、Skill 市场「发布」双入口统一、B6 编排 system prompt 提取共享常量。
- **D6 图8 六类创作场景卡片**：品牌设计/电商物料/影视文娱/游戏内容/产品 UI-UX/宣传物料；点击预填对话栏 + 一键编排（复用 B6 路由）。
- **D7 3D 台增强**：① 场景预设扩展（程序化 primitive 5~6 套：商品台/影棚/客厅/卧室/户外台阶/展台，代码生成零外部资产）+ 可选 equirect 全景贴图（可用 AI 生成 + 支持用户导入）；② 动作预设（走路循环/挥手/转身，复用 Quaternius 内嵌 45 动画 + three AnimationMixer，不引新重依赖）。
- **D8 MCP 双向（可选依赖）**：默认零依赖不变；伴生服务 try/catch 动态 import 检测 `@modelcontextprotocol/sdk`；未装 = 现状（`connectors:'interface'` + UI 显示安装指引），装了 = `'ready'`。① 正向：接 1 个标杆连接器（GitHub 或 Resend）；② **反向**：伴生服务暴露 MCP server 端点，本地 Agent（Codex/Claude Code 等）可读画布拓扑 + 建节点/连线，画布实时反映。
- **D9 小地图 + 多画布项目**：① 右下角小地图（视口框 + 点击/拖动跳转；tldraw 无内置则自绘 Canvas2D）；② 多 CanvasDoc（新建/切换/重命名/删除 + 每文档独立 key + 既有 `weblockshot.canvas.v1` 自动迁移为默认项目、零数据丢失）；既有能力（Skill/记忆/编排/3D）多项目下不串数据。

### T 线（测试工程化，D9 之后、收官之前）
- **T1 E2E 固化**：`scripts/e2e-canvas.mjs`（Playwright，独立会话）覆盖画布核心链路 + 3D 台 + Skill 市场 + 记忆图谱 + 多画布/小地图；`npm run e2e` 一键跑（Playwright 缺失优雅跳过）。
- **T2 覆盖率基线**：node 侧覆盖率 + 关键纯函数层（contract/stage3dMeta/memorySource/feedback 聚合）≥80% 或如实记录缺口。
- **T3 性能基准**：画布 200/500 节点帧率、记忆图谱 500 记录、3D chunk 冷加载、Skill 市场 100 项。
- **T4 跨浏览器 + a11y**：chromium/webkit 抽查 + axe 扫描（严重项清单）。
- **T5 降级/迁移矩阵**：旧单画布→多画布、无 WebGL、无伴生服务、无 LLM Key、`WLS_STORAGE=sqlite/off`、ComfyUI 离线。

### L / I / M 线（用户新拍板）
- **L1 MIT 开源**：补 `LICENSE`（MIT）+ `package.json` `license: "MIT"` + README 开源声明；**NOTICE/README 如实标注依赖许可**——tldraw 是商业许可（生产无 key 5 秒后停渲染、未授权带水印），Quaternius 模型 CC0，其余依赖列清单。表述准确：**我们代码 MIT，依赖各自许可**。
- **I1 中英双语（只补英文）**：① 设置面板语言切换（中/英，持久化）；② 画布 + 顶栏/设置关键 UI 文案 i18n（默认中文，零回归）；③ `README.en.md` + `docs/HOW_TO_USE.en.md`。
- **M1 模型多样性（海外引擎，契约先行）**：Runway / Google Veo / Luma 中选 2 个按官方 API 契约实现 Provider + 设置面板配置；无 Key 灰态 + 「待真实环境验证」诚实标注；必须走既有 `providerContract` 测试套。

### 收官
README v2.4 能力清单与诚实边界回填（含：server API 直写无 UI 开关约束、单图直出仅演示引擎、tldraw 水印与生产限制、T 线测试结论）；**HOW_TO_USE「一主两分」重构 + Playwright 实机截图**（画布/带货/短剧三线真实操作截图，替换/新增 `docs/screenshots/`，同步 `docs/build_how_to_use_pdf.py` 产物）；英文版文档同步；README hero 改**画布优先**（带货次之、短剧标 legacy 边缘化）；遗留台账清零（小窗口图谱气泡重叠、B6 prompt 双份、发布双入口、data-kind DOM 透传等）。

## 已知坑清单（省你几小时，务必遵守）

1. **tldraw v5**：编程式 `editor.run` **不自动打 history mark**——连续编程操作会并入同段历史，`Ctrl+Z` 连带撤销，必须显式 `editor.markHistoryStoppingPoint()`。
2. **tldraw `T.jsonValue` 不接受 `undefined`**：meta 写 `undefined` 值会抛 ValidationError 崩掉 shape 渲染——无值必须**整键省略**，并剔除上一轮残留键。
3. **WebGL 帧捕获**：未开 `preserveDrawingBuffer` 时 `toDataURL/toBlob` 是**全透明空图**（本项目 Sigma 图表阶段踩过）。
4. **HMR 缓存 lazy chunk**：改 `Stage3DViewport` 等懒加载模块后，dev server 可能仍跑旧代码——**重启 dev server** 再验证。
5. **Playwright 坐标**：用 `getBoundingClientRect` 按窗口实际 CSS 像素算，**勿信截图坐标**（截图可能被缩放，曾造成 ~19% 系统性偏移误判）。
6. **PWA service worker**：生产模式验证前注销 SW + 清 caches，否则误判旧 bundle。
7. **tldraw 控件事件**：节点内交互控件必须**控件级** `stopPropagation`，绝不挂容器级（会吞画线起笔）。
8. **大资产**：只允许 `idbref://`（IndexedDB）或 `http(s)` 入 meta，`blob:` 一律拒（跨刷新失效）。
9. **测试计数**：以实测为准，历史汇报多次出现口径错误。
10. **server 测试抖动**：偶发 ECONNRESET 重跑即过；起 sqlite 实例用唯一 `.tdb` 库名防 WAL 脏数据。
11. **hooks**：必须在所有 early return 之前调用。

## 红线（违反 = 打回重做）

- **sell / drama 零回归**：`src/ai/`、`src/persist.ts`、`src/types.ts` 在 D3 中必须 diff 为零；不改 sell 的 6 镜管线、不改回流看板聚合（`src/domain/feedback.ts` 的 `computeWinRates` 是唯一聚合层）。
- **诚实标注**：演示模式 / 无 Key / 无伴生服务 / 无 WebGL 一律如实标注，绝不伪造数据或结果（Skill 市场不得伪造下载量、记忆图谱空态不得摆样例、未就绪资产不伪造）。
- **不做**：多人实时协作 / 评论 / 画布分享链接（用户说日后再加）；视频时序级局部修复；3D 写实角色定制 / 逐骨骼手调 / 角色训练；MCP 真实第三方授权实现（D8 之外）；在 sell/drama 上做画布化改造；**任何绕过 tldraw 许可校验/去除水印的技术手段**（用户已拍板接受水印）。
- **HOW_TO_USE 此前一直不动，只在收官统一更新**。

## 汇报与提交规范

- 每切片 commit message 风格：`feat(canvas): <切片> …（+测试说明）` / `docs(...)` / `fix(...)`；只提交该切片相关文件（工作区常有测试残留 `.yaml`/`png`/`.tmp`，**不要误提交**；发现的临时残留清理掉）。
- 收官汇报需给用户完整台账：commit 清单 / 每片验收结论 / T 线测试结论 / 遗留项。
- 用户不在场时不要等待确认；每完成一个切片继续下一个，直到全部完成或遇到必须请示的阻塞。

## 现在开始

1. 读 `CANVAS_PLAN.md`（v1.9）+ `git log`，确认理解。
2. 评估 `wip/d3-director-frames` 续做可行性，给出 D3 执行路径（续做 / 重做）并继续推进。
3. 按 D3 → D4 → D5 → D6 → D7 → D8 → D9 → T1~T5 → L1 → I1 → M1 → 收官 的顺序连续执行；每片走「开发 → 自测 → 独立验收 → 提交推送」。
