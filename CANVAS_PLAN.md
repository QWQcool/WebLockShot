# CANVAS_PLAN.md — WebLockShot 「Agent 创意画布」规划（一期 ~ 三期）

> 版本：**v1.6**（2026-09-10）· 基线：`main` 分支现状（sell / drama 双模式 + 工业化底座）
> **v1.6 变更**（三期重新锚定，用户拍板）：三期以 `C:\Users\v_chchsli\Desktop\Miroa_Refer` 参考稿 **1:1 复刻为第一目标**；自身特色（运镜词典/深度图等 sell 生态能力）**不进画布**。细化为 C0（工具条修复）+ 素体 Spike + E1/E2（二期形态回炉）+ D1~D4（见 §9），并记录清单二 5 项差异化决策。
> **v1.5 变更**（二期 B 收官 + 三期筹备）：二期 B S1~S3 归档；新增 **C0 工具条遮挡修复**（二期收官遗留，用户确认做）；三期细化为 D1~D4 草案（已由 v1.6 取代）。
> **v1.4 变更**（二期 B 开工）：二期 B 按 B1~B6 / A1~A2 同款双 Agent 流水线执行，细化为三个子切片 S1~S3（见 §9）；S2 明确解锁 **product → generate 单图直出连线通道**（官方 Skill「单图快速出片」要求直连，见 §5.2 增补），其余连线契约不变。
> **v1.1 变更**（一期 A 实机验收后反馈返工）：① 设计语言从深色夜舱改为 **初音青 × Miroa 浅色工作室风**（对齐参考稿：浅色画布/白卡/圆角/柔和阴影）；② 定位从电商带货扩为**多元化创意工作室**（节点改名「素材/脚本/视频生成」，新增 `image` 图像生成节点 + 5 类场景模板：带货短视频/品牌视觉/短剧分镜/游戏宣传/App 界面）；③ 新增**对话栏**（对齐 Miora 图1 底部大输入卡 + 模板快捷入口，一期 A 一句话落 Brief 节点，接 LLM 编排是一期 B）；④ 剧情短剧顶栏补画布切换入口。
> 本文是画布模式的**唯一规格**，风格对齐 `PLAN.md` / `UPGRADE_PLAN.md`。未写进「要做」的一律不做。
> 决策已锁定（用户拍板，不再讨论）：
> 1. **定位 = 自由创作空间**（不是现有管线的可视化皮肤，是空间范式的新产品）
> 2. **画布库 = tldraw**（最接近 Miora 参考稿的交互形态；接受其商用 License 成本）
> 3. **3D 运镜台必做**（放三期，但契约一期就冻结）
> 4. **MCP 连接器只做接口 + 诚实标注**：伴生服务实际部署才有真实效果，纯前端模式无功能可用，UI 必须如实说明

---

## 0. 一句话

在 WebLockShot 里新增第三个顶层模式：一块 **tldraw 无限画布**。用户自由摆放 Agent 节点（商品导入 / 剧本创编 / 分镜预演 / 出片 / 局部重绘 / 3D 运镜），连线成自己的创作流，产物（图 / 视频 / 脚本卡）以卡片形式留在画布上——**对齐 Miora 参考稿的交互形态，底色换成初音未来风深色夜舱**。

与现有两个模式的关系：`App.tsx` 增加 `mode: 'canvas'`，顶栏切换条新增「🎨 Agent 画布」。**sell / drama 零改动、零回归**（116 项测试必须继续全绿）。

---

## 1. 能力对标与复用清单（实现时的「不许重复造」表）

| 画布需要的能力 | 不新写，直接复用 | 说明 |
|---|---|---|
| 视频生成引擎 | `src/media/providers/*`（可灵 / 即梦 / ComfyUI / Mock） | 画布出片节点只是 Provider 的另一个调用方 |
| 生成管线收口 | `src/hooks/useVideoPipeline.ts` | 钱包两阶段事务 / 熔断 / 幂等锁 / 轮询全站只此一份，画布节点同样走它 |
| 剧本 / 分镜智体 | `src/ai/*`（ScriptWriter / ScriptCritic / PromptPolisher）+ 爆款结构库 | 画布「剧本节点」= 同一 AI 层的不同入口 |
| GSAP 分镜预演 | `src/stage/*`（ShotStage / motions 词典） | 画布分镜卡片内嵌 9:16 预演舞台 |
| ComfyUI 反代 | Vite 代理 + 伴生服务反代 | 局部重绘（mask inpaint）走同一条通道 |
| 持久化 | `BackendAdapter`（本地 IndexedDB / rest 双模式） | 画布文档作为新的一种 session 实体存储 |
| 能力位探测 | `/healthz` 能力位模式 | MCP 连接器照抄「探测失败 = 按钮不出现 / 诚实标注」的既有交互 |
| 剪映交付 | `src/export/*` | 画布产物可一键送入现有交付链路 |

