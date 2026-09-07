# WEB锁镜 WebLockShot (v2.0)

面向电商带货与竖屏创作者的 **多 Agent 工业级视频生成与剪映工程交付工作台**。

- **🛒 电商全链路六步爆款工作流**：商品多模态导入（链接/图片/视频抽帧）→ 5 大爆款结构与黄金 3 秒钩子库（JSON 数据资产 + 品类路由 + 胜率加权采样）→ 双 Agent 剧本创编与对立面评审 → `sell-stage` 9:16 GSAP 动态分镜预演 → 视觉提示词方案编译 → 任务队列并发调度出片 → 剪映草稿工程声画字微秒级对齐导出（含完整素材 zip 包）。
- **⚡ 单 Agent 极速直出模式**：高转化提示词预设库、AI 运镜智能润色扩写、多模态参考底图/视频导入、1~60s 自由时长微调。
- **🤖 多 Agent 协同编导研讨室**：接入真实 LLM 时进行导演 + 运镜 + 质检 + 调度四智体结构化推演并给出真实质检评分；未配置 API Key 时诚实标注「演示动画模式 · 评分非真实」，绝不伪造评分。
- **📊 数据反馈闭环**：回流看板手动录入平台数据（3 秒完播率/完播率/转化），按结构/钩子/品类聚合胜率（Laplace 平滑），ScriptWriter 采样按真实胜率加权。
- **🔥 自建 ComfyUI 私有 GPU 算力穿透**：本地开发走 Vite 反代、生产走零依赖伴生服务反代，直调 Wan 2.1 工作流，内置一键 Ping GPU 显存探测。
- **💰 虚拟钱包两阶段结算事务**：per-refId 冻结账本，生片前预冻结，成功核销，异常/超时/取消全额原路退款；无冻结凭据的核销/退款一律拒绝，重复结算幂等，孤儿冻结 30 分钟 TTL 自动回收。
- **📥 剪映 / CapCut 电脑版草稿交付**：视频轨 + 旁白音轨 + 花字字幕轨微秒级对齐的 `draft_content.json` 工程文件与完整素材 zip 包（视频素材 + 使用说明），解压放入剪映草稿目录即可导入；可经伴生服务接口一键落盘。
- **🎭 剧情短剧粗剪台（保留兼容）**：内置《门缝》《未读》《13层》6 镜剧情预演与提示词包导出，零回归。

> 📖 **详尽实战手册请查阅**：[docs/HOW_TO_USE.md](./docs/HOW_TO_USE.md)（包含从零安装、ComfyUI 部署、剪映导入到踩坑排错的完整教程）。

---

## ⚡ 快速开始

### 1. 在线直接体验（纯前端无服务器依赖）
访问：https://qwqcool.github.io/WebLockShot/  
（密钥仅存储于浏览器 `sessionStorage`，不上传任何第三方服务器，自带 Mock 录制引擎与 0-Key 模板引擎，打开即用）。

### 2. 本地开发与私有算力直连
```bash
# 1. 安装依赖
npm install

# 2. 启动本地开发服务 (默认监听 5173，自动开启 ComfyUI 反向代理)
npm run dev

# 3. 运行质量检测 (79 项自动化测试：node 68 + vitest UI 11)
npm test

# 4. 生产打包验证
npm run build
```

---

## 🖥️ 本地伴生服务（npx 形态，可选）

需要「生产构建直连 ComfyUI / 视频平台 API」或「剪映草稿 zip 一键落盘」时，可启动零依赖伴生服务：

```bash
# 一行命令（先 npm run build 构建，再启动服务）
npx weblockshot          # 或: npm run build && npm run start:server
# 自定义: node server/weblockshot-server.mjs --port 8080 --dist ./dist --draft-dir ./jianying-drafts
```

Windows 用户可直接双击 `start-weblockshot.bat`（自动安装依赖/构建/启动）。

能力：静态托管 `dist/` + `/api/kling` `/api/jimeng` `/api/comfyui` 反代（生产也能连 ComfyUI）+ `POST /api/jianying/draft-zip`（zip 直解到本地草稿目录）。

---

## 📦 剪映草稿 zip 包使用说明（解压后放入剪映草稿目录）

在「交付播放器」页点击 **📦 下载完整草稿 zip 包 (含素材)**，得到 `<工程名>_剪映草稿.zip`，内含：

- `draft_content.json` / `draft_meta_info.json`：剪映标准草稿工程（9:16 画布、视频主轨、旁白音轨、花字字幕轨微秒级对齐）
- `assets/`：已生成的分镜视频素材与（可选的）旁白音频
- `README-使用说明.txt`：本包专属素材清单与导入指引

