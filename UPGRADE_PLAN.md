# WebLockShot 升级规划 —— 从「6 镜粗剪台」到「多 Agent 带货视频生成工作台」

> 版本：**v1.1**（2026-09-06）· 基线：commit `80ecf25`
> 本文是**设计依据**；落地执行入口见 `HANDOFF_PROMPT.md`（可整段交给其他 AI 工具）。
> **v1.1 变更**：目标岗位明确为「用 AI 生成**带货视频**、仿照网上爆款」→ 新增 ①商品导入入口（链接/图片/参考视频）；②商品理解 + 爆款拉片拆解节点；③「提示词扩充器」（爆款结构库+句式库，一键扩写成带货脚本/视觉提示词）；④带货专用的 sell-stage 契约（钩子前移）。剧情短剧保留为第二模式。

---

## 0. 一页摘要

**现状**：纯前端竖屏短剧「粗剪台」——LLM 把一句话（主题/人物/冲突/钩子）扩成 6 镜 JSON 分镜，GSAP 预演，导出可灵/即梦提示词。**不代出视频**。

**升级目标**：把它变成 **面向电商带货的多 Agent 视频生成工作台**。典型用户（电商运营/达人）的三条路径都能走通：
1. **给我商品 → 给我成片**：导入商品链接 / 商品图 / 参考爆款视频 → AI 理解商品 → 按爆款套路自动构思并**扩充提示词** → 生成带货脚本 → 分镜 → 直调视频 API 出片 → 校验 → 交付。
2. **给我一段参考**：粘贴爆款口播稿或上传本地参考视频 → 拉片拆解结构 → 套用同款套路生成新片（**学结构、不抄内容**）。
3. 保留原剧情短剧能力（一句话 → 6 镜剧情片）。

**四条主线**：
1. **商品导入与理解**（链接/图/视频三入口，多模态自动抽取卖点）。
2. **仿爆款的提示词扩充**：爆款结构库 + 钩子/卖点句式库 + 一键扩写，把浅输入扩成详细带货脚本与镜头提示词。
3. **直连视频 API**：即梦/可灵真实生成，网页内完成「商品 → 可播放成片」。
4. **多 Agent / 节点化编排**：需求→商品理解→拉片→剧本→分镜→视觉→生成→质检→交付，人类在环。

**Web 先行**，暂不做小程序；Provider 抽象、节点编排、会话模型为「套小程序壳/挪服务端」留缝。项目同时是面试「AI 生成带货视频平台」岗的活素材（§12）。

---

## 1. 现状盘点（已核实，勿推翻）

| 文件 | 职责 | 升级处置 |
| --- | --- | --- |
| `src/types.ts` | `StoryInput{theme,character,conflict,hook}`；`Character{id,name,color,anchor}`；`Setting{place,time,light}`；`Shot{id,order 1-6,purpose,shotSize,motionId,durationSec 2-5,cast[],line,lineSpeaker,prop}`；8 种 motion / 4 景别 / 4 道具 | **冻结 Shot/Story 契约**（见 §4） |
| `src/ai/schema.ts` | 手写严格校验器：6 镜、order 1-6、词典枚举、角色引用、颜色正则。**白名单抽取=模型未知字段被丢弃** | 扩展字段放扩展层，**不许塞 Shot** |
| `src/ai/generate.ts` | envelope→逐镜×6→Story；每镜落盘=断点续传 | 收编为 storyboard 节点兜底 |
| `src/ai/prompts.ts` | system prompt 从 `.cursor/skills/shot-stage/SKILL.md?raw` 注入 | **skill 驱动已验证**；新增 sell-stage 照此办理 |
| `src/ai/client.ts` | OpenAI 兼容 `/chat/completions`，**仅文本消息**；`TokenClientError{config,network,http,empty}` | 需扩展支持 `image_url` 多模态（§6.5） |
| `src/ai/retry.ts` | withRetry 指数退避+jitter、Retry-After、AbortSignal、可注入 Clock（有测试） | 复用 + 「轮询恢复」语义 |
| `src/persist.ts` | GenerateSession v1 断点；读取全量重校验 | 升级 v2 多节点 session，兼容 v1 |
| `src/export/templates.ts` | 导出可灵/即梦提示词包 | **保留为 fallback**；视觉化风格复用 |
| `src/stage/ShotStage.tsx` 等 | GSAP 9:16 动画台 | mock 视频录制素材 + **视频抽帧预览** |
| `presets/` | 《门缝》《未读》《13层》剧情预设 | 不动（剧情模式素材） |
| `提示词存储.md` | **历史会话草稿，非模板库** | 不依赖；「结构库/句式库」在项目内新建（§5） |
| 平台 | Vite + React 19 + TS；无后端；GH Actions 部署 Pages | 不动 |

