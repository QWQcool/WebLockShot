# WEB锁镜 WebLockShot — 产品与实现规划

> 本文是后续实现的唯一规格。按阶段下令即可开工。未写进「要做」的一律不做。
> 建议投入约 3 小时，上限 5 小时。到达上限时：主路径必须可走通，其余写入 README「未完成 / 下一步」。

---

## 1. 一句话

给竖屏短剧创作者一台 **出可灵 / 即梦之前的免费粗剪台**：用几句话拆成可播放的 6 镜动态分镜（HTML + GSAP 模板，不是成片），锁镜头和台词之后，导出两家模型可粘贴的提示词包，减少失败重抽。

粗糙是特性。这是 animatic，不是给观众看的成片。

---

## 2. 对题声明（录屏 / README 开场用）

| 题目在问 | 我们的选择 |
| --- | --- |
| 叙事形式 | 竖屏短剧的动态分镜（animatic） |
| 目标创作者 | 用可灵 / 即梦出镜、被积分和等待拖死的短剧创作者 |
| 最值得解决的环节 | 镜头与台词尚未锁定就去烧视频额度 |
| AI 如何参与 | 拆镜 + 按模型方言编译提示词；画面由本地模板渲染，不调用视频 API |
| 可体验边界 | 时间轴能播、能改一镜、能复制提示词；**不生成真实视频** |

刻意不做：文生视频、文生图、海选 12 个平行成片、通用「帮我写故事」聊天窗、支付。

---

## 3. 主路径（内定，实现必须按此顺序走通）

面试官从打开页面到复制提示词，**3 分钟内**可走完。

1. **模式**  
   默认进入 **预设模拟**。顶栏可切到 **自带 Token**。切换不丢当前故事；Token 模式未配置密钥时，生成按钮不可用并说明原因。

2. **输入**  
   三个短框，不是自由长文：  
   - 人物（谁，彼此什么关系）  
   - 冲突（这一分钟里要什么、拦着的是什么）  
   - 钩子（最后一镜让人想看下一集的那一下）  
   预设模式：下拉选内置故事，三个框只读回填，点「生成粗剪」。  
   Token 模式：可改三个框，点「生成粗剪」走模型。

3. **生成**  
   固定产出 **6 镜**，每镜含：  
   - 这一镜推进了什么（一句，结构不能空）  
   - 景别、运动模板、台词、秒数（2–5s）  
   - 角色谁在画面里  
   竖屏 9:16 舞台 + 时间轴一次播完。

4. **锁镜（选择发生在镜，不发生在海选）**  
   只允许三种编辑，全部立即反映到预演和导出：  
   - 改这一镜台词（本地，不必调模型）  
   - 换这一镜运动模板（本地）  
   - 重做这一镜（预设：切换该镜的仓库备选；Token：只让模型重写这一镜 JSON）

5. **导出**  
   一键复制 **可灵包** / **即梦包**（Markdown）。含角色锚点、画幅时长、与 GSAP 模板同名的运动、台词走字幕、负面提示。界面注明：请到可灵 / 即梦自行粘贴；本产品不代出视频。

6. **失败与空态**  
   Token 失败：保留上一版可播内容，错误写清（无密钥 / 网络 / 模型返回不合格 JSON）。  
   预设模式永远可播，不依赖网络。

---

## 4. 双模式

### 4.1 预设模拟（默认，面试官零 Token）

- 不发起任何模型请求。输入、6 镜 JSON、备选镜、两套导出文案全部来自仓库 `presets/`。  
- 「重做这一镜」在该镜的 `alts[]` 里循环，没有备选则按钮禁用并说明。  
- 改台词 / 换运动仍可用：本地改 JSON，渲染器和导出器重跑。这样面试官能感到产品是活的，不只是放片。  
- 页脚固定文案：`当前为预设模拟 · 未消耗 Token · 数据来自仓库 presets/`。

### 4.2 自带 Token

- 用户填写：API Base URL、API Key、模型名。只存 `sessionStorage`，不写 localStorage、不打日志、不入库、不进 Git。  
- 兼容 OpenAI Chat Completions（`/v1/chat/completions`）。国内面试官可用 DeepSeek、硅基流动、OpenRouter 等兼容端点。  
- 前端直调用户填写的 Base URL（避免自建后端存密钥）。文档写明：密钥仅在本机会话，刷新标签页需重填。  
- 模型 **只允许输出符合 schema 的 JSON**（见 §7）。禁止让模型直接吐任意 HTML。  
- 动态页面 = **内嵌 skill 规格 + 本地编译器**（见 §8）：模型填 JSON，编译器生成 9:16 舞台。预设模式和 Token 模式走 **同一编译器**，保证面试官切模式时品质一致。