导入步骤：
1. 解压压缩包；
2. 打开电脑版剪映 (JianyingPro)，新建一个空草稿；
3. 关闭剪映，进入草稿目录（Windows 默认 `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\<草稿名>\`）；
4. 将解压出的 `draft_content.json`、`draft_meta_info.json` 与 `assets/` 复制进该目录（同名文件覆盖）；
5. 重新打开剪映即可看到三轨对齐的完整工程。

> 注：浏览器 Web Speech TTS 无法导出音频文件，若 `assets/voice_*.mp3` 缺失，可自行录制同名旁白放入 assets/，或在剪映中删除空音频片段。

---

## 💎 核心能力对比一览

| 能力模块 | 传统人工剪辑 | 一般套壳 AI 网页 | WebLockShot 工业化平台 |
| :--- | :--- | :--- | :--- |
| **爆款套路与前3秒** | 经验主义，完播率飘忽 | 单纯文本扩写，无节奏约束 | **5 套爆款结构库 + 钩子句式库（JSON 数据资产）**：带品类/情绪轴/胜率元数据，Zod 强契约校验，按品类路由并按真实胜率加权采样钩子 |
| **剧本与审校机制** | 单人盲写，难以及时纠错 | 单次输出，缺乏自省批判 | **ScriptWriter + ScriptCritic 双智体推演**（3 秒停留/卖点/完播/合规 4 维严苛打分）；LLM 输出经 zod Schema 校验，非法结构自动重试与降级 |
| **视觉预演与动态调度** | 脑补画面，直接盲盒生片 | 纯黑屏等待加载 | **9:16 GSAP 动态分镜预演舞台**，毫秒级呈现推拉摇移运镜动势与弹幕节奏 |
| **视频生成引擎支持** | 仅能在特定官网点选 | 仅绑定单一商业 API | **四引擎聚合调度**：快手可灵 (Kling)、字节即梦 (Jimeng)、**ComfyUI 私有显卡 (Wan 2.1)**、Mock 实验画布；引擎熔断状态 UI 实时可视化 |
| **算力接口费** | 频繁消耗商业点数 | 充值代币高额溢价 | **0 接口费自由**：直通本地/局域网 RTX 3090/4090/A100 ComfyUI，边际成本为 0 |
| **任务防重与资金保障** | 连击重复扣费，异常不退 | 失败扣点申诉困难 | **两阶段事务虚拟钱包**（per-refId 冻结账本：预冻结 → 成功划扣 / 失败回滚退款；无凭据拒绝核销、重复结算幂等、孤儿冻结 TTL 回收）+ 意图指纹幂等锁 |
| **数据反馈闭环** | 投后凭感觉复盘 | 无数据回流 | **回流看板**：手动录入 3 秒完播率/完播率/转化，按结构/钩子/品类聚合胜率（Laplace 平滑），反哺 ScriptWriter 采样加权 |
| **交付剪辑工程** | 人工拉音频、对字号、对轨 | 仅提供独立 MP4 | **剪映 / CapCut 草稿工程 zip 包直出**：三轨微秒对齐的 draft_content.json + 视频素材 + 使用说明，解压入草稿目录即用；可经伴生服务一键落盘 |
| **私有部署** | — | 依赖云端，断网不可用 | **零依赖伴生服务**：一行命令静态托管 + API 反代 + 草稿落盘（`npx weblockshot` / `start-weblockshot.bat`） |

---

## 🛡️ 工业级可靠性体系

### 1. 任务幂等性与防连击锁 (`src/domain/idempotency.ts`)
- **意图指纹哈希**：基于规范化 `(intent, shotId, provider, prompt, duration, ratio)` 生成恒定幂等键；
- **In-flight 互斥锁**：同一任务处理中严格阻断用户二次连击，任务完成后短期内支持幂等缓存复用。

### 2. 有限状态机 (FSM) 与供应商熔断器 (`src/domain/fsm.ts`)
- **ShotJob 状态机管控**：`queued → running → succeeded/failed`（失败可 `failed → queued` 重试）经 `JOB_STATUS_TRANSITIONS` 转移表守卫，非法迁移（含 `succeeded` 终态自迁移、越级迁移）直接抛错；
- **自动熔断器 (Circuit Breaker)**：远端 API 连续失败 3 次切入熔断保护（30 秒后半开探测），UI 徽章实时呈现「正常 / 熔断保护中 / 半开探测中」，Mock 与 ComfyUI 自建算力免熔断。

### 3. 两阶段提交事务虚拟钱包 (`src/domain/wallet.ts`)
- 用户初始赠送 2,000 灵感币，frozen 采用 **per-refId 冻结账本**（记录金额/供应商/冻结时间）；
- **阶段 1 (Freeze)**：任务进入前校验余额并预冻结资金，防止透支；
- **阶段 2A (Settle)**：出片成功后正式划扣冻结款（支持部分核销，凭据余额保留可追）；
- **阶段 2B (Refund)**：异常、超时或中断时全额原路退款；
- **防虚假核销**：无冻结凭据的 settle/refund 一律拒绝；同一 refId 重复结算幂等；核销后退款被拒（防双重回滚）；
- **孤儿冻结回收**：进程重启后无主冻结款 30 分钟 TTL 自动原路退回；
- **多标签页同步**：storage 事件驱动跨标签页钱包视图一致；
- 完整资金交易收支流水审计明细与模拟充值中心。

### 4. 指数退避重试网络容错 (`src/ai/retry.ts`)
- 遇到网络波动、429 限流或 5xx 错误时，采用指数退避（500ms / 1000ms / 2000ms）+ 抖动重试（媒体层 Kling/即梦已接入）；
- 优先尊重服务端 `Retry-After` 头，取消信号立即退出不重试。

### 5. 生成管线收口 (`src/hooks/useVideoPipeline.ts`)
- 钱包两阶段事务 / 熔断 / 幂等锁 / 轮询 / 结算退款全站只此一份实现（executor 与两个 Studio 共用）；
- 轮询窗口可配置（默认 10 分钟，UI 下拉 2/5/10/20 分钟），超时一律退款、绝不结算；
- 组件卸载自动中断轮询并释放幂等锁。

---

## 📁 项目工程架构

```
WebLockShot/
├── docs/
│   └── HOW_TO_USE.md                 # 完整使用指南与工业化实操手册
├── scripts/
│   └── optimize-preset-images.mjs    # 预设图片瘦身工具 (sharp)
├── server/                           # 零依赖伴生服务 (静态托管 + API 反代 + 剪映草稿落盘)
├── src/
│   ├── ai/                           # AI 智体层 (ScriptWriter, ScriptCritic, PromptPolisher, Retry)
│   ├── assets/
│   │   ├── hooks/                    # 爆款结构与钩子句式 JSON 数据资产（品类/情绪轴/胜率元数据）
│   │   └── presets/                  # 商业 Mock 预设资产与产品图源
│   ├── director/                     # 导演中枢与执行引擎 (ExecutorEngine, StoryboardNode, VisualizerNode)
│   ├── domain/                       # 领域驱动核心 (Wallet, FSM, Idempotency, Feedback, PollingConfig, ShotJob)
│   ├── export/                       # 导出引擎 (剪映草稿三轨对齐 + 零依赖 zip 打包)
│   ├── hooks/                        # 共享管线 Hook (useVideoPipeline, useRevocableObjectUrl)
│   ├── media/                        # 媒体提供商 (ComfyUI, Kling, Jimeng, Mock, Audio TTS, AssetSize)
│   ├── persist/                      # IndexedDB 资产存储 (base64 大资产外移)
│   └── ui/                           # React 界面层 (WorkbenchHeader, SellWorkbench, Studios, FeedbackDashboard, Modals)
├── vite.config.ts                    # Vite 构建配置 + API 代理 + vitest 配置
├── start-weblockshot.bat             # Windows 一键启动 (装依赖/构建/启动伴生服务)
└── package.json                      # 脚本定义与 79 项自动化测试配置
```

---

## 🧪 自动化测试验证

本项目拥有完善的自动化测试保障，执行 `npm test` 验证（node 单测 + vitest UI 冒烟，共 79 项）：
```bash
> weblockshot@0.1.0 test
# 提示词智能润色 Agent（含 LLM 输出 zod 校验）
# 网络指数退避与重试机制（Kling 端点区分 + 5xx 自动重试）
# 任务幂等键与防重
# ExecutorEngine 串行排队 / 单镜重试 / 处理中 retry 竞态回归
# 全量电商链路端到端自动化测试
# FSM 状态机：非法迁移拦截 / 终态锁定 / ShotJob 转移表
# CircuitBreaker 连续失败自动熔断
# 虚拟钱包两阶段事务（凭据校验 / 幂等 / 部分核销 / 孤儿冻结回收 / 多标签页订阅）
# 持久化瘦身（大资产外移 IndexedDB / blob 死链处理 / 会话水合）
# 剪映草稿工程三轨微秒对齐 + 真实导入字段 + zip 打包往返
# 品类元数据路由与胜率加权采样 / 回流 Laplace 聚合
# TTS 引擎自适应语速算法
# ComfyUI / 可灵 / 即梦 Provider（含网络失败显式抛错、未就绪资产不伪造）
# UI 冒烟（vitest + testing-library）：钱包交互 / 熔断徽章三态 / 共享管线
# tests 68 (node) + 11 (vitest), fail 0
```

---

## 📄 License
MIT License
