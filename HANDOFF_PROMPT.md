# WebLockShot 交接提示词（给其他 AI 工具）· v1.1

> v1.1：目标聚焦 **AI 生成带货视频（仿爆款）**，新增「商品导入（链接/图片/参考视频）→ 商品理解/拉片 → 提示词扩充（爆款结构库+句式库）」能力。配套设计见 `UPGRADE_PLAN.md` v1.1。

本文件有两个可复制的提示词块：

- **A. 规划提示词**：如果你想换台 AI 工具、让它先独立重审/细化 UPGRADE_PLAN.md 再动手（方向微调时用）。
- **B. 实现交接提示词（主）**：直接按 `UPGRADE_PLAN.md` 的 P0 开始写代码。默认用 B。

用法：把对应块完整复制粘贴到目标工具（Cursor / Claude / Windsurf / 其他 Agent IDE），并让它把工作目录设为 `C:\Users\Administrator\Desktop\WebLockShot`。要求目标工具能运行 `npm` 命令（Windows 下用 Git Bash 或工具自带终端）。

---

## 块 A —— 规划提示词（可选）

```text
你是一名资深 AI 应用全栈工程师，正在接手一个纯前端竖屏视频工具项目（Vite + React 19 + TS，无后端）。产品定位：面向电商带货，用户导入商品（链接/图片/参考爆款视频）后，AI 按爆款套路自动构思并扩充提示词，生成带货脚本与分镜，未来直连即梦/可灵等视频 API 出片。

请先完整阅读项目根目录的 README.md、PLAN.md、UPGRADE_PLAN.md，以及 src/types.ts、src/ai/schema.ts、src/ai/generate.ts、src/ai/retry.ts、src/ai/client.ts、src/persist.ts、.cursor/skills/shot-stage/SKILL.md，再回答：

1. UPGRADE_PLAN.md（v1.1）的 P0 范围是否合理、有无遗漏或过度设计？给出修订版任务拆分（每项含涉及文件与验收）。
2. 「商品导入三入口（链接/图片/本地参考视频）+ 提示词扩充器（结构库/句式库）+ sell-stage 带货契约」这几个新设计与现有代码资产的复用/冲突点分别是什么？
3. 按你的方案输出修订后的功能规划：覆盖 UPGRADE_PLAN.md（未初始化 git 则另存 UPGRADE_PLAN_v3.md）。

要求：P0 保持零新增运行时依赖（除非说明理由）；不改变 src/types.ts 中 Shot/Story 契约；诚实标注纯前端做不到的事（如商品/爆款平台链接抓取）；中文输出；表格化。
```

---

## 块 B —— 实现交接提示词（主，推荐）