---

## 2. 目标架构：商品 → 编导/带货工作流（AI 节点）

```
商品导入(三入口)
  ├─ 商品链接(URL)      ─→ 链接档案 + 降级引导(粘贴标题/卖点)【纯前端限制,见§6.6】
  ├─ 商品图片(上传)      ─→ 多模态理解①  → ProductInsight(品类/卖点/人群/场景)
  └─ 参考视频(本地/链接) ─→ 抽帧+多模态理解② → RapSheet(拉片报告:结构段落/镜头/文案节奏)
                                        ↓  （无 vision key 时: 手工填卖点 / 粘贴爆款口播稿）
   ┌───────────── 提示词扩充器 promptBooster ─────────────┐
   │  爆款结构库(套路模板) + 钩子/卖点句式库 + 商品信息 →   │
   │  一键扩写 → 带货脚本(Script, 每拍带目标/动作/口播/字幕) │
   └──────────────────────┬───────────────────────────────┘
                          ▼
③ 审稿 agent(scriptCritic, 结构/转化逻辑检查 ≤2 轮, 可出 2 版)
   ▼  ← 人工检查点①: 剧本/口播审阅
④ storyboard 节点: Script 拍点 → 6 镜 Story（**带货=sell-stage 契约**；剧情=shot-stage 契约）
   ▼  ← 人工检查点②: ShotStage 预演、单镜改/重做
⑤ visualizer 节点: shot+anchor+setting+卖点 → 每镜 VisualPlan(正向含产品与字幕提示)
   ▼  ← 人工检查点③: 视觉卡审阅
⑥ executor 节点: ShotJob×6 队列 → 媒体 Provider(可灵/即梦/mock) 轮询
   ▼  ← 人工检查点④: 生成前成本确认
⑦ qc 节点: 产物三层校验 → 失败自动重试≤2 → 单镜人工重生成
   ▼
⑧ 交付/审片: 顺序播放器(6 段+字幕) + 单镜重生成 (+P2 合成 mp4)
```

- **多 Agent 落地形态**（浏览器内如实讲）：节点流水线 + 角色分工 LLM 调用（商品理解/编剧/审稿/视觉化）+ 人类在环检查点。
- 剧情短剧老路径 = 同一管线，跳过「商品/拉片」节点直接进 brief，stage 契约切 `shot-stage`。

---

## 3. 带货工作流 → AI 节点映射

| 岗位动作 | AI 节点 | 产物 | 价值点 |
| --- | --- | --- | --- |
| 看商品、提炼卖点 | productUnderstandNode（多模态） | ProductInsight | 图→品类/卖点/人群/场景 |
| 拉片拆爆款结构 | rapNode（抽帧+多模态） | RapSheet + structureId 命中 | **学爆款结构，不抄内容** |
| 想钩子、排卖点节奏 | scriptWriterNode + **结构库** | Script（带货拍点） | 模板工程+LLM 扩写 |
| 审稿自查转化逻辑 | scriptCriticNode | 修改意见 ≤2 轮 / 2 版 | 双 agent 互搏 |
| 写分镜表 | storyboardNode | Story×6（stage 契约） | 复用现有 schema |
| 定画面/产品呈现 | visualizerNode | VisualPlan×6 | 每镜产品正向提示词 |
| 盯渲染催片 | executorNode | ShotJob 队列 | 幂等+轮询+断点 |
| 素材验收 | qcNode | 校验报告 | 三层校验（§7） |
| 审片/改一镜 | 人工在环 | 单镜 regenerate | 现 redoShot 升级 |

---

## 4. 数据模型：扩展层，冻结现有契约