---

## 2. 设计语言：初音未来风 × Miora 浅色画布（一期定死，不许每节点各长各样）

对齐 Miora 参考稿的**浅色工作室**形态：浅色画布 + 白色圆角浮卡 + 柔和阴影 + 强调色点缀；强调色沿用初音青体系：

```
--cv-bg:        #f1f7f9      画布浅底（径向叠加白色 + #b7ecf3 柔光）
--cv-panel:     #ffffff      悬浮面板 / 节点卡片（白卡 + 柔和阴影）
--cv-line:      #dbe9ee      画布网格线 / 卡片描边
--miku:         #39c5bb      主色：选中框、连接线、主按钮、Agent 在线徽章
--miku-deep:    #2aa8a0      主色按压态 / 渐变端点
--pink:         #ff7eb6      强调色：批判/质检节点、失败态、图像生成/局部重绘
--halo:         #7ec8e3      信息提示 / 次级链接
--ink:          #16323f      正文（与 sell 模式 --ink 同源）
--mute:         #5b7a86      弱文本（与 sell 模式 --mute 同源）
```

- 字体沿用 `--display`（M PLUS Rounded 1c）/ `--body`（Noto Sans SC），圆角胶囊徽章延续 mast-slate 的气质
- 节点卡片：白卡 + 顶部一条 4px 的 Agent 身份色条（素材/脚本/生成=miku、图像/重绘=pink、信息=halo、运镜=teal-deep），状态徽章复用熔断徽章三态视觉
- **对话栏**（对齐 Miora 图1）：画布底部居中悬浮大输入卡（圆角 18px + 抬升阴影，聚焦时初音青聚焦环）+ 下方场景模板 chips（带货短视频/品牌视觉/短剧分镜/游戏宣传/App 界面）+ 诚实标注一行
- tldraw 默认工具条样式需深度换肤为上述 token（v5 变量名 `--tl-color-*`）；画布背景网格用 `--tl-color-grid`
- `prefers-reduced-motion: reduce` 时关闭悬浮过渡动效

---

## 3. 数据契约（一期冻结，二/三期只扩不破）

```ts
// 画布文档：作为新 session 实体经 BackendAdapter 持久化
type CanvasDoc = {
  id: string
  version: 1
  name: string
  nodes: CanvasNode[]          // 业务节点（tldraw shape 的 meta 承载）
  edges: CanvasEdge[]          // 连线 = 数据流向（A 的产物 → B 的输入）
}

type CanvasNodeKind =
  | 'brief'        // 需求/一句话 brief（对话栏可直接生成，meta.text 承载文本）
  | 'product'      // 素材导入（商品图/参考图/视频/链接统一入口）
  | 'image'        // 图像生成（ComfyUI 文生图/图生图，二期）
  | 'script'       // 脚本创编（ScriptWriter + Critic，带货/剧情/品牌契约路由）
  | 'storyboard'   // 分镜预演（ShotStage 内嵌 9:16）
  | 'generate'     // 视频生成（多引擎 Provider，走 useVideoPipeline）
  | 'edit'         // 局部重绘（二期实现，一期占位节点）
  | 'stage3d'      // 3D 运镜台（三期实现，一期占位节点）
  | 'deliver'      // 成片交付节点（送入剪映草稿链路/直接导出）

type CanvasNode = {
  id: string
  kind: CanvasNodeKind
  x: number; y: number; w: number; h: number     // tldraw 坐标
  meta: Record<string, unknown>                   // 按 kind 各自的 payload（zod 校验）
}

type CanvasEdge = { id: string; from: string; to: string }
```

**约束**：
- 节点业务 payload 一律走 zod 契约校验，非法数据拒绝入画布（延续「不合格则整次失败，不半渲染」传统）
- 产物大资产（视频/图 blob）外移 IndexedDB（复用 `src/persist/assetStore.ts`），画布文档只存引用
- 契约字段只增不改；v2 迁移必须兼容 v1 文档读取

---

## 4. 一期 —— 画布基座 + 自由创作空间（Agent 节点自由编排）

**目标**：Miora 图2 的效果——一块无限画布，Agent 节点摆上去、连起来、跑起来，产物卡片留在画布上。

### 4.1 要做

