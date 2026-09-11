# WebLockShot 完整使用指南与工业化实战手册

> 🌐 **English edition**: [HOW_TO_USE.en.md](./HOW_TO_USE.en.md)

> 本指南旨在帮助电商卖家、带货主播、编导创作者及 AI 视频开发人员，快速掌握 WebLockShot 的核心链路、双工作室工作流、私有化 ComfyUI 算力集成，以及剪映 / CapCut 自动化草稿对齐出片。

---

## 目录
- [（序）介绍与定位](#序介绍与定位)
- [（一）快速上手：免安装在线版 vs 团队私有部署](#一快速上手免安装在线版-vs-团队私有部署)
- [（二）电商全链路六步爆款工作流](#二电商全链路六步爆款工作流)
  - [Step 0：商品信息多模态导入](#step-0商品信息多模态导入)
  - [Step 1：5 大爆款结构与黄金 3 秒钩子选择](#step-15-大爆款结构与黄金-3-秒钩子选择)
  - [Step 2：双 Agent 剧本编导与对立面评审](#step-2双-agent-剧本编导与对立面评审)
  - [Step 3：9:16 GSAP 动态分镜视觉预演](#step-3916-gsap-动态分镜视觉预演)
  - [Step 4：视觉提示词工程编译](#step-4视觉提示词工程编译)
  - [Step 5：串行任务队列与神经渲染调度](#step-5串行任务队列与神经渲染调度)
  - [Step 6：连续审片、TTS 口播与剪映草稿对齐导出](#step-6连续审片tts-口播与剪映草稿对齐导出)
- [（三）双独立工作室模式](#三双独立工作室模式)
  - [模式 A：单 Agent 极速直出模式](#模式-a单-agent-极速直出模式)
  - [模式 B：多 Agent 协同编导研讨室](#模式-b多-agent-协同编导研讨室)
- [（四）视频供应商配置与 ComfyUI 自建私有算力指南](#四视频供应商配置与-comfyui-自建私有算力指南)
  - [1. 快手可灵 (Kling) API 直连](#1-快手可灵-kling-api-直连)
  - [2. 字节即梦 (Jimeng) API 直连](#2-字节即梦-jimeng-api-直连)
  - [3. ComfyUI 本地/局域网私有 GPU 算力集群（Wan 2.1 / CogVideoX）](#3-comfyui-本地局域网私有-gpu-算力集群wan-21--cogvideox)
- [（五）剪映 / CapCut 电脑版草稿工程导入与声画自动对齐实操](#五剪映--capcut-电脑版草稿工程导入与声画自动对齐实操)
  - [剪映草稿 zip 包导入实操（推荐）](#剪映草稿-zip-包导入实操推荐)
- [（六）数据反馈闭环：回流看板与钩子胜率加权](#六数据反馈闭环回流看板与钩子胜率加权)
- [（七）本地伴生服务部署与剪映草稿一键落盘](#七本地伴生服务部署与剪映草稿一键落盘)
- [（八）工业级可靠性体系：幂等防抖、状态机与两阶段钱包闭环](#八工业级可靠性体系幂等防抖状态机与两阶段钱包闭环)
- [（九）常见问题与避坑指南（FAQ）](#九常见问题与避坑指南faq)
- [（十）手机端使用：PWA 添加到主屏幕](#十手机端使用pwa-添加到主屏幕)
- [（十一）Docker 生产部署](#十一docker-生产部署)
- [（十二）小程序版轻端](#十二小程序版轻端)

---

## （序）介绍与定位

**WebLockShot** 是一款面向带货短视频与电商视觉创作者的 **多 Agent 闭环短视频生成平台**。

过去创作一条符合平台推流机制的电商爆款短视频，通常面临如下痛点：
1. **创意开销大**：依赖人工编写脚本，不懂前 3 秒黄金完播率套路；
2. **多工具断层**：找商品图、打磨 Midjourney/Sora 提示词、可灵网页生片、下载再拖入剪映手动拼接剪辑，全流程分散低效；
3. **接口资费昂贵且无防重保障**：云端视频 API 动辄几毛到几块钱一次，网络重试或连击经常造成重复扣费；
4. **声画割裂**：生成的视频片段长度固定，与配音解说字幕时长不匹配，人工拉伸音频费时费力。

WebLockShot 实现了全链路整合突破：**从商品卖点输入、爆款结构套用、双 Agent 剧本研讨、9:16 动态预演、自建 ComfyUI / 商业 API 渲染生成，到剪映草稿工程声画字三轨微秒自动对齐，全流程浏览器内闭环！**

### 传统工作流 vs WebLockShot 核心特性对比

| 环节 / 能力 | 传统人工制作模式 | 一般套壳 AI 工具 | WebLockShot 工作台 |
| :--- | :--- | :--- | :--- |
| **爆款规律把控** | 编导凭个人感觉拼凑 | 单一文本粗糙扩写 | **内置 5 大爆款结构套路库 + 黄金 3 秒强对抗钩子库**（Zod 强约束） |
| **脚本编导质量** | 单人盲写，缺乏审校 | 直接输出一段长文本 | **ScriptWriter + ScriptCritic 双智体剧本推演与严苛批判打分** |
| **生片前可控预演** | 脑内想象或黑屏等待 | 无法预演，直接开盲盒 | **9:16 GSAP 动态分镜舞台，毫秒级模拟镜头运镜与转场节奏** |
| **渲染算力支持** | 仅能在特定官方网页手动点 | 仅对接 1 家闭源云端 API | **四擎并行**：快手可灵、字节即梦、**ComfyUI 私有显卡 (Wan 2.1)**、Mock 实验画布 |
| **出片成本** | 商业 API 接口费昂贵 | 充值代币高溢价抽成 | **0 接口费自由**：直连本地 RTX 4090 / A100 ComfyUI，边际成本趋向于 0 |
| **防重与资金安全** | 连击重复扣费，失败不管 | 失败扣点不予返还 | **工业级两阶段事务钱包**（预冻结 → 成功核销 / 失败回滚）+ SHA-256 幂等防抖 |
| **剪辑工程交付** | 人工逐轨拖拽、切片对齐 | 仅提供独立 MP4 下载 | **剪映 / CapCut 草稿工程直出**：视频轨 + 旁白轨 + 花字字幕轨微秒级自动化对齐 |

---

## （一）快速上手：免安装在线版 vs 团队私有部署

### 1. 纯前端零配置开箱体验
- 在线访问：https://qwqcool.github.io/WebLockShot/
- **零服务端依赖、免注册登录**：所有密钥安全保存在浏览器本地 `sessionStorage`，绝不上传任何第三方服务器，保护企业数据隐私。
- **免 Key 畅玩**：内置 Mock 实时画布录制引擎与 0-Key AI 规则模板引擎，无需充值即可体验完整生产链路。

### 2. 本地自建与二次开发
适合拥有本地高配 GPU（RTX 3090/4090/A100）或需内网部署的团队：
```bash
# 克隆仓库
git clone https://github.com/QWQcool/WebLockShot.git
cd WebLockShot

# 安装依赖
npm install

# 启动本地开发服务 (支持 ComfyUI 自动反向代理)
npm run dev
```
启动后在浏览器打开 `http://localhost:5173` 即可进入工作台。

---

## （二）电商全链路六步爆款工作流

点击顶部导航的 **「🛒 电商全链路工作流」**，即可按科学工业化步骤执行生成。每一个环节均经过百万级推流数据检验与严格 Schema 约束。

### Step 0：商品信息多模态导入

![Step 0 商品信息多模态导入与卖点归纳](./screenshots/01_step0_product_import.png)

- **链接导入**：输入电商主图链接，系统如实归档并引导填写核心差异化卖点；
- **图片导入**：支持上传高清商品白底图或透底图，内置 9 款 3C、美妆、服饰大厂级 Mock 预设图一键选用；
- **参考视频导入**：支持上传本地爆款对标视频片段，内置 Canvas 自动抽帧引擎。

### Step 1：5 大爆款结构与黄金 3 秒钩子选择

![Step 1 5大爆款结构套路与黄金3秒钩子库](./screenshots/02_step1_template_hook.png)

针对短视频平台推流算法，内置经百万播放验证的 5 套 6 镜带货套路：
1. **痛点开场型 (Pain-Solution)**：反常识开场 → 痛点共鸣放大 → 产品破局 → 核心功能微距 → 信任凭证背书 → 强引导限时下单；
2. **效果反差型 (Contrast-Shock)**：震撼对比 → 揭秘关键机理 → 深度实测 → 体验升级 → 资质打消顾虑 → 行动号召；
3. **沉浸开箱型 (Sensory-Unboxing)**：视听微距开箱 → 材质触感细节 → 交互仪式感 → 场景融入 → 性价比锚点 → 福利促单；
4. **短剧场景植入型 (Drama-Insert)**：人物生活矛盾冲突 → 戏剧化窘境 → 救场神器亮相 → 危机化解 → 情感共鸣 → 购买指引；
5. **价格锚点型 (Price-Anchor)**：大牌天价对比 → 打破暴利黑幕 → 极致做工对标 → 溯源源头成本 → 超值特惠释放 → 锁单催促。

### Step 2：双 Agent 剧本编导与对立面评审

![Step 2 双 Agent 剧本编导与对立面评审雷达打分](./screenshots/03_step2_script_critic.png)

- **编导智体 (ScriptWriter)**：结合商品卖点与所选爆款套路，自动创作符合竖屏短视频传播节奏的 6 镜分镜台词与画面描述。
- **质检智体 (ScriptCritic)**：化身挑剔的平台质检员，从「3 秒停留率、卖点可视化、完播节奏、合规风险」4 个维度严苛打分（0~100 分），并给出详尽的诊断雷达图与具体修改建议。

### Step 3：9:16 GSAP 动态分镜视觉预演

![Step 3 9:16 GSAP 动态分镜视觉预演舞台](./screenshots/04_step3_gsap_storyboard.png)

- 在向昂贵算力派发任务前，WebLockShot 的 `sell-stage` 动态舞台会基于 GSAP 动画引擎进行 9:16 全真视觉模拟；
- 能够直观预览每个镜头的景别（特写、中景、远景）、推拉摇移运镜动势、卖点文字弹幕浮现节奏。

### Step 4：视觉提示词工程编译

![Step 4 视觉提示词方案工程编译与参数微调](./screenshots/05_step4_visual_compiler.png)

- 系统自动将分镜剧本编译为高精度中英文双语视觉提示词（Positive Prompt & Negative Prompt）；
- 自动规范画幅（9:16）、镜头秒数（3~6 秒）、渲染参数（8K、光影质感、运镜轨迹与物理防畸变约束）。

### Step 5：串行任务队列与神经渲染调度

![Step 5 串行任务调度队列与进度实时监控](./screenshots/06_step5_render_queue.png)

- 单机串行任务调度引擎自动调度各镜头任务；
- 支持快手可灵、字节即梦、**ComfyUI 私有集群** 或 Mock 本地录制出片；
- 具备实时任务排队进度监控、单镜头独立失败重试与错误精准上报。

### Step 6：连续审片、TTS 口播与剪映草稿对齐导出

![Step 6 连续审片播放器、自适应 TTS 口播与剪映草稿导出](./screenshots/07_step6_deliver_player.png)

- 6 镜视频无缝连播审片播放器，支持全屏预览与单镜头逐一审阅；
- **智能 TTS 配音**：内置语速自适应算法，自动根据镜头秒数缩放台词语速，确保台词在镜头结束前精准收尾；
- **剪映草稿工程直出**：一键导出对齐好的 `draft_content.json`，或直接下载含全部素材的完整 zip 包（详见「（五）剪映草稿 zip 包导入实操」）；
- 素材失效时（页面刷新导致本地缓存丢失）会显示明确的失效占位提示，而非死链播放器。

---

## （三）双独立工作室模式

除了标准的六步全链路外，顶部工具栏还提供针对快速单挑和复杂编导的双工作室：

### 模式 A：单 Agent 极速直出模式

![模式 A 单 Agent 极速直出工作室](./screenshots/08_single_agent_studio.png)

适合单镜头快速实验与电商图生视频（Image-to-Video）：
- **精选灵感库**：内置 3C 数码金属光泽、美妆水润精华露微距、潮流穿搭光影等高转化提示词预设；
- **AI 智能运镜润色**：输入简略构思（如“吹风机快速吹干水滴”），AI 自动扩写为运镜、布光、景深齐全的电影级 Prompt；
- **多模态参考素材面板**：
  - **参考图片**：支持拖拽上传本地图，支持点击九宫格快速载入高清 Mock 图，支持**双击灯箱无损放大预览**；
  - **参考视频**：支持上传本地运镜视频片段，提取动作参考（Motion Mimic）。
- **时长自由调节**：支持 5s、10s、15s 预设切换，或在微调框中键入 1~60 秒自定义时长。

### 模式 B：多 Agent 协同编导研讨室

![模式 B 多 Agent 协同编导研讨室](./screenshots/09_multi_agent_studio.png)

适合高定短片与复杂多镜头影视级创作：
- **两种推演模式（诚实标注，绝不伪装）**：
  - **真实推演**：在「⚙️ API 设置」配置大模型 Key 后，四智体由真实 LLM 结构化推演——编导 → 运镜 → 质检 → 调度依次产出，质检评分为真实差异化评分（0~100）；
  - **演示动画模式**：未配置 Key 时，时间线首条消息与工程单徽章会明确标注「🧪 演示动画模式 · 评分非真实」，推演内容为预编排脚本，绝不伪造质检评分。
- **真实推演角色分工**：
  1. 🎬 **导演 Agent (Director)**：负责整体视觉调性、叙事弧线与核心抓手；
  2. 🎥 **运镜 Agent (Cinematographer)**：设计机位走位、焦段切换与动态打光；
  3. ⚖️ **质检 Agent (Critic)**：审输出风险并给出带扣分理由的真实评分；
  4. ⚡ **调度 Agent (Dispatcher)**：综合三方成果合成终极提示词并派发至渲染引擎。
- **轮询窗口可调**：顶部「轮询窗口」下拉（2/5/10/20 分钟），超时自动全额退款。

---

## （四）视频供应商配置与 ComfyUI 自建私有算力指南

![API 配置与 ComfyUI 私有算力 GPU 探测](./screenshots/10_token_settings_comfyui.png)

点击右上角 **「⚙️ API 设置」** 即可完成各生成渠道的配置。

### 1. 快手可灵 (Kling) API 直连
- 申请快手可灵官方开发者平台 API 密钥（Access Key ID 与 Secret Key）；
- 填入对应输入框并选择首选生片时长；
- **两种鉴权形态**（M2 契约升级）：
  - 填入裸 Key 字符串 → Bearer 直传模式（历史行为）；
  - 填入 JSON `{"ak":"你的AK","sk":"你的SK"}` → 客户端按官方文档自动签发 JWT（HS512，`iss/exp/nbf` 载荷，请求头直接携带 token，无需 Bearer 前缀），签名实现已按官方向量做契约测试锁定；
- 生成计费：在虚拟钱包中约 10 灵感币/镜头。

### 2. 字节即梦 (Jimeng) API 直连
- 填入即梦开放平台 API Key 与端点地址；
- **两种鉴权形态**（M2 契约升级）：
  - 填入裸 Key 字符串 → Bearer 直传模式（历史行为）；
  - 填入 JSON `{"ak":"你的AK","sk":"你的SK"}` → 客户端按火山引擎 V4 规范逐请求计算 HMAC-SHA256 签名（`X-Date` / `X-Content-Sha256` / `Authorization` 三头），签名实现已按官方向量做契约测试锁定；
- 生成计费：在虚拟钱包中约 8 灵感币/镜头。

### 3. ComfyUI 本地/局域网私有 GPU 算力集群（Wan 2.1 / CogVideoX）
这是 WebLockShot 最强力的工业化亮点——**连接您自己的显卡算力，享有 0 API 费用无限畅做短视频！**

#### 步骤 1：本地启动 ComfyUI
确保您的 ComfyUI 支持外部或局域网访问，启动命令行必须加上 `--listen` 参数：
```bash
python main.py --listen 127.0.0.1 --port 8188
```
*(如部署在局域网 GPU 服务器，可使用 `--listen 0.0.0.0`)*

#### 步骤 2：推荐模型依赖
- **阿里 Wan 2.1 (WanVideo I2V)**：当前开源图生视频领域极度出色的模型，支持 14B / 1.3B 参数；
- **智谱 CogVideoX-5B**：擅长大幅度动作动力学与电影感光影；
- **Stability SVD-XT**：轻量化微距商品展示。

#### 步骤 3：在 WebLockShot 中绑定并一键探测
1. 打开右上角 **「⚙️ API 设置」**；
2. 视频提供商选择 **「ComfyUI 自建/私有算力 (0接口费)」**；
3. 输入实例地址（本地通常保持默认 `http://127.0.0.1:8188` 即可，Vite 会自动通过 `/api/comfyui` 反代穿透跨域）；
4. 点击 **「🔍 测试连接 (Ping GPU)」** 按钮；
5. 系统将调用 `/system_stats` 接口，瞬间返回显卡型号（例如 `NVIDIA GeForce RTX 4090`）以及当前剩余可用显存（VRAM），确认连通即可畅享无成本生片！

---

## （五）剪映 / CapCut 电脑版草稿工程导入与声画自动对齐实操

在全链路最后一步 **「✨ 审片交付」**，点击 **「📥 导出剪映电脑版草稿工程 (draft_content.json)」**：

### 剪映草稿对齐原理
WebLockShot 导出的 `draft_content.json` 是标准的 CapCut/剪映工程格式：
1. **三轨微秒对齐 (1s = 1,000,000us)**：
   - `track_video` (视频主轨)：6 镜视频无缝顺排；
   - `track_audio` (旁白配音轨)：每个镜头的配音与视频起始点、终止点微秒严密吻合；
   - `track_text` (花字字幕轨)：带货爆款花字，第 1 镜黄金钩子预设黄色高亮与更大字号。
2. **自适应防黑帧**：精确计算 `source_timerange` 与 `target_timerange`，杜绝任何黑帧或音频爆音重叠。

### 如何导入剪映电脑版：
1. 打开您电脑上的剪映 / CapCut 电脑版，新建一个空白草稿并起名（例如 `吹风机带货`）；
2. 找到剪映本地草稿保存目录：
   - **Windows**：`C:\Users\<用户名>\AppData\Local\JianyingPro\User Data\Projects\com.lveditor.draft\`
   - **macOS**：`~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/`
3. 进入对应工程名字的文件夹，将 WebLockShot 下载的 `draft_content.json` 替换原有文件；
4. 重新在剪映中打开该项目，所有分镜视频、配音解说与爆款字幕已在时间线上精确对齐就绪，直接导出高清成片！

### 剪映草稿 zip 包导入实操（推荐）

> 推荐优先使用 zip 包方式：一次拿到「工程文件 + 全部已生成视频素材 + 使用说明」，无需手动逐个下载素材。

在「✨ 审片交付」页点击 **「📦 下载完整草稿 zip 包 (含素材)」**：

![剪映草稿 zip 包下载按钮](./screenshots/13_jianying_zip_export.png)

zip 包内容：
- `draft_content.json` / `draft_meta_info.json`：剪映标准草稿工程（包内素材路径已改写为相对路径 `assets/...`）；
- `assets/`：已生成的分镜视频素材（`Shot_N_<镜号>.mp4/webm`）与可选旁白音频（`voice_<镜号>.mp3`）；
- `README-使用说明.txt`：本包专属素材清单（含缺失素材如实列出）与导入步骤。

导入步骤：
1. 解压 `<工程名>_剪映草稿.zip`；
2. 打开剪映电脑版，新建一个空草稿（如 `吹风机带货`），然后关闭剪映；
3. 进入剪映草稿目录（Windows 默认 `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\<草稿名>\`）；
4. 将解压出的 `draft_content.json`、`draft_meta_info.json` 与 `assets/` 文件夹复制进该目录（同名文件覆盖）；
5. 重新打开剪映，三轨对齐的完整工程即可就绪。

> 注：浏览器 Web Speech TTS 无法导出音频文件。若包内缺 `assets/voice_*.mp3`，可自行录制同名旁白放入 assets/，或在剪映中删除空音频片段。

---

## （六）数据反馈闭环：回流看板与钩子胜率加权

WebLockShot 内置「投放 → 回流 → 加权 → 再生成」的数据闭环，让钩子选择从经验主义走向数据驱动。

### 钩子库与元数据路由

5 套爆款结构（痛点提问 / 效果反差 / 沉浸开箱 / 短剧反转 / 价格锚点）连同钩子句式库，被抽取为 **JSON 数据资产**（`src/assets/hooks/structures.data.json`），每套结构带三类元数据：
- **适用品类（categories）**：如 美妆护肤 / 数码潮玩 / 平替好物——ScriptWriter 按商品种类自动路由最匹配的结构模板；
- **情绪轴（emotionArc）**：6 拍各自的情绪锚点（如 焦虑→共鸣→惊喜→专注→信任→紧迫）；
- **历史胜率（baselineWinRate / hookWinRates）**：先验权重，回流数据可实时覆盖。

### 回流看板使用步骤

![回流看板：数据录入与胜率看板](./screenshots/12_reflow_board.png)

1. 点击顶部导航 **「📊 回流看板」**；
2. 在录入表单填写：视频标题、命中的结构模板与钩子（下拉选择）、商品种类、平台的 **3 秒完播率 / 完播率 / 转化数**；
3. 点击 **「📥 录入回流数据」**，数据存入本地 IndexedDB；
4. 下方看板自动按 **结构 / 钩子 / 品类** 三个维度聚合胜率（纯 CSS 条形图，从高到低排序）；
5. 胜率采用 **Laplace 平滑**：`(胜出次数 + 1) / (样本数 + 2)`，其中 3 秒完播率 ≥ 30% 记为一次「胜出」，避免小样本过拟合；
6. 之后每次生成脚本，ScriptWriter 的钩子采样会按真实胜率加权——高胜率钩子被优先选中。

> 数据仅存本地浏览器 IndexedDB，不上传任何服务器。

---

## （七）本地伴生服务部署与剪映草稿一键落盘

纯前端版在 GitHub Pages 上无法直连 ComfyUI 与视频平台 API（跨域限制），也无法替你把草稿写进本地磁盘。**伴生服务**（纯 Node，运行时仅依赖 pino 日志库）解决这两件事，并提供一系列「预留开关」能力（不设置任何 `WLS_*` 环境变量 = 与纯前端现状完全一致的本地默认模式）：

![伴生服务启动与剪映落盘](./screenshots/14_companion_server.png)

### 一行命令启动

```bash
npm run build && npm run start:server    # 默认 http://localhost:5174
# 等价 npx 形态：npx weblockshot
# 自定义参数：node server/weblockshot-server.mjs --port 8080 --dist ./dist --draft-dir ./jianying-drafts
```

Windows 用户可直接双击根目录 **`start-weblockshot.bat`**（自动安装依赖 → 构建 → 启动）。

### 能力清单

| 能力 | 说明 |
| :--- | :--- |
| 静态托管 | 托管 `dist/` 生产构建，打开 `http://localhost:5174` 即用 |
| API 反代 | `/api/kling`、`/api/jimeng`、`/api/comfyui` 三个前缀反向代理，生产环境也能直连 ComfyUI 与视频平台 |
| 剪映草稿落盘 | `POST /api/jianying/draft-zip`（body 为 zip 二进制），自动解压到 `--draft-dir` 指定目录，免去手动解压复制 |
| 语音合成 | `POST /api/tts`：Edge-TTS 合成旁白 mp3 落盘（默认开；`WLS_TTS=off` 关闭），`GET /files/tts/<file>.mp3` 回读 |
| 成片合成 | `POST /api/render`：ffmpeg 合成视频 + 音轨 + 字幕成 mp4（默认 auto 探测；`WLS_FFMPEG=off` 关闭），`GET /files/render/<file>.mp4` 回读 |
| 健康检查（预留） | `GET /healthz` 返回版本 / 存储模式 / uptime / 密钥注入模式 / 能力位（tts、ffmpeg）等 JSON 自观测 |
| 会话存储 API（预留） | `PUT/GET/DELETE /api/sessions/:id`，配合前端 `VITE_BACKEND_URL` 的服务端模式；`WLS_STORAGE=sqlite` 时落盘持久化 |
| LLM 反代（预留） | 设置 `WLS_LLM_TARGET` 后 `/api/llm` 反代至目标 LLM API；未设置返回 501 |
| 密钥注入（预留） | 设置 `WLS_KEYS`（JSON）后反代注入真实密钥头，小程序/无密钥客户端也能出片；未设置 = 透传模式 |
| 结构化日志 | pino JSON 行输出，级别经 `WLS_LOG_LEVEL` 控制 |

> 全部预留开关的环境变量表见主仓 README「🚀 生产部署」章节；本指南末尾「（十一）Docker 生产部署」有一键部署实操。

### 剪映草稿一键落盘实操

**方式 A：工作台内一键落盘（推荐，P1-3 起）**

1. 按上文启动伴生服务；
2. 打开工作台「交付播放器」页，前端会自动探测 `/healthz`——伴生服务在线时，「导出剪映草稿工程」卡片会出现 **📤 发送到伴生服务落盘** 按钮；
3. 点击按钮，前端把完整草稿 zip（含素材）直接 POST 到 `/api/jianying/draft-zip`，服务端自动解压；按钮下方会显示落盘路径（`savedPath`），把该目录（或把 `--draft-dir` 直接指向剪映草稿目录）即可在剪映中打开；
4. 若探测不到伴生服务（纯前端模式），按钮不显示，体验与之前完全一致——用方式 B。

**方式 B：curl 手动落盘**

1. 按上文启动伴生服务（记下启动日志中的「草稿落盘」目录）；
2. 用任意 HTTP 客户端（或 curl）将「📦 下载完整草稿 zip 包」得到的 zip 原样 POST 到 `http://localhost:5174/api/jianying/draft-zip`；
3. 服务返回 `{ ok: true, savedPath: "...", files: [...] }`，按返回的 `savedPath` 路径把内容挪进剪映草稿目录（或直接将 `--draft-dir` 指向剪映草稿目录），打开剪映即可。

### Edge-TTS 语音合成实操（TTS 生成 → 音轨进剪映）

1. 确认伴生服务已启动且 `WLS_TTS` 未设为 `off`（`curl http://localhost:5174/healthz` 应看到 `"tts":"on"`）；
2. 合成旁白：

   ```bash
   curl -X POST http://localhost:5174/api/tts \
     -H "Content-Type: application/json" \
     -d '{"text":"你的旁白台词","voice":"zh-CN-XiaoxiaoNeural","rate":"+10%"}'
   ```

3. 响应中的 `url`（如 `/files/tts/xxx.mp3`）可直接在浏览器打开试听，文件落在 `data/tts/` 目录；
4. 剪映内使用：把 mp3 拖入剪映音频轨，或将其重命名为 `voice_<镜号>.mp3` 放进草稿包 `assets/` 目录，补齐草稿缺失的旁白素材；
5. 进阶：把生成的 mp3 URL 传给 `POST /api/render` 的 `audioUrl`，直接在服务端合成带旁白的成片。

### ffmpeg 服务端成片实操

1. 本机需安装 ffmpeg（Windows：`winget install ffmpeg`；macOS：`brew install ffmpeg`；Docker 镜像已内置），启动后 `/healthz` 应看到 `"ffmpeg":"on"`；
2. 合成成片（视频来源支持本站 `/files/...` 相对路径或公网 http(s) URL）：

   ```bash
   curl -X POST http://localhost:5174/api/render \
     -H "Content-Type: application/json" \
     -d '{"videoUrl":"/files/tts/video.mp4","audioUrl":"/files/tts/xxx.mp3","title":"我的成片"}'
   ```

3. 响应返回 `{ url: "/files/render/render_xxx.mp4", bytes }`，浏览器直接打开 `url` 下载/预览成片；
4. 可选传 `subtitleSrt`（SRT 文本内容）软封字幕轨；同一时间仅允许 1 个渲染任务（忙时 429），单任务默认 10 分钟超时（`WLS_RENDER_TIMEOUT_SEC` 可调）；
5. 安全约束：禁止 `file://` 与内网地址（SSRF 防护），远程下载上限 500MB。

---

## （八）工业级可靠性体系：幂等防抖、状态机与两阶段钱包闭环

为了支撑商业生产环境的稳定性，WebLockShot 构筑了多重安全防护网：

### 1. 任务幂等性与防连击锁 (Idempotency & Debounce)
- **结构化意图签名**：根据规范化 `(intent, shotId, provider, prompt, duration, ratio)` 计算唯一幂等指纹；
- **In-flight 互斥锁**：任务在后台处理期间，拦截一切重复连击，防止并发风暴。

### 2. 状态机流转与边界容错 (FSM & Circuit Breaker)
- **ShotJob 状态机管控**：任务状态严格按 `queued → running → succeeded/failed`（失败后允许 `failed → queued` 重试）流转，由 `JOB_STATUS_TRANSITIONS` 转移表守卫；非法迁移（含 `succeeded` 终态自迁移、越级迁移）直接抛错拦截；
- **自动熔断器 (Circuit Breaker)**：若某一云端 API 连续出现 3 次失败，熔断器自动跳闸保护并阻断同渠道任务，30 秒后自动半开探测；工作室顶栏徽章实时显示「正常 / 熔断保护中 / 半开探测中」（Mock 与 ComfyUI 自建算力免熔断）。

### 3. 虚拟钱包两阶段提交事务 (Two-Phase Commit Wallet)

![工业级虚拟钱包两阶段结算与审计流水中心](./screenshots/11_virtual_wallet.png)

- 顶部导航常驻 **「💰 虚拟钱包」**，钱包采用 **per-refId 冻结账本**（记录每笔冻结的金额/供应商/时间）；
- **阶段 1：预冻结 (Freeze)**：点击生成时，若余额充足，将预估费用移入「任务冻结中」，锁定资金防并发超支；
- **阶段 2A：成功核销 (Settle)**：出片成功后正式划扣冻结款项；
- **阶段 2B：失败回滚 (Refund)**：一旦发生网络中断、接口超时或生成异常，冻结款项全额退回可用余额；
- **凭据安全**：无冻结凭据的核销/退款一律拒绝；同一任务重复结算幂等（不重复扣款）；已核销任务不可再退款；
- **孤儿冻结回收**：页面意外重启后无人认领的冻结款，30 分钟后自动原路退回；
- **多标签页同步**：多开标签页时钱包余额与流水实时一致；
- 具备完整的资金交易收支流水审计明细，支持一键模拟充值与重置体验金。

---

## （九）常见问题与避坑指南（FAQ）

#### Q1：调用本地 ComfyUI 时提示网络错误或连接超时？
- **排查 A**：请确认启动 ComfyUI 时是否添加了 `--listen` 参数（必须为 `python main.py --listen 127.0.0.1 --port 8188`）；
- **排查 B**：WebLockShot 在开发环境下通过 Vite 内置反向代理 `/api/comfyui` 穿透跨域，请确认通过 `http://localhost:5173` 访问工作台，而不是直接双击打开本地 HTML 文件。

#### Q2：为什么点击生成按钮提示“钱包可用余额不足”？
- WebLockShot 引入了工业级资金防透支机制。点击顶部导航栏的 **「💰 虚拟钱包」**，点击 **「+ 1,000 币」** 模拟充值或 **「重置 2,000 体验金」**，即可立即恢复生成。若使用 ComfyUI 或 Mock 模式，资费为 0，永不扣费。

#### Q3：如果某个镜头生成的画面不满意怎么办？
- 在第 6 步「审片交付」阶段，无需全部重跑！针对不满意的单个镜头，点击右侧的 **「🔄 局部重生成」**，系统将仅对该单镜重新调度生成，其余满意的镜头保持不变，极大节约算力与时间。

#### Q4：导出的剪映草稿打开后素材显示离线？
- 剪映草稿中记录了各视频素材的本地路径或网络 URL。若为本地录制的 Blob URL，请将下载的视频素材文件保存在剪映草稿同级目录下，剪映将自动完成重链接。

---

## （十）手机端使用：PWA 添加到主屏幕

WebLockShot 已支持 PWA（Progressive Web App），手机浏览器即可安装为「类原生应用」：

### 添加到主屏幕步骤

1. 手机浏览器（iOS Safari / Android Chrome）访问你的部署地址（在线版或自建域名均可）；
2. **iOS Safari**：点击底部「分享」按钮 → 选择「添加到主屏幕」→ 确认，桌面出现 WLS 图标；
3. **Android Chrome**：地址栏右侧「⋮」菜单 → 「添加到主屏幕 / 安装应用」→ 确认；
4. 从主屏幕图标打开后即为 **standalone 独立全屏窗口**（无浏览器地址栏），主题色为 WebLockShot 青（#22d3ee）。

### 使用要点

- **版本自更新**：发布新版本后，应用内会弹出「🚀 发现新版本，刷新即可更新」底部提示条，点击「刷新」即完成更新（prompt 模式不会打断进行中的生成任务，可等任务出片后再更新）；
- **密钥与数据**：与桌面端一致，API Key 仅存于浏览器 `sessionStorage`，会话数据存 IndexedDB，均不上传第三方服务器；
- **响应式布局**：<768px 自动切换单栏堆叠（六步横条变紧凑步骤指示器、引擎条可折叠、表格横向滑动），≥768px 与桌面体验一致；
- **触控适配**：触屏设备所有可点击区域 ≥44px，商品录入页直接调起后置相机拍摄商品图（`capture="environment"`，仅触屏生效）；
- **后台正确性**：生成任务切后台再回前台，轮询状态会立即刷新一次，不傻等剩余间隔。

---

## （十一）Docker 生产部署

适合服务器部署 / 团队内网共享 / 私有化交付场景。

### 一键启动

```bash
git clone https://github.com/QWQcool/WebLockShot.git
cd WebLockShot
docker compose up --build      # 首次构建约 2~4 分钟
```

启动成功后：

- 应用地址：`http://localhost:8080`（端口在 `docker-compose.yml` 的 `ports` 中调整）
- 健康检查：`http://localhost:8080/healthz`，返回版本 / 存储模式 / uptime 等自观测 JSON
- compose 已内置 healthcheck（30s 间隔探测 `/healthz`），异常自动重启

### 预留开关配置（compose environment）

所有 `WLS_*` 环境变量均为「预留接口做好不用」原则的实现——**不设置任何变量 = 本地默认模式，行为与纯前端现状完全一致**。常用配置：

```yaml
environment:
  - PORT=5174
  # 会话持久化（预留）：sqlite 落盘到容器 /app/data 卷
  - WLS_STORAGE=sqlite
  # 语音合成（默认 on）：/api/tts Edge-TTS 出 mp3，产物落 /app/data/tts 卷
  # - WLS_TTS=off
  # 成片合成（默认 auto）：镜像已内置 ffmpeg，/api/render 出 mp4，产物落 /app/data/render 卷
  # - WLS_FFMPEG=auto
  # - WLS_RENDER_TIMEOUT_SEC=600
  # LLM 反代（预留）：设置后 /api/llm 反代到目标
  - WLS_LLM_TARGET=https://api.openai.com
  # 密钥注入（预留）：服务端持有真实密钥，客户端免配 Key（小程序轻端依赖此机制）
  - WLS_KEYS={"kling":"Bearer ak-xxx","llm":"Bearer sk-xxx"}
```

### HTTPS 上线

compose 内含 Caddy 反代注释模板：取消注释、编写 `Caddyfile`（`your-domain.com { reverse_proxy weblockshot:5174 }`），Caddy 将自动签发并续期 Let's Encrypt 证书；也可按同思路换 nginx + certbot。

### 镜像结构

多阶段构建：阶段 1（node:22-slim）`npm ci` + `tsc -b && vite build` 产出 `dist/`；阶段 2 运行层（node:22-alpine，**已内置 ffmpeg** 支撑 `/api/render` 成片合成）仅含 `dist/`、`server/` 与生产依赖（不含任何 devDependency）。`./data`（TTS 音频/成片/sqlite 会话库）与 `./jianying-drafts`（剪映落盘）已挂载持久化卷。CI 每次 push 均执行「只 build 不 push」的镜像构建验证 job。

---

## （十二）小程序版轻端

`miniapp/` 目录提供微信小程序（weapp）轻端（Taro 4 + React 18，主分支目录而非独立分支），覆盖「录入商品 → 任务进度 → 看片交付」轻链路。

### 能力边界（诚实标注）

小程序端**不做**剪映草稿导出（需桌面文件系统能力）、**不做** Mock 引擎与 GSAP 动画体系；看片后复制视频链接，回桌面工作台「审片交付」继续完成剪映交付。完整边界说明见 [miniapp/README.md](../miniapp/README.md)。

### 与桌面端的复用关系

- 通过 `@domain` 别名直接复用主仓 `src/domain` 零依赖领域模块（轮询窗口 `pollingConfig` 等），主仓 src 层面零改动；
- 依赖完全独立（miniapp 自有 package.json，React 锁 18.3.1 保证 Taro 兼容），不污染根 package.json。

### 后端依赖与密钥安全

- 所有任务请求经 `TARO_APP_API_BASE` 指向的后端 `/api` 反代提交（伴生 server 或云端网关）；
- **小程序端不持有任何 API Key**——密钥由服务端 `WLS_KEYS` 注入（见上文 Docker 部署）；未配置 `WLS_KEYS` 时为透传模式，远端将显式返回 401。

### 构建与部署要求

```bash
cd miniapp
npm install
npm run build:weapp    # 不依赖微信开发者工具即可完成编译，产物在 miniapp/dist/
```

- **request 合法域名**：小程序后台需将后端域名加入 request 合法域名列表（要求 **HTTPS + ICP 备案域名**）；
- **账号主体**：`touristappid`（游客模式）仅限本地开发者工具预览；`web-view` 与部分高级接口需**企业主体**账号；
- 构建产物结构：`dist/app.json` 三页注册 + 每页 js/json/wxml/wxss 四件套（无需微信开发者工具即可校验）。

---

*WebLockShot 致力于为每一位电商创作者打造顺滑、可信、低成本的 AI 短视频工业化流水线。*