**为什么冻结**：`schema.ts` 白名单抽取（未知字段被丢），且 Shot/Story 被 presets、导出、ShotStage、两个 stage skill 依赖。

**关键洞察**：带货 vs 剧情**不需要改 Story schema**——6 镜/词典/时长全兼容，区别只在**叙事语义**，由 stage skill 契约驱动：
- `shot-stage`（剧情）：钩子收尾于第 6 镜，冲突→悬念推进。
- `sell-stage`（带货，新增）：钩子在第 1 镜，卖点中段，CTA 收尾（示例见下）。
同一个 schema、两套 stage 契约 = skill 可扩展性的直接证明。

**带货 6 镜结构示例（sell-stage 骨架，写入 `.cursor/skills/sell-stage/SKILL.md`）**
| 镜 | 时间 | 作用 | 镜头/字幕参考 |
| --- | --- | --- | --- |
| s1 | 0-3s | **钩子**（反常识/痛点提问/效果反差句式） | cu 产品或人物，强字幕 |
| s2 | 3-6s | 痛点放大/场景带入 | ws/ms 场景 |
| s3 | 6-10s | 产品亮相+卖点 1 | cu/ecu 产品特写 |
| s4 | 10-16s | 卖点 2-3 功能演示 | ms 使用动作 |
| s5 | 16-20s | 证言/效果/价格锚点 | before/after、对比 |
| s6 | 20-24s | **CTA**（限时价/引导） | 产品+促销字幕，line_pop |

> 道具词典（none/door/note/lock）不扩展；「促销标签/字幕卡」这类需求在 visual 正向提示词里描述，不动 prop。

**新增类型（`src/domain/*`，独立 zod schema + 测试）**
```ts
ProductInput { source: 'link'|'image'|'manual'; link?: string; title?: string
               sellingPointsManual?: string[]; imagePreview?: string /*本地 dataURL 仅预览*/ }

ProductInsight { category: string; look: string; sellingPoints: string[]   // 3-5 条
                 audience: string; scenarios: string[]; priceBand?: string; tone: string }

RapSheet { source: 'local-video'|'paste-copy'|'template'
           structureId?: string; hookType?: string; sections: {name,timeHint,note}[]
           pacingNote: string; styleNote: string }          // 拉片拆解报告

StructureTemplate { id: string; name: string; fit: string   // 适合的品类/平台
                    beatSkeleton: {role:'hook'|'pain'|'reveal'|'demo'|'proof'|'cta'
                                   hint:string}[]; hookSamples: string[] }  // 手写库,可编辑

CreativeBrief { platform: 'douyin_ecom'|'kuaishou'|'shipinhao'|'xiaohongshu'|'generic'
                targetDurationSec: number; audience?: string; sellingPoints: string[]
                style?: string; cta?: string; banned?: string[]
                product?: ProductInsight; rap?: RapSheet
                storyInput?: StoryInput }                   // 剧情模式回填, 保兼容

ScriptBeat { order: number; role: 'hook'|'pain'|'reveal'|'demo'|'proof'|'cta'
             goal: string; action: string                   // 画面动作
             audio?: { kind:'vo'|'dialogue'|'sfx'|'none'; speaker?: string; text?: string }
             caption?: string; emotion?: string }           // caption=字幕(卖点/促销)

Script { logline; templateId?: string; beats: ScriptBeat[]; ctaLine; lengthTargetSec }

VisualPlan { shotId; kind:'text2video'|'image2video'; positive; negative?; ratio:'9:16'
             durationSec; caption?: string; referenceImage?: string }
MediaAsset { shotId; url; coverUrl?; durationSec; sizeBytes? }
ShotJob { shotId; taskKey; provider; status; providerTaskId?; attempt; error?; asset? }
PipelineSessionV2 { version:2; id; activeNode; brief?; script?; story?; visualPlans[]; jobs[] }
```

---

## 5. 提示词扩充器 promptBooster（新核心功能）

「通过提示词工具扩充」在本项目 = **结构化模板工程 + LLM 扩写 + 人工微调**，不是把提示词拼长。