1. **tldraw 引入与深度换肤**：`tldraw` npm 包接入第三模式；工具条/菜单/选择框按 §2 token 换肤（v5 主题变量 `--tl-color-*`）；画布文档 ↔ `CanvasDoc` 双向序列化（tldraw shape 的 `meta` 承载业务数据）
2. **节点系统**：9 种 `CanvasNodeKind` 的自定义 shape；其中 brief / product / script / storyboard / generate / deliver 六种**一期可用**，image / edit / stage3d 为灰态占位（点击说明「二期/三期开放」）
3. **对话栏**（v1.1 新增，对齐 Miora 图1）：画布底部居中悬浮大输入卡 + 场景模板 chips；一期 A 行为 = 一句话/模板 → Brief 节点上画布（`meta.text` 持久化）；接 LLM 自动编排是一期 B（页内诚实标注）
4. **连线即数据流**：product → script → storyboard → generate → deliver 可自由连线；类型不兼容的连线（如 product → generate）拒绝并提示原因
5. **节点即管线**：每个 Agent 节点内嵌现有 AI 层 / 管线 Hook：
   - script 节点 = ScriptWriter + Critic（可注入画布上游 brief/product 的产物）
   - generate 节点 = 走 `useVideoPipeline`（钱包冻结/核销/退款、熔断徽章、幂等锁全部原样生效）
   - storyboard 节点 = ShotStage 9:16 内嵌预演 + 播放头
6. **产物卡片**：出片成功后视频以画布卡片形态留在原节点旁，可拖拽、可多选、可框选（tldraw 原生能力）；双击进全屏审片
7. **画布持久化**：CanvasDoc 经 BackendAdapter 自动保存/恢复；多标签页 storage 事件同步（对齐钱包既有行为）
8. **顶栏接入**：`WorkbenchHeader` 切换条新增「🎨 Agent 画布」；`App.tsx` 增 `mode: 'canvas'` 分支；剧情短剧顶栏补「🎨 切换至 Agent 画布」入口（v1.1 补漏）

### 4.2 一期明确不做

- 局部重绘的可用实现（只留灰态节点）
- 3D 运镜台（只留灰态节点 + 冻结契约）
- MCP 连接器 UI（三期）
- 多人协作、评论、画布模板市场

### 4.3 一期验收

- 空白画布 → 摆 4 节点连线 → 跑通「商品 → 剧本 → 分镜 → Mock 出片」全链路，钱包账目与 sell 模式逐分一致
- 刷新页面画布原样恢复；sell / drama 两模式零回归（`npm test` 全绿）

---

## 5. 二期 —— 指哪改哪 + Skill 沉淀 + 记忆

**目标**：Miora 图3 / 图4 / 图5——框选改图、工作流沉淀、越用越懂你。

### 5.1 指哪改哪（局部重绘）

1. **框选 / 笔刷出 mask**：选中画布上的图片/视频帧产物 → 进入涂抹模式（笔刷 + 矩形框选两种），导出 mask 图（Konva 或 Canvas2D 实现，tldraw 内嵌覆盖层）
2. **自然语言修改**：mask + 一句修改指令 → 编译成 ComfyUI inpaint 工作流（FLUX Fill / Wan 系列按已接入的工作流适配）直连重绘；无 ComfyUI 时灰态并诚实标注
3. **重绘不重生**：只替换选中区域，产物版本以「版本堆叠卡片」留在画布（可回退）
4. 视频帧级重绘一期只做**单帧定格重绘后回贴**，不做时序一致性修复（写进不做清单）

### 5.2 Skill 沉淀（工作流复用）

1. **画布区域 → Skill 包**：框选一组节点 + 连线 + 参数，导出为 Skill manifest（JSON：节点拓扑 + zod 校验过的参数槽位 + 输入/输出声明）
2. **一键复用**：导入 Skill 包 → 画布上重建节点组，只要求用户填新输入（换商品图/换 brief），其余参数延续
3. 预置 2 个官方 Skill：**六步爆款带货流**（现有管线拓扑）、**单图快速出片**（product → generate 直连）
   - **v1.4 增补（product → generate 直连通道）**：`CANVAS_EDGE_COMPAT` 扩展允许 `product → generate`；generate 节点在**仅有 product 上游（无 storyboard）**时进入「单图直出」模式——以商品标题为提示词走 Mock/演示引擎单镜生成，UI 如实标注「单图直出 · 演示引擎」，真实引擎（可灵/即梦）单图直出待真实环境（同主模式边界）。一期 §4.1-4 中「product → generate 拒绝」的示例自二期 B 起仅指**其他非法连线**场景

### 5.3 记忆系统（结构化，不玄学）

1. 伴生服务在线 + `WLS_STORAGE=sqlite` 时：记录用户的品类偏好、常用结构/钩子、历史胜率（**复用回流看板的 Laplace 聚合，不另造一套**），script 节点采样时自动加权并**在节点上展示「本条建议来自你的历史数据」**
2. 纯前端模式：记忆降级为 localStorage（只存偏好，不存跨设备）并在设置里如实标注能力边界
3. 记忆可在设置中查看 / 清除（隐私诚实）