### 4.3 模式与能力对照

| 动作 | 预设模拟 | 自带 Token |
| --- | --- | --- |
| 播完整条 6 镜 | 仓库数据 | 模型 JSON → 同一编译器 |
| 改台词 / 换运动 | 本地 | 本地 |
| 重做一镜 | `alts[]` | 模型只重写该镜 |
| 导出可灵 / 即梦 | 先用预存包，若用户改过镜则本地重编译导出 | 始终按当前 JSON 编译 |
| 生成动态 HTML | 编译器 | 编译器（skill 约束模型输出，不约束成「模型写网页」） |

---

## 5. 镜头词典（GSAP 只许用这些）

运动与导出提示词 **同名**。编译器按 `motionId` 挂 GSAP，禁止每镜现场编一段动画。

| motionId | 预演 | 提示词里的镜头运动 |
| --- | --- | --- |
| `push_in` | 舞台缓缓 scale 放大 | 缓慢推近 |
| `pull_out` | scale 缩小露环境 | 拉远 |
| `pan_left` | 层向右移（镜头左摇） | 镜头左摇 |
| `pan_right` | 层向左移 | 镜头右摇 |
| `follow` | 主体轻微 x 位移 | 跟移主体 |
| `cut` | 无位移，硬切进入 | 硬切 |
| `enter_stage` | 主体从画外进入 | 人物入画 |
| `line_pop` | 台词条弹出（可与上面叠加为次动作） | 对白上屏 |

景别 `shotSize`：`ecu` 大特写 / `cu` 特写 / `ms` 中景 / `ws` 全景。只影响构图 CSS（主体大小、位置），不再开新动画。

时长：每镜 2–5 秒，默认 3。整条目标约 18 秒（短剧一钩的量级）。

画幅：舞台恒定 **9:16**，最大高度约占视口，左右为剪辑台 UI。

减动：`prefers-reduced-motion: reduce` 时跳到每镜首帧静帧，时间轴仍可点选镜号。

---

## 6. 视觉与前端（一次定死）

用 frontend-design 做 **编辑器外壳**，不要让每个故事长成不同落地页。

- 气质：竖屏粗剪台。材料来自监视器边框、场记板、中国油性笔、手机竖屏，而不是通用 SaaS 仪表盘。  
- 签名元素：中央 9:16 舞台 + 底部带镜号的时间轴。大胆只用在这里。  
- 分镜角色：**色块剪影 + 排版当人**，不出角色图、不骨骼动画。每角色一个稳定色，来自故事 JSON 的 `characters[].color`。  
- 禁止把产品装饰动画和分镜预演混用。GSAP 只驱动舞台内时间轴。  
- 主交互是 **播放头**，不用 ScrollTrigger 当核心。

---

## 7. 数据契约

### 7.1 故事 JSON（模型输出与 `presets/*/story.json` 同一 schema）

```ts
type Story = {
  id: string
  title: string
  input: { character: string; conflict: string; hook: string }
  characters: { id: string; name: string; color: string; anchor: string }[]
  // anchor：外貌/服装一句，导出时每镜重复，防换脸
  setting: { place: string; time: string; light: string }
  shots: Shot[] // 长度必须为 6
}

type Shot = {
  id: string           // "s1"..."s6"
  order: 1 | 2 | 3 | 4 | 5 | 6
  purpose: string      // 这一镜推进了什么，必填
  shotSize: "ecu" | "cu" | "ms" | "ws"
  motionId: MotionId
  durationSec: number  // 2-5
  cast: string[]       // character id
  line: string         // 可空（无对白镜）
  lineSpeaker?: string // character id
  alts?: Shot[]        // 仅预设文件使用；模型输出不要带 alts
}
```

模型必须输出可 `JSON.parse` 的对象，不要 Markdown 围栏。不合格则整次失败，不半渲染。

### 7.2 内置预设（仓库只做这一条完整故事，外加每镜 1 个备选）

**id:** `hook-at-the-door`  
**片名：** 《门缝》