1. **爆款结构库 `src/prompts/library/structures.ts`**：手写起步套路（可编辑/可加）：
   - T1 痛点开场：钩子(痛点提问)→放大→产品亮相→功能演示×2→效果证言→促销 CTA
   - T2 效果反差：糟糕现状→产品介入→明显改善（before/after）
   - T3 开箱测评：悬念开箱→逐件卖点→总结推荐
   - T4 剧情植入：3-5s 短剧情→神转折带出产品→卖点→CTA（衔接原剧情模式）
   - T5 价格锚点：贵价对比→平价替代→限时优惠→抢购 CTA
2. **钩子/卖点句式库**（每套路给 3-5 句式种子供 scriptWriter 参考）：反常识（「千万别买××，除非…」）、痛点提问、效果反差（「用了 3 天，同事以为我换了张脸」）、数据冲击、悬念留白。
3. **一键扩写**：用户选模板（或交给 LLM 按 ProductInsight 推荐）→ scriptWriter 产出带 role 标签的带货 Script → 每拍可视化卡片可改（目标/动作/口播/字幕）。
4. **视觉提示词扩充**：visualizerNode 把 ScriptBeat + Character.anchor + Setting + 卖点句 编译成每镜正向提示词（含产品外观、使用场景、字幕 burn-in 描述、风格词），完全可编辑后进生成。
5. UI 提供「模板卡浏览 + 已选模板 beat 骨架预览」，全程可见可改（黑盒长文本是反面教材）。

---

## 6. 媒体接入层

### 6.1 Provider 接口（异步任务模型：submit→poll→asset）
```ts
interface VideoProvider {
  readonly id: 'kling' | 'jimeng' | 'mock'
  submit(req: VideoGenRequest): Promise<{ taskId: string }>
  poll(taskId): Promise<{ status:'queued'|'running'|'succeeded'|'failed'; error? }>
  getAsset(taskId): Promise<MediaAsset>
  cancel?(taskId): Promise<void>
  estimateCost(req): string
}
type VideoGenRequest = { clientTaskId; prompt; negative?; imageBase64?; durationSec; ratio:'9:16' }
```
- kling（可灵开放平台）：POST 提交 / GET 轮询；jimeng（即梦/火山侧）：**端点随官方迭代，实现前联网核对最新 OpenAPI**，先落接口壳 + TODO，不留凭记忆的假端点。

### 6.2 幂等与重试（面试 Q1 活代码）
- `taskKey = sha1(shotId + visualPlan 内容 + provider)`；提交前查 jobs：**同意图已有 queued/running → 复用不重复提交**（幂等键 + 约束裁决，不是先查后写）。
- 提交失败 → withRetry 指数退避；轮询中断（刷新/断网）→ 按 `providerTaskId` 恢复轮询（远端查询幂等）。
- `succeeded` 后想重生成 = 新意图 → **新 taskKey**。

### 6.3 key/CORS 三档（诚实边界）
| 档 | 做法 | 适用 |
| --- | --- | --- |
| A（默认） | 用户自填 provider/LLM key，仅 sessionStorage；vite dev proxy 绕 CORS | 本地/面试 |
| B | 云函数薄代理（EdgeOne Functions/CF Worker）：仅转发透传，不落库 | P2 |
| C（真生产） | 服务端持 key + 计费 + 任务队列（属岗位范畴，本项目不做） | 未来 |

绝不把 key 写进仓库/构建产物；README 写明线上走 B 或回退导出。

### 6.4 mock provider：真出片不是假进度
MediaRecorder 录制 ShotStage GSAP 动画 → 真 webm（Chrome/Edge），走完整 submit→poll→asset 语义；UI 标注「模拟出片」；blob 仅会话内。

### 6.5 多模态输入链路（商品图 / 参考视频）
- `src/ai/client.ts` 扩展：消息 content 支持 `{type:'text'}` + `{type:'image_url', image_url:{url: dataURL}}`（OpenAI 兼容，需 vision-capable 模型：硅基流动/OpenRouter 等）。仅文本模型时自动降级。
- **商品图**：上传 →（可选）本地压缩/转 dataURL → vision 理解 → ProductInsight。
- **参考视频（本地文件）**：`<video>`+canvas 抽关键帧（纯前端可行）→ 帧图集 + 用户补充的爆款口播稿 → vision 理解 → RapSheet。无 vision key → 直接粘贴口播稿走文本拆解。
- 帧校验顺手复用 §7 语义（抽帧失败=文件不可解析，提示换源）。