### 5.4 二期验收

- 选中出片图 → 笔刷涂抹商品背景 → 输入「换成大理石台面」→ ComfyUI 重绘成功，版本卡可回退
- 导出六步爆款 Skill → 新画布导入 → 换一张商品图重跑同拓扑成功
- 记忆面板可查看/清除，纯前端模式标注诚实

---

## 6. 三期 —— 3D 运镜台 + MCP 连接器（v1.6 重新锚定：以 Miora 参考稿 1:1 复刻为第一目标）

> v1.6 变更（用户拍板）：三期以 `C:\Users\v_chchsli\Desktop\Miroa_Refer` 参考稿 **1:1 复刻为第一目标**；自身特色（sell 生态的运镜词典/深度图等）**不进画布**。原 §6 的「运镜词典编译」「深度图导出」已按此砍掉。细化为 C0 + 素体 Spike + E1/E2 + D1~D4（见 §9）。

### 6.1 3D 运镜台（复刻 Miora 图7，全屏页形态）

1. **形态**：独立全屏页（左上「← 3D 运镜台」返回画布），由 `stage3d` 节点双击进入（复用产物卡全屏审片交互），非画布内嵌小节点
2. **布局四件套 1:1**：左栏（场景搜索/场景/角色树/模型/相机机位）+ 右栏属性面板（名称/位置 XYZ/旋转 XYZ/缩放 XYZ 带锁/8 色板/基础-姿势 tabs）+ 底部中央工具条（移动/加人物/加几何体/加机位/框选等）+ 顶中「导演视角 / + 新增机位」+ 右上「重置视角」
3. **视口**：无限网格地面 + 白色无限背景
4. **素体**：写实 glTF 人体模型（骨骼绑定支撑「姿势」tab）；候选 three.js Xbot/Ybot / quaternius / Mixamo；**开工前先做资产 Spike（许可核查 + 观感 + 骨骼能力）**
5. **摆台不耗积分**：本地实时渲染，不调生成 API，不扣灵感币（对齐参考稿文案）
6. **全景图导入**换环境背景

### 6.2 出片衔接（B+D 组合 + C 升级口，用户拍板）

- **导出物** = 机位帧序列：每帧 = 渲染图 + 相机参数 + 运镜轨迹结构化数据 + 运镜文字描述
- **B**：单机位首尾帧 + 分段运镜描述 → 直送 generate 节点（图生视频：参考底图 + 文字）
- **D**：多机位帧序列整组 → storyboard 节点（分镜列表，运镜意图落 shot.motion 字段——画布分镜契约的标准字段，非 sell 特色）
- **C 升级口**：轨迹存结构化数据（不丢信息），未来 Provider 放开运动控制 API 时从同一数据升级，不返工

### 6.3 MCP 连接器（复刻 Miora 图6，接口 + 诚实标注）

1. 画布「连接器」面板 1:1：推荐连接器卡片网格（Notion/腾讯文档/Airtable/Linear/GitHub/Resend/Brevo 七卡片位）+「添加自定义连接器」入口
2. 伴生服务 `/api/connectors` 路由族（list/auth 回调占位/run），协议层 mock；**本期不引 `@modelcontextprotocol/sdk`、不接真实第三方**（保持零依赖）
3. 诚实标注：卡片展示但标「⚠️ 接口就绪 · 未接入」；纯前端模式「无功能可用」
4. 首批三类目标形态只写文档；`/healthz` 新增 `connectors: 'interface'` 能力位
5. 真实接入 1 个标杆连接器（GitHub/Resend）留为可选项，等用户拍板再做

### 6.4 记忆图谱 + Skill 市场（E 线回炉，对图4/图5，排三期之前）

- **E1 记忆图谱（图4）**：暗色画布记忆图谱可视化（中心节点辐射记忆节点 + 行为记忆气泡 + 图片缩略图 + 「记忆已开启」开关）；底层复用 S3 记录结构 + computeWinRates，纯展示层升级，聚合层不动
- **E2 Skill 市场（图5）**：已安装/未安装分区 + 版本号 + toggle 启停 + 「上传 skill / 通过对话创建技能 / 发布 Skill」三按钮；底层复用 S1/S2 manifest 契约 + 新增「已安装 Skill 库」存储与启停语义

---

## 7. 诚实边界总表（写进 README 与页内，延续项目传统）