- 人物：租客林夏；房东赵叔（从不露面，只留字条和门锁声）  
- 冲突：林夏今晚必须把藏在地板下的硬盘带走；门禁被远程锁死，赵叔说「查水电」  
- 钩子：门缝塞进一张新字条——写的是林夏的乳名，而她从未告诉过房东  

6 镜节拍（实现时按此写死 JSON，允许打磨文案，不允许改结构）：

| 镜 | purpose | 景别 | 运动 | 台词方向 |
| --- | --- | --- | --- | --- |
| 1 | 建立：她在收东西，时间不够 | ms | `cut` | （无对白，环境声用字幕「门锁，远处」） |
| 2 | 欲望：硬盘是她要带走的东西 | ecu | `push_in` | 林夏：「再给我三分钟。」 |
| 3 | 阻碍：门已经被锁 | ws | `pull_out` | （无对白） |
| 4 | 升级：字条从门缝进来 | cu | `enter_stage` | 字幕：字条字迹 |
| 5 | 信息：乳名暴露 | ecu | `push_in` | 林夏把纸条念出声 |
| 6 | 钩子：门外有人叫这个名字 | ms | `follow` | 门外男声（赵叔）：乳名 + 「开门。」 |

每镜在 `alts` 里给一个不同 `motionId` 或不同 `line` 的备选，供预设「重做这一镜」。

---

## 8. 内嵌 skill：JSON → 动态 HTML（不是模型写网页）

仓库放置 Cursor skill，实现与 Token 提示词都遵守它：

` .cursor/skills/shot-stage/SKILL.md `

Skill 规定：

1. 只根据 Shot + Story 的字段生成舞台，不发明新角色、不改钩子。  
2. 舞台 DOM 结构固定（实现时用 React 组件，语义如下）：

```
.stage[data-shot]          9:16
  .layer-bg                场景色/光线
  .layer-cast              剪影块，按 cast[]
  .layer-prop              可选：门缝、字条等用 data-prop
  .layer-line              台词条
  .layer-slate             镜号 / 秒数
```

3. GSAP：`gsap.timeline({ paused: true })` 由播放头驱动；按 `motionId` 从字典取 tween，禁止临时新动画。  
4. Token 模式的 system prompt **原文引用本 skill 的 JSON schema 与禁令**，要求只填 JSON。  
5. 开发时用本 skill + `frontend-design` + `gsap-react` 写编译器；**运行时**面试官不会在产品里「调用 Cursor skill」，只是模型被同一份契约约束。

导出编译器（可灵 / 即梦）是第二个纯函数：`Story → markdown`，与舞台编译器并列，不经过模型（Token 模式也不要用模型写提示词，避免两套文案漂移）。提示词模板写在 `src/export/templates.ts`。

---

## 9. 导出提示词结构（每镜一段，两套方言）

每镜必须含：

- 画幅 `9:16`，时长 `durationSec` 秒  
- 角色锚点：出场人物的 `anchor` 全文重复  
- 场景：`setting.place / time / light`  
- 镜头：`shotSize` 中文 + 与 `motionId` 同名的运动  
- 台词：默认 **字幕上屏**，不要求口型（降低模型失败）  
- 负面：换脸、横屏、文字乱码、多余人物、卡通滤镜（可按模板微调）  
- 可灵包偏「镜头/运镜/主体」口吻；即梦包偏「画面描述 + 运镜」口吻。字段同源，措辞不同。

头部再给一次「角色一致性说明」：后续各镜必须沿用同一外貌锚点。

用户若本地改过台词或运动，导出必须反映当前 JSON，而不是仓库里的静默缓存。因此：预设初始可带一份 `export-preview.md` 作对照；**复制按钮始终走纯函数现算**。

---

## 10. 技术选型

| 项 | 选择 | 原因 |
| --- | --- | --- |
| 框架 | Vite + React + TypeScript | 5 小时内可部署，无服务端密钥 |
| 动画 | GSAP + `@gsap/react` | 播放/暂停/seek；分镜是时间不是滚动 |
| 样式 | 手写 CSS（frontend-design 定 token） | 不引入重 UI 库 |
| 数据 | 静态 `presets/` + sessionStorage 密钥 | 预设零依赖 |
| 部署 | 静态托管（Vercel / Cloudflare Pages / GitHub Pages 择一） | 题目要可访问链接 |
| 模型 | 用户自带，OpenAI 兼容 | 不提交真实密钥 |

目录（实现按此建，可微调文件名，不可拆主路径）：