### 6.6 商品/爆款链接边界（诚实写死）
| 来源 | 纯前端可行性 | 处置 |
| --- | --- | --- |
| 商品链接（淘宝/PDD/抖音小店） | ❌ 跨域+反爬 | 保存 URL 作档案；引导粘贴标题/卖点（P0）；P2 薄代理服务端抓取解析 |
| 平台爆款视频链接 | ❌ 下载受限 | 引导用户下载/录屏后上传本地，或粘贴口播文案（P0 即可用） |
| 本地视频/图片 | ✅ | P0 可预览+抽帧；配 vision key 即自动理解 |

---

## 7. 产物三层校验（qc 节点）
| 层 | 校验 | 失败处置 |
| --- | --- | --- |
| L1 完整性 | fetch 探测（200 + video content-type + 字节>阈值）；mock 验 blob | 自动重试 ≤2 |
| L2 可解析 | `<video>` loadedmetadata、duration>0 且 ≈预期 ±30% | 重生成（新 taskKey，限次） |
| L3 语义 | canvas 抽帧非黑/花屏检测；字幕与 line/caption 人工确认 | 超限标 failed，UI 单镜重生成 |

原则：校验越靠前责任越清晰——生成前全 schema 硬校验，产物坏 = 平台重跑，绝不静默放行。

---

## 8. 功能路线 P0 / P1 / P2

### P0 ——「商品 → 可播成片」0 key 演示闭环
1. **商品导入入口**：三方式 UI（链接=档案+降级引导；图=预览+手填卖点；视频=本地抽帧预览）
2. **爆款结构库 + 句式库 + promptBooster UI**：模板卡选择→一键扩写成带货 Script→每拍可编辑
3. scriptWriter/scriptCritic 节点（带货结构，含 role 标签）
4. **sell-stage SKILL.md**（钩子前移）+ storyboardNode（beats→6 镜，shot-stage 保留为剧情模式）
5. visualizerNode（字幕 caption 进 VisualPlan）
6. executorNode + mock provider：串行队列、断点恢复、单镜重试、幂等
7. 顺序播放器（6 段+字幕+单镜重生成）；剧情旧路径不回归
8. 测试：schema/engine 中断恢复/幂等/mock 冒烟/结构库模板合法

### P1 —— 多模态 + 真实出片 + 自动质检
1. client 多模态扩展 + 商品图 vision 理解（自动 ProductInsight）
2. 本地参考视频抽帧 → 拉片拆解 → RapSheet（命中结构库推荐）
3. kling provider 真接（vite proxy + 用户 key）；jimeng adapter 壳 + 官方文档核对
4. qc 三层自动校验 + 自动重试≤2 + 单镜重生成
5. 生成前成本确认框；刷新按 providerTaskId 恢复轮询
6. 文生图首帧→image2video 一致性增强

### P2 —— 产品化（按需评估）
商品链接薄代理抓取解析、TTS 口播轨、ffmpeg.wasm 合成 mp4 下载、产品/角色参考图管理、2 版比稿与全链路历史、一键导出可灵工作台、平台爆款链接（受限）方案。

---

## 9. UI 用户旅程（步骤条，无路由库）

0. **商品导入**：链接/图片/视频三入口 + 预览区 + 「卖点手填/自动理解(需 vision key)」切换
1. **套路选择**：结构库模板卡（每卡：适合品类、beat 骨架、钩子句式样例）
2. **带货脚本**：扩写结果分拍展示（钩子/痛点/卖点/证言/CTA 高亮），逐拍可改，审稿意见卡
3. **分镜预演**：ShotStage 6 镜（sell-stage 语义），单镜改/重做
4. **视觉卡**：每镜正向/负向提示词 + 字幕，可改
5. **生成台**：6 张 ShotJob 卡（状态/进度/重试/成本预估）
6. **审片/交付**：顺序播放器 + 字幕；单镜重生成；演示模式全程 0 key

---

## 10. 文件级改动清单