| 能力 | 验证层级（做到后如实回填） |
|---|---|
| 画布自由编排 + 节点跑管线（Mock 引擎） | 目标：✅ 纯前端可用 |
| 画布出片（可灵/即梦/ComfyUI 真实引擎） | 目标：⏳ 待真实环境（契约层先行，与主模式同标准） |
| 局部重绘 | 目标：✅ 本机验证（ComfyUI 实连）/ 无 ComfyUI 时灰态诚实标注 |
| 记忆系统 | 伴生服务 sqlite = ✅ 本地验证；纯前端 = 降级并标注 |
| 3D 运镜台预演 | ✅ 本地实时渲染，不耗积分；出片衔接（构图帧 + 运镜意图）目标：⏳ 待真实引擎（契约层先行） |
| MCP 连接器 | ⚠️ **仅接口 + 协议层 mock 单测**；真实效果需实际部署配置，纯前端无功能可用 |

---

## 8. 明确不做（全期）

- 多人实时协作 / 评论 / 画布分享链接
- 视频**时序级**局部修复（只做单帧定格回贴）
- 3D **写实角色定制** / 骨骼动画手动编辑 / 角色训练（v1.6 放宽：允许写实素体模型 + 预置姿势切换，但**不做**逐骨骼手调、不做角色训练、不做动画系统）
- MCP 真实第三方服务的授权与调用实现（本期只留接口 + 诚实标注）
- 把 tldraw 换成自研画布引擎（已锁定 tldraw）
- 在 sell / drama 模式上做任何画布化改造（零回归红线）

---

## 9. 实现阶段与开工口令（v1.6：三期重锚定 + 全切片）

> v1.6 变更：三期以 Miora 参考稿 1:1 复刻为第一目标（见 §6 与下方三期规划表）；执行顺序 C0 + 素体 Spike（并行）→ E1 → E2 → D1 → D2 → D3 → D4。
> 红线（全期有效）：不做多人协作/画布分享；不改 sell / drama 行为；HOW_TO_USE 不动（README 由主控收官时统一更新）。

| 切片 | 内容 | 验收标准 |
|---|---|---|
| **S1 Skill manifest 契约 + 导出** | contract.ts 新增 SkillManifest zod 契约（version / name / nodes[槽位id+kind+相对坐标+参数] / edges[下标] / inputs 输入槽位声明 / outputs 输出声明）；**参数槽位白名单**按 kind 收窄（brief.text / product.title / script.scriptScene，产物类字段一律不入 manifest）；**大资产剥离**（idbref:// / http(s) 产物引用、maskRef、imports 历史不入 manifest——设备本地引用跨设备无意义）；画布框选（tldraw 选中集）→ 提取子拓扑 → 导出 Skill JSON 下载 | ① 契约纯函数（extract/validate/参数槽位剥离/坐标归一化）node --test 单测全过：合法 manifest 通过、非法（缺 name/空 nodes/边下标越界/产物 url 混入）整体拒绝不半渲染；② 画布框选 2+ 节点连线后导出 → JSON 文件拓扑与画布一致、参数槽位正确、产物字段已剥离；③ 框选不含任何 wls-node 时导出按钮诚实禁用/提示；④ oxlint 0 errors + 实机冒烟（真实鼠标路径框选→导出） |
| **S2 导入复用 + 预置 2 官方 Skill** | 导入 Skill JSON → validateSkillManifest → 画布重建节点组（**节点 id 全量重映射**，避免与现有画布冲突；相对坐标落位避开对话栏）；入口节点（inputs 声明）高亮提示「填新输入」，其余参数延续 manifest；产物/大资产字段为空即如实显示未生成；预置 **六步爆款带货流**（brief→product→script→storyboard→generate→deliver）与**单图快速出片**（product→generate 直连，走 §5.2 v1.4 增补的单图直出通道，generate 节点支持仅有 product 上游的单镜演示生成 + 诚实标注） | ① 导入六步 Skill → 新画布重建 6 节点 5 边，拓扑/场景参数与 manifest 一致；② 填新输入（换商品标题）→ script/storyboard/generate（Mock 单图直出/分镜链路）可跑通；③ 导入非法 JSON 整体拒绝并提示原因（zod 中文 reason）；④ 单图快速出片 Skill：product 填标题 → generate 单图直出演示出片 + 标注；⑤ 与现有画布节点共存不冲突（id 重映射）、Ctrl+Z 可整批撤销导入；⑥ 零回归（一期 B 全链路抽查）+ 契约单测 + 实机冒烟 |
| **S3 记忆系统（结构化，不玄学）** | 伴生服务新增 `/api/memory/records`（GET/POST/DELETE，`WLS_STORAGE=sqlite` 时启用，非 sqlite 返回 501，/healthz 能力位 `memory: sqlite\|off`，对齐 tts/render 能力位模式）；记录结构复用 `FeedbackRecordSchema` 形状；**聚合层强制复用 src/domain/feedback.ts 的 `computeWinRates`（Laplace），不另造一套**；script 节点生成时注入 `getWinRateLookup()`（服务端模式：records 从伴生服务拉取后走同一聚合），命中历史数据时节点展示「📊 本条建议来自你的历史数据」徽章；纯前端模式降级本地（回流记录 IndexedDB + 偏好 localStorage）并如实标注能力边界；设置面板新增记忆区块：查看（条数/按结构·钩子·品类胜率）+ 清除（隐私诚实，清除范围明示） | ① 服务端单测：sqlite 模式 records 增/查/清 + 非 sqlite 501 + healthz 能力位；② 聚合复用验证：服务端模式与本地模式产出同一 `computeWinRates` 聚合（单测双路对拍）；③ script 节点注入回流记录后，生成的钩子加权可复现（与 sell 模式 ScriptWriter 采样同源），节点徽章按「有历史数据」如实显隐；④ 无伴生服务/非 sqlite 时 UI 标注「纯前端模式 · 记忆仅存本地」；⑤ 设置面板查看/清除真实可用（清除后胜率回退先验）；⑥ sell / drama 零回归（含回流看板）+ 契约单测 + 实机冒烟 |