```text
# 任务：把 WebLockShot 升级为「多 Agent 带货视频生成工作台」（先实现 P0）

## 你是什么角色
资深 AI 应用全栈工程师 + 前端架构师。项目使用 TypeScript（严格模式）、Vite、React 19，测试框架 vitest。工作目录：C:\Users\Administrator\Desktop\WebLockShot（Windows，命令行用 Git Bash 风格）。

## 产品定位（一句话）
电商运营/达人导入商品（链接 / 商品图 / 参考爆款视频）或直接填卖点 → AI 按爆款套路自动构思并**扩充提示词** → 生成带货脚本 → 6 镜分镜 →（真实视频 API 见 P1，P0 用 mock 出片）→ 校验交付。学爆款结构、不抄内容。原剧情短剧能力保留为第二模式。

## 动手前必读（按顺序，读完再改代码）
1. README.md —— 产品定位与「真实 vs mock」表
2. UPGRADE_PLAN.md（v1.1）—— 设计依据（P0 范围、§4 数据模型、§5 promptBooster、§6 mock/多模态/链接边界、§10 文件清单、§13 验收单），以它为准
3. src/types.ts —— Shot/Story/Character 契约（冻结，不许改）
4. src/ai/schema.ts —— 手写校验器；parseShot 白名单抽取，模型未知字段会被丢弃
5. src/ai/generate.ts —— 现顺序生成管线（剧情：envelope→6 镜），P0 收编为 storyboard 兜底
6. src/ai/retry.ts 与 src/ai/client.ts —— withRetry / TokenClientError 语义；client 目前仅文本消息
7. src/persist.ts —— GenerateSession v1 断点（升级 PipelineSessionV2，兼容读 v1）
8. .cursor/skills/shot-stage/SKILL.md —— skill 注入 system prompt 的既有模式（新增 sell-stage/brief-stage 照此办理）
9. src/stage/ShotStage.tsx、src/stage/motions.ts —— mock 录制动画与视频抽帧预览的素材来源
10. src/App.tsx、src/ui/EditorChrome.tsx —— 现有 UI，升级为步骤条
11. src/export/templates.ts —— 导出提示词包（保留为 fallback）

## 现状速览（已核实，不要推翻重来）
- 纯前端、无后端、无登录；Token/密钥只存 sessionStorage，绝不进 git
- StoryInput={theme,character,conflict,hook}；剧情生成链路 envelope→逐镜×6→Story
- Story 契约被 presets、导出、ShotStage、stage skill 依赖；扩展字段一律放扩展层，不许塞 Shot
- 现有能力：6 镜 GSAP 预演、单镜重做/按补充改镜、导出提示词包、LLM 重试（指数退避）、生成断点续传
- 现状「不代出视频」；P0 用 mock provider（MediaRecorder 录 GSAP 舞台 → 真 webm）走通链路

## 本次要实现的 P0（范围严格限定，不做 P1/P2）
按 UPGRADE_PLAN.md v1.1 §8-P0 与 §10 文件清单：
1. **商品导入三入口 UI**：链接（存 URL 档案 + 降级引导用户粘贴标题/卖点，不得假装抓取成功）；图片（本地预览 + 手填卖点，P0 不做自动识别）；本地参考视频（预览 + 抽帧预览，P0 不做自动拆解）
2. **爆款结构库** `src/prompts/library/structures.ts`：≥5 个带货套路模板（痛点开场/效果反差/开箱测评/剧情植入/价格锚点），每个含 beat 骨架（hook/pain/reveal/demo/proof/cta）+ 钩子句式样例；**手写数据 + zod 校验 + 单测**
3. **promptBooster**：选择模板（或按商品卖点给默认推荐）→ scriptWriter 一键扩写成带 role 标签的带货 Script（结构化 JSON）→ 每拍（goal/action/口播/字幕）可编辑；scriptCritic 审稿 ≤2 轮
4. **sell-stage SKILL.md**（钩子第 1 镜、CTA 第 6 镜）+ storyboardNode（带货 Script → 6 镜 Story，复用现有 schema 与 generate.ts 兜底；shot-stage 保留给剧情模式）
5. visualizerNode：每镜 VisualPlan（正向提示词含产品外观/使用场景/字幕 burn-in 描述 + 角色锚定复用；字幕 caption 字段）
6. executorNode + mock provider：串行队列、幂等（taskKey=sha1(shotId+visualPlan+provider)，同意图只 1 个 job）、断点恢复、单镜重试
7. 顺序播放器（6 段视频 + 字幕 + 单镜重生成）；「演示模式」0 key 跑通；剧情旧路径不回归
8. 测试：各节点 schema、engine 中断→恢复、幂等、mock 冒烟、结构库模板合法

## 硬约束（违反任意一条 = 打回重做）
1. 不改 src/types.ts 中 Shot/Story/Character/Setting/StoryInput 任何字段；不改 presets/ 与导出提示词包格式；剧情模式不回归
2. 现有测试必须全绿（先跑 npm test 确认基线），新增代码必须有对应测试
3. 不引入后端、不引入登录；key 只存 sessionStorage；仓库内不得出现真实密钥或 .env 占位
4. P0 尽量零新增运行时依赖；确需新增先说明理由再动 package.json（zod 若项目未装，作为唯一允许的新增）
5. **商品/爆款平台链接在纯前端抓不到**（跨域+反爬）——UI 如实降级引导，禁止假装已抓取或造假数据
6. 不得把 localStorage 唯一约束表述成「分布式/高并发唯一索引」，不得声称本项目实现生产级调度/计费（诚信红线，注释与 README 如实写「浏览器单机队列」）
7. mock 出片必须真实录制或真实流程，不许 setTimeout 假进度；失败路径要有真实错误态；UI 标注「模拟出片」
8. 代码注释与 UI 文案简体中文；TS 严格；沿用现有代码风格（先看一个现有文件再统一）
9. 每个节点/模块完成即可独立跑测试并小结，不要一口气写完再汇报
10. 完成后不要 git commit/push（由用户决定）；给出建议提交信息

## 完成验收（全部满足才算完）
- npm test 全绿、npm run build 通过；剧情模式预设可播不回归
- 商品导入三入口可用（链接降级引导合理、图片可预览、本地视频可抽帧预览）
- 演示模式（0 key）：填卖点或选模板 → 扩写带货脚本可审可改 → sell-stage 6 镜 → 生成台 6 job 依次 succeeded → 播放器顺序播放
- 带货结构校验：钩子在镜 1、CTA 在镜 6（beat role 分布可断言）
- 中途刷新 → 恢复未完成节点/job，不重复提交；同镜连点两次 → 只有 1 个 job
- 单镜失败可重试/重生成，不阻塞其它镜
- README「真实 vs mock」表已更新，key 与平台链接限制说明清晰

## 汇报格式（收尾时按此输出）
1. 改动/新增文件清单（按目录分组）
2. npm test 输出摘要 + npm run build 结果
3. 演示路径（点哪几步能看到成片）
4. 未完成项与已知限制（尤其纯前端做不到的边界）
5. 建议的 git 提交信息（不要执行提交）
```

---

## 给用户的小抄（怎么验收）

1. 目标工具必须能打开 `C:\Users\Administrator\Desktop\WebLockShot` 并执行 `npm`。
2. 先让它跑 `npm install && npm test && npm run build`，确认基线绿再放它改。
3. P0 做完后自己走一遍「演示模式」：填卖点（或选个套路模板）→ 带货脚本 → 6 镜 → 播放器出片（约 5 分钟）。
4. 想接真实可灵再放行 P1（需先申请可灵开发者 key）；商品图/爆款视频自动理解在 P1（需配 vision 模型 key，如硅基流动/OpenRouter 的视觉模型）。
5. 仿爆款是学结构，口播/画面素材请用自备或原创内容（版权注意）。
6. 本文件与 UPGRADE_PLAN.md 建议一起提交进仓库，作为后续接手的上下文。