**新增**
- `src/domain/{product,rap,script,sellVisual,shotJob,brief}.ts`（类型+zod）
- `src/domain/__tests__/*`
- `src/director/engine.ts`、`src/director/nodes/{productNode,rapNode,scriptNode,storyboardNode,visualizerNode,executorNode,qcNode}.ts`、`src/director/__tests__/*`
- `src/ai/agents/{scriptWriter,scriptCritic}.ts`、`.cursor/skills/{sell-stage,brief-stage}/SKILL.md`
- `src/prompts/library/structures.ts`（结构库+句式库，含模板校验测试）
- `src/media/{types,validate}.ts`、`src/media/providers/{kling,jimeng,mock}.ts`、`src/media/frames.ts`（抽帧）、`src/media/__tests__/*`
- `src/persistV2.ts`：PipelineSessionV2（兼容读 v1）
- `src/ui/{ProductStep,TemplateStep,ScriptStep,VisualStep,GenerateBoard,DeliverPlayer}.tsx` + App 步骤条

**修改**：`src/ai/generate.ts`（storyboard 兜底）；`src/ai/client.ts`（多模态 content part）；`vite.config.ts`（P1 dev proxy）；README/PLAN 的「真实 vs mock」表。

**不动**：`presets/`、`src/stage/` 编译逻辑、`src/types.ts` 的 Shot/Story 契约、导出包格式、剧情模式全链路。

---

## 11. 红线与风险

1. 不破坏现状（预设可播/导出格式/现有测试全绿）；剧情模式不回归。
2. 密钥只进 sessionStorage；商品图/视频只发往用户所选 provider，绝不进仓库。
3. **仿爆款 = 学结构与节奏，不抄口播文案/画面/音乐**（版权）；UI 提示用户自备素材授权。
4. 平台链接反爬是客观限制，如实降级引导，不许假装"已抓取"。
5. mock≠真实：标注「模拟出片」；进度=真实轮询语义。
6. P0 零新增运行时依赖；ffmpeg.wasm 等重依赖 P2 单独评估。
7. 浏览器单机队列 ≠ 分布式调度；localStorage 约束 ≠ 高并发 DB 唯一索引（注释/README 如实写）。
8. 范围隔离：与 AICodingPrjStudy 及其简历/训练材料无耦合。

---

## 12. 面试讲法映射（本项目 = 岗位活素材）

| 训练主题 | 本项目落地 | 讲法 |
| --- | --- | --- |
| 任务幂等 | taskKey 本地唯一约束 + 复用 job；轮询断点恢复 | 幂等键+约束裁决的组件级实现 |
| 任务状态机 | ShotJob 状态机 + 节点级断点 | 状态转移+断点续传 |
| 媒资异常校验 | qc 三层 + 抽帧（参考视频/产物帧） | 校验越靠前责任越清晰 + 帧级检测 |
| 调度 | 浏览器串行队列+限流+恢复轮询（模拟语义） | 见红线 |
| 计费 | 生成前成本预估确认（只展示） | 算力即成本 |
| **多模态/商品理解** | 图→ProductInsight；本地视频抽帧→RapSheet | 输入侧媒资理解 + 结构化抽取 |
| **模板工程/提示词扩充** | 结构库+句式库+一键扩写，产物结构化可编辑 | 爆款结构可复制 → 内容不抄袭 |

**红线**：单机队列 ≠ 分布式调度；本地约束 ≠ 高并发唯一索引；mock 是 MediaRecorder 本地动画（为了 0 key 演示编排），真出片走可灵/即梦 API。

---

## 13. P0 验收单

- [ ] `npm test` 全绿、`npm run build` 通过；剧情模式旧路径不回归
- [ ] 商品导入三入口可用（链接降级引导合理；图片可预览；本地视频可抽帧预览）
- [ ] 演示模式（0 key）：填卖点或选模板 → 扩写带货脚本可审可改 → sell-stage 6 镜 → mock 出片 → 播放器顺序播放
- [ ] 带货结构正确：钩子在第 1 镜、CTA 在第 6 镜（可校验 beat role 分布）
- [ ] 结构库 ≥5 模板、每模板 beat 骨架合法（有单测）
- [ ] 中途刷新 → 恢复未完成节点/job 不重复提交；同镜连点两次只 1 个 job
- [ ] 单镜失败可重试/重生成，不阻塞其它镜
- [ ] README「真实 vs mock」表更新，key 与平台链接限制说明清晰