每片完成后：开发 Agent 自测（`npm run build` + `npm test` 全绿 + oxlint 0 errors + 真实鼠标路径 Playwright 实测）→ 汇报 → 测试 Agent 独立验收 → PASS 后由主控提交并推送该切片，再进下一片。全部完成后 README 画布能力清单统一更新。

### 二期 B（已完成归档，S1~S3）

> S1 `3d1e9b6` / S2 `cbfe7b5` / S3 `a3806d7` / README v2.3 `dbb9f49`，双 Agent 独立验收全 PASS、零阻塞缺陷。
> 已验证坑归档：tldraw v5 编程式 editor.run 不自动打 history mark（须显式 markHistoryStoppingPoint）；T.jsonValue 不接受 undefined 键值（meta 无值必须整键省略）；生产模式验证前须注销 PWA SW。

### 三期规划（v1.6 重新锚定 Miora 1:1，用户已拍板）

> 决策记录（清单二 5 项，全部采纳主控倾向）：
> ① 生成引擎画布内**隐式**（generate 节点自动按已配引擎，引擎配置藏进设置；sell 工作台保持显式下拉）；
> ② 画布顶栏**不显示钱包余额**，仅出片前弹「将消耗 N 灵感币」确认；
> ③ 连接器先**纯接口 + 诚实标注**，真实标杆接入留可选项；
> ④ 3D 台**严格 1:1**（摆位 + 预置姿势 + 机位 + 关键帧，不做骨骼动画），动作预设留增强项；
> ⑤ 画布首次进入叠**图1 风格开场层**（场景 tab + 大输入 + 连接器条），之后折叠成现有对话栏。
> 必须诚实降级（不 1:1）：演示模式/无 Key 标注、本地存储形态、tldraw License 水印。
> 执行顺序：**C0 + 素体 Spike（并行）→ E1 → E2 → D1 → D2 → D3 → D4**。