```
PLAN.md                          ← 本文件
README.md                        ← 运行、双模式、真实/mock 边界、投入时间
.cursor/skills/shot-stage/SKILL.md
presets/hook-at-the-door/story.json
src/main.tsx
src/App.tsx
src/modes.ts                     ← 预设 | token
src/types.ts
src/presets/load.ts
src/ai/schema.ts                 ← JSON 校验
src/ai/client.ts                 ← Chat Completions
src/ai/prompts.ts                ← system/user，引用 skill 契约
src/stage/ShotStage.tsx          ← 9:16 编译结果
src/stage/motions.ts             ← motionId → GSAP
src/stage/useShotTimeline.ts
src/export/templates.ts
src/export/buildPromptPack.ts
src/ui/EditorChrome.tsx          ← 输入 / 时间轴 / 锁镜 / 导出 / 模式
```

---

## 11. 真实 vs mock（提交必须写进 README）

| 能力 | 状态 |
| --- | --- |
| 预设 6 镜播放、改词、换运动、导出 | **真实**，纯前端 |
| Token 拆镜 / 重做一镜 | **真实**（需用户密钥）；无密钥时不可用 |
| 可灵 / 即梦出视频 | **不做**；只导出提示词 |
| 角色图 / 视频 | **不做**；剪影色块 |
| 支付、账号、云端存稿 | **不做** |
| 提示词质量 | 模板编译，**不是**模型二次润色 |

下一步优先（不做进本切片，只写 README）：一键跳转可灵并带草稿、多集、角色图参考上传、口型模式。

---

## 12. 实现阶段（按阶段下令）

**阶段 0 — 契约**  
`types.ts`、`shot-stage` skill、`presets/hook-at-the-door/story.json`（含 alts）、JSON 校验。

**阶段 1 — 能播**  
编辑器外壳 + 舞台 + 6 个运动模板 + 时间轴播放/暂停/seek。先只吃预设。`prefers-reduced-motion` 静帧。

**阶段 2 — 能锁**  
改台词、换运动、预设重做一镜（alts）。播放头反映当前镜。

**阶段 3 — 能导出**  
可灵包 / 即梦包现算复制。页内短说明：如何粘贴、本产品不出视频。

**阶段 4 — Token**  
设置面板、sessionStorage、Chat Completions、schema 校验、整条生成与单镜重做。失败态。

**阶段 5 — 打磨与提交材料**  
空态/错误、README（运行、双模式、边界、AI 如何参与开发、投入时间）、部署、不超过 5 分钟的录屏脚本（见 §13）。

不要跳跃：1 不能播时不要做 4。

---

## 13. 录屏脚本（≤5 分钟）

1. 题目选择：短剧创作者、锁分镜、不烧视频额度（40s）  
2. 预设模式完整走主路径，强调零 Token（90s）  
3. 改一句台词 + 换一个运动 + 复制即梦包，打开导出文案指字段（60s）  
4. 打开 Token 面板说明「密钥只在会话」；若现场有密钥则改一处输入重生一镜，没有则到此为止并说明（40s）  
5. 边界：HTML 是 animatic；未接视频 API；GSAP 是模板不是每镜手写；下一步（40s）  
6. 开发过程：用 Cursor + skill 约束 JSON→舞台，而不是让模型直接写页面（20s）

---

## 14. 明确不做

- 真视频 / 真出图 / 角色 LoRA  
- 生成多个完整变体供点选  
- 无结构的「几句话出六段漂亮运动」  
- 滚动驱动作为主预演  
- 服务端代持密钥、登录、支付  
- 上传 PDF 剧本、多集、协作  
- 把本产品做成可灵官方工作流的完整替代

---

## 15. 开工口令

你后续只需发例如：

- `按 PLAN.md 做阶段 0`  
- `按 PLAN.md 做阶段 1`  
- …直到阶段 5。

阶段内细节以本文为准；冲突时以 **主路径 6 步** 和 **镜头词典** 为准，不扩范围。

---

## 16. 开工锁定（实现时写入，不扩范围）

1. `Shot.prop?`：`"none" | "door" | "note" | "lock"`。Token 只许这四个，避免舞台空道具。
2. 台词非空时，`line_pop` 作为次动作叠加，不占用 `motionId`。
3. Token 解析允许剥一层 Markdown 围栏；CORS / 网络失败写清。README 推荐 OpenRouter 或硅基流动（浏览器可跨域）。

