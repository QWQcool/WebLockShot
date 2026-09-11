# WebLockShot 三期 · 新会话开工提示词 v2.0（2026-09-11）

> 全文复制粘贴到新会话作为第一条消息。执行 **T 线 → L1 → I1 → M1 → 收官**。

## 角色与工作方式

你是三期主控 Agent。工作区 `c:\Users\v_chchsli\Desktop\WebLockShot`（Windows/PowerShell）。用户长时间不在场，自主连续推进，不频繁请示；阻塞先自决（记录假设），只有「改变已拍板决策 / 触碰红线 / 无法自判」才暂停。

**流水线**：每切片 → 实现 + 自测四门槛 → 独立验收（真实鼠标路径实机，不采信汇报）→ PASS 后由你 commit/push。

**四门槛**：`npm run build` 0 错误；`npm test` 全绿；`npm run lint` 0 errors（20 条存量 warnings 不算）；Playwright 实机冒烟（独立会话防 localStorage 污染）。

## 动手前必读

1. `CANVAS_PLAN.md`（v1.9）—— 唯一规格：§6 三期、§9 切片表与验收标准、§7 诚实边界、§8 明确不做。
2. `git log --oneline -15` —— 确认 D3~D9 已落地。
3. 参考稿 `C:\Users\v_chchsli\Desktop\Miroa_Refer\`（注意目录名是 **Miroa** 不是 Miora；中文文件名在命令里会乱码，用 `Miora_*N.png` 通配符复制成 ASCII 名再读）。

## 当前状态（2026-09-11 交接快照）

**D 线台账（全部已推送 main）**

| 切片 | Commit |
|---|---|
| C0 对话栏收起 | 3fead57 |
| E1 记忆图谱（图4） | da71866 |
| E2 Skill 市场（图5） | b4c6cd6 |
| D1 3D 运镜台基座（图7） | d46a898 |
| D2 姿势+多机位+关键帧 | 019b846 |
| D3 出片衔接（B 单镜直出 / D 自由分镜 / C 轨迹契约） | d1f3f2d |
| D4 连接器面板（图6） | 4f35bc7 |
| D5 画布 UX 对齐（图1 开场层 + 隐式引擎 + 费用确认） | 3ca101f |
| 默认入口改画布（画布优先） | 5ebf43e |
| D6 创作场景画廊（图8）+ 六张真实配图 | e678c60 / 0684aef |
| D7 3D 台增强（场景预设 + 动作预设）+ 修 D1 摆位缺陷 | 70d0f68 |
| D8 MCP 双向（可选依赖 + 反向驱动画布） | 434fffb |
| D9 小地图 + 多画布项目（含迁移） | a66bb4f |

**测试基线（实测）**：node --test **357**（356 pass + 1 skip）、vitest **18**、oxlint **0 errors / 20 warnings**、build 0 错误。计数一律以实测为准。

## 剩余工作清单（按序执行）

### T1 E2E 固化

scripts/e2e-canvas.mjs（Playwright，独立会话 + 隔离 storage）覆盖：画布核心链路（开场层 → 对话栏演示编排 → 节点落位）、3D 台、Skill 市场、记忆图谱、多画布/小地图；
npm run e2e 一键跑，**Playwright 缺失时优雅跳过（exit 0 + 诚实提示）**。

### T2 覆盖率基线

node 侧覆盖率 + 关键纯函数层（contract / stage3dMeta / stage3dScenes / stage3dAnim / memorySource / feedback 聚合 / projectStore / minimap / mcpOps / sceneGallery）≥80%，或**如实记录缺口**（不伪造覆盖率）。

### T3 性能基准

画布 200/500 节点帧率、记忆图谱 500 记录、3D chunk 冷加载、Skill 市场 100 项；结论写进收官汇报。

### T4 跨浏览器 + a11y

chromium/webkit 抽查 + axe 扫描（输出严重项清单，不强制清零但需如实记录）。

### T5 降级/迁移矩阵

旧单画布→多画布、无 WebGL、无伴生服务、无 LLM Key、WLS_STORAGE=sqlite/off、ComfyUI 离线——逐项实机验证并记录真实表现（D9 的迁移已实测零丢失）。

### L1 MIT 开源

补 LICENSE（MIT）+ package.json license 字段 + README 开源声明。**NOTICE/README 如实标注依赖许可**：tldraw 是商业许可（生产无 key 5 秒后停渲染、未授权带水印）、Quaternius 模型 CC0、其余依赖列清单。表述准确：我们代码 MIT，依赖各自许可。

### I1 中英双语（只补英文）

设置面板语言切换（中/英，持久化）+ 画布与顶栏/设置关键文案 i18n（默认中文，零回归）+ README.en.md 与 docs/HOW_TO_USE.en.md。

### M1 模型多样性（海外引擎，契约先行）

Runway / Google Veo / Luma 中选 2 个，按官方 API 契约实现 Provider + 设置面板配置；无 Key 灰态 + 待真实环境验证 诚实标注；**必须走既有 providerContract 测试套**。

### 收官

README v2.4 能力清单与诚实边界回填（server API 直写无 UI 开关、单图直出仅演示引擎、tldraw 水印与生产限制、T 线结论）；HOW_TO_USE 一主两分重构 + Playwright 实机截图（画布/带货/短剧三线，落 docs/screenshots/，同步 docs/build_how_to_use_pdf.py 产物）；英文版同步；README hero 改**画布优先**（带货次之、短剧标 legacy）；遗留台账清零。

## 已知坑（务必遵守）

1. **tldraw v5**：编程式 editor.run 不自动打 history mark，连续编程操作会并入同段历史，必须显式 markHistoryStoppingPoint()。
2. **tldraw T.jsonValue 不接受 undefined**：meta 写 undefined 会抛 ValidationError 崩 shape 渲染——无值必须**整键删除**（D7 的 updateObject 已实现 patch 中 undefined=删键）。
3. **WebGL 帧捕获**：未开 preserveDrawingBuffer 时 toDataURL 是全透明空图（D3 已开）。
4. **HMR 缓存 lazy chunk**：改 Stage3DViewport / CanvasWorkbench 等懒加载模块后，dev server 可能仍跑旧代码——**重启 dev server**（杀 5173 进程后 npm run dev）再验证。
5. **Playwright 坐标**：用 getBoundingClientRect 按窗口实际 CSS 像素算，勿信截图坐标（截图可能被缩放，曾造成约 19% 系统性偏移误判）。
6. **PWA service worker**：生产模式验证前注销 SW + 清 caches，否则误判旧 bundle。
7. **tldraw 控件事件**：节点内交互控件必须控件级 stopPropagation，绝不挂容器级（会吞画线起笔）。
8. **大资产**：只允许 idbref://（IndexedDB）或 http(s) 入 meta，blob: 一律拒（跨刷新失效）。
9. **测试计数**：以实测为准，历史汇报多次出现口径错误。server 测试偶发 ECONNRESET 重跑即过；起 sqlite 实例用唯一 .tdb 库名防 WAL 脏数据。
10. **hooks**：必须在所有 early return 之前调用。11. **oxlint react(purity)**：不允许 render 期调用 Math.random（useRef 初值留空，在 effect 内惰性生成）。
12. **多项目落盘**：CanvasWorkbench 的 docRef 必须存 {projectId, doc}（D9 实测串写缺陷：防抖落盘用旧闭包 activeProjectId + 新 docRef 会把新项目文档写进旧项目键）。

## 红线（违反 = 打回重做）

- **sell / drama 零回归**：src/ai/、src/persist.ts、src/types.ts diff 必须为零；不改 sell 6 镜管线；不改回流看板聚合（src/domain/feedback.ts 的 computeWinRates 是唯一聚合层）。
- **诚实标注**：演示模式 / 无 Key / 无伴生服务 / 无 WebGL 一律如实标注，绝不伪造数据或结果（Skill 市场不得伪造下载量、记忆图谱空态不得摆样例、未就绪资产不伪造）。
- **不做**：多人实时协作 / 评论 / 画布分享链接；视频时序级局部修复；3D 写实角色定制 / 逐骨骼手调；D8 之外的 MCP 真实第三方授权；在 sell/drama 上做画布化改造；**任何绕过 tldraw 许可校验/去水印的手段**（用户已拍板接受水印）。
- **HOW_TO_USE 此前一直不动，只在收官统一更新**。

## 环境与手法备忘

- 默认入口已是 **Agent 画布**（无参数进入画布；?view=sell | drama | canvas 深链保留）。
- 画布暴露 window.__wlsEditor 调试句柄，可编程建节点/连线（createShape + createBindings，节点 id 形如 shape:wls-<nodeId>）用于下游链路验证；真实鼠标画箭头绑自定义 shape 仍不可靠。
- PowerShell 里 playwright-cli eval 复杂 JS 用 Get-Content file.js -Raw 传入，避免引号地狱；可直接用 CSS 选择器如 [data-testid=xxx] 定位。
- 生产构建验证：node server/weblockshot-server.mjs --port 5180 --dist ./dist（可注入能力位，如 D8 用 startServer({mcpSdkInstalled:true}) 临时脚本验证 ready 态）。
- 参考稿目录名是 Miroa_Refer（不是 Miora）；中文文件名在命令传递中会乱码，用通配符 Miora_*N.png 复制成 ASCII 名再读。

## 提交与汇报规范

- commit 风格：feat(canvas): <切片> … / docs(...) / fix(...)；只提交该切片相关文件（工作区常有 .tmp-*/canvas-*.png/.playwright-cli 残留，勿误提交，发现的临时残留清理掉）。
- 推送 main 会触发 GitHub Pages 部署（.github/workflows/pages.yml，含 tsc/lint/test 质量门禁）；gh run list --workflow=pages.yml 可查状态。

## 现在开始

1. 读 CANVAS_PLAN.md（v1.9）+ git log --oneline -15，确认理解。
2. 按 T1 → T2 → T3 → T4 → T5 → L1 → I1 → M1 → 收官 的顺序连续执行；每片走「实现 → 四门槛自测 → 独立验收 → commit/push」。