| 切片 | 内容 | 验收标准 |
|---|---|---|
| **C0 工具条遮挡修复（已确认，可立即开工）** | 对话栏浮层（底部居中）完全遮住 tldraw 底部工具条 10 按钮（一期 B 遗留）。方案：对话栏一键收起（折叠右下小胶囊，点击展开还原）+ 收起态工具条完整可点；CSS 层核对层叠/避让；不触碰 sell/drama | ① 真实鼠标逐一点击工具条 10 按钮可用；② 收起→展开往返输入内容与模板 chips 不丢；③ 收起态不残留点击热区；④ npm test 全绿 + oxlint 0 errors + 实机冒烟 |
| **Spike 素体模型选型（已完成，2026-09-10）** | 结论（用户拍板 **C：两者都要**）：① 默认素体 = **Quaternius Universal Animation Library 通用人形角色**（CC0，可随仓库分发，放 public/models/ 懒加载不进 JS chunk）；② **「导入自定义模型」入口**（用户自备 Mixamo 等模型，UI 诚实标注「模型文件由用户自行获取，许可随用户自负」——Mixamo TOS 禁再分发原始文件，故不内置）；③ 姿势实现 = **骨骼旋转参数化**（预置姿势=关节旋转集纯数据，可 zod 序列化入 meta 契约；实测手臂 ±65°/坐姿 +85°X/行走步态成立）；④ R3F v9 与 React 19.2.8 兼容已验证（registry 实查）；⑤ mannequin.js 实为 GPL-3.0（排除）；「写实+CC0+已绑骨」现成资产市场实测不存在，不再检索 | 选型已定，D1 可开工；D1 落地时下载 Quaternius 包实测骨骼命名/单角色包体 |
| **E1 记忆图谱（图4 回炉，三期之前）** | 暗色画布记忆图谱可视化：中心节点辐射记忆节点（图片缩略图 + 行为记忆气泡）+「记忆已开启」开关；底层复用 S3 记录结构 + computeWinRates（纯展示层升级，聚合层不动） | ① 图谱视图与图4 形态对齐（中心辐射 + 气泡 + 缩略图）；② 记忆节点数与内容与真实记录一致；③ 开关如实控制是否采集；④ 与 S3 设置面板双入口并存；⑤ 契约/聚合零回归 + 实机冒烟 |
| **E2 Skill 市场（图5 回炉，三期之前）** | 已安装/未安装分区 + 卡片（图标/名称/版本/下载量/toggle 启停）+「上传 skill / 通过对话创建技能 / 发布 Skill」三按钮；底层复用 S1/S2 manifest 契约 + 新增「已安装 Skill 库」存储与启停语义 | ① 市场页形态对齐图5；② 已安装列表与真实导入过的 Skill 一致、toggle 启停生效；③ 通过对话创建技能入口可用（接 B6 编排导 Skill 既有能力）；④ 导入 Skill 后市场页同步可见；⑤ 契约零回归 + 实机冒烟 |
| **D1 3D 运镜台基座（图7 1:1）** | three.js + @react-three/fiber(v9, React19) + drei 独立 chunk 懒加载；stage3d 双击进全屏页；布局四件套 1:1（左栏/右属性面板/底部工具条/导演视角+重置视角）；素体 = Spike 选型：**默认 Quaternius（CC0 随仓库分发）+「导入自定义模型」入口（用户自备，诚实标注许可自负）**；位置/旋转/缩放（带锁）/8 色板；无限网格地面；全景图导入；全程本地渲染 0 灵感币 | ① 全屏页布局与图7 四件套对齐；② 素体拖拽摆位/XYZ/色板真实鼠标可用（含导入模型加载）；③ 摆台状态持久化（meta 契约 zod+单测）；④ 3D chunk 不进主包（构建核对）；⑤ 无 WebGL 灰态诚实降级；⑥ 实机冒烟 |
| **D2 姿势 + 多机位 + 关键帧（图7 1:1）** | 「姿势」tab 预置姿势库（骨骼旋转）；多机位自由添加/切换（导演视角↔机位视角，独立焦距/高度/角度）；时间轴关键帧录制（位置/朝向/FOV）+ 播放预览轨迹；「摆台不耗积分」标注 | ① 预置姿势切换真实可用（骨骼姿态变化）；② ≥2 关键帧录制 → 播放轨迹平滑插值；③ 机位/关键帧持久化（zod+单测）；④ 实机冒烟 |
| **D3 出片衔接（B+D+C 口，图7 语义）** | 导出物 = 机位帧序列（渲染图 + 相机参数 + 轨迹结构化数据 + 运镜文字）；B=单机位首尾帧+分段描述直送 generate（图生视频）；D=多机位帧整组送 storyboard（运镜意图落 shot.motion）；C 升级口=轨迹结构化数据落契约层（不丢信息，未来 Provider 放开运动控制 API 时升级） | ① 3D 台导出 → generate 收到首尾帧+运镜文字，演示引擎可出片 + 诚实标注；② 多机位帧整组送 storyboard → shot.motion 落位正确；③ 轨迹结构化数据契约 zod+单测（C 口）；④ 不引入 sell 运镜词典/深度图；⑤ 零回归 + 实机冒烟 |
| **D4 连接器面板（图6 1:1）** | 画布「连接器」面板 1:1：推荐连接器卡片网格（7 卡片位）+ 自定义添加；伴生服务 /api/connectors（list/auth 占位/run，协议 mock，不引 SDK）；/healthz `connectors:'interface'`；诚实标注（未接入/纯前端无功能）；三类目标形态文档 | ① 面板形态对齐图6 卡片网格；② 路由协议层 mock 单测；③ healthz 能力位 + 前端两态如实渲染实机验证；④ 文档章节交付；⑤ 零回归 |

### 二期 A（已完成归档，A1~A2）

| 切片 | 内容 | 验收标准 |
|---|---|---|
| **A1 mask 编辑器 + edit 节点蜕壳** | edit 节点接通 asset 上游（image/video 均可，视频取单帧定格）；节点内嵌 mask 覆盖层（Canvas2D：笔刷涂抹 + 矩形框选两种模式，粗细可调，可清空重涂）；「导出 mask」产白=重绘区的 mask PNG（与源图同尺寸）走 assetStore 落档 | ① asset 卡连入 edit 节点 → 节点内显示源图并可涂抹，笔刷/矩形/清空真实鼠标可用（控件级 stopPropagation 约定）；② 导出 mask 后 meta.maskRef（idbref）+ meta.sourceRef 落盘，F5 可恢复涂抹结果重新编辑；③ mask PNG 尺寸与源图一致、重绘区为白色；④ 视频/非图产物连入时单帧定格 + 诚实标注「单帧重绘回贴，非时序修复」；⑤ 契约单测 + 实机冒烟 |
| **A2 重绘链路 + 版本堆叠卡** | mask + 指令 → ComfyUI 图像 inpaint 工作流（新增图像 Provider 路径：/upload/image 上传源图+mask → /prompt → 轮询 → /view 取回）；无 ComfyUI 时**演示重绘**兜底（客户端按 mask 区域做可见色彩变换，标「🧪 演示重绘 · 非真实生成」）；产物版本堆叠在 asset 卡（meta.versions 数组，可回退切换，当前版本高亮）；edit→asset（或直接更新原卡）回流 | ① 演示模式全链路：涂抹 → 输入指令 → 重绘 → 新版本入堆叠、版本间切换回退可用；② ComfyUI 在线（/healthz 或 testConnection 探测）时走真实 inpaint，离线时灰态+演示兜底诚实标注；③ 重绘产物 url 契约同 B4（idbref，blob: 拒）；④ 多轮重绘版本只增不乱、回退后可再重绘；⑤ 零回归（一期 B 全链路抽查）+ 实机冒烟 |

二期 A 交付后 README 更新能力清单（HOW_TO_USE 仍不动）。

### 一期 B（已完成归档，B1~B6）

> 执行模式（用户拍板）：**双 Agent 流水线** —— 开发 Agent 逐片实现，每片完成即由测试 Agent 验收
> （build + npm test 全绿 + Playwright 实机冒烟），验收通过后**提交并推送**该切片，再进下一片。
> README 在 B1~B6 全部完成后统一更新画布章节；HOW_TO_USE 暂不动。

| 切片 | 内容 | 验收标准 |
|---|---|---|
| **B1 连线即数据流** | 箭头边落盘 CanvasDoc.edges + 类型兼容校验（不兼容连线拒绝并说明原因）+ 连线删除同步 + 契约单测 | ① 画布上建 product→script 箭头，防抖落盘后 edges 非空且方向正确；② 删除箭头/节点后 edges 同步清理；③ 非法连线（如 storyboard→product）被拒并提示；④ node --test 新增边契约用例全过；⑤ sell/drama 零回归 |
| **B2 脚本创编节点** | script 节点蜕壳：内嵌 ScriptWriter + Critic（带货/剧情/品牌契约路由），上游 Brief（meta.text）/素材产物注入；节点内表单 + 生成 + 评分展示 | ① 对话栏落 Brief → 连 script → 节点内可生成脚本（Mock/演示模式可跑，真实 LLM 需 Key）；② Critic 评分展示；③ 脚本产物存节点 meta 并持久化；④ 契约单测 + 实机冒烟 |
| **B3 分镜预演节点** | storyboard 节点蜕壳：ShotStage 9:16 内嵌 + 播放头；script 产物一键转分镜 | ① script 成功后可生成分镜并内嵌预演播放；② 分镜 JSON 存 meta 持久化、刷新可恢复；③ 画布 6+ 节点时滚动/缩放不掉帧明显劣化；④ 实机冒烟 |
| **B4 出片生成 + 产物卡片** | generate 节点蜕壳：走 useVideoPipeline（钱包冻结/熔断/幂等原样生效）+ Mock 引擎出片 + 视频产物卡留画布（大资产进 assetStore/IndexedDB） | ① Mock 出片全链路画布内跑通，钱包账目与 sell 模式逐分一致；② 视频卡可播放、可拖拽、持久化恢复；③ 生成中状态徽章/熔断徽章正确；④ 实机冒烟 |
| **B5 素材导入 + 成片交付** | product 节点蜕壳（图片/视频/链接三入口，组件从六步工作台**抽取复用**不改写）+ deliver 节点蜕壳（剪映 zip 链路复用） | ① product 上传图片入画布产物卡；② deliver 可产出剪映草稿 zip（纯前端打包路径）；③ sell 工作台六步功能零回归（UI 测试全过）；④ 实机冒烟 |
| **B6 对话栏 LLM 编排** | 一句话 → LLM 理解 → 自动在画布摆出建议拓扑（预填参数），用户确认后逐节点执行；两态诚实标注（真实 LLM / 演示模式） | ① 无 Key 时演示模式自动摆拓扑并标注「演示编排 · 非真实 LLM」；② 有 Key 时真实生成 Brief→Script 链；③ 编排失败可撤销（一次 Ctrl+Z 回滚整批节点）；④ 实机冒烟 |

冲突时以 **§3 数据契约** 和 **§1 复用清单** 为准，不扩范围。README 统一更新在 B6 之后。
