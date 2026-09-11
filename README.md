# WEB锁镜 WebLockShot (v2.3)

> 🌐 **English**: [README.en.md](./README.en.md) · 使用指南英文版：[docs/HOW_TO_USE.en.md](./docs/HOW_TO_USE.en.md)

面向电商带货与竖屏创作者的 **多 Agent 工业级视频生成与剪映工程交付工作台**，现已升级为 **Agent 创意画布**驱动的多元化创意工作室。

- **🎨 Agent 创意画布（新 · 自由创作空间）**：tldraw 无限画布上的第三工作模式。对话栏一句话（或五类场景模板：带货短视频/品牌视觉/短剧分镜/游戏宣传/App 界面）→ LLM/演示编排自动布置 Agent 节点拓扑（可一键整批撤销）→ 脚本创编（ScriptWriter+Critic）→ 9:16 GSAP 分镜预演 → Mock 多引擎逐镜出片（钱包两阶段事务上画布）→ 产物卡 → 剪映草稿 zip 一键打包。画布框选可**沉淀为 Skill 工作流包**（manifest JSON：节点拓扑 + 参数槽位 + 输入/输出声明，产物与大资产自动剥离），导入即重建节点组只填新输入（预置「六步爆款带货流」「单图快速出片」两个官方 Skill）；记忆系统按结构/钩子/品类胜率（Laplace 聚合）为脚本采样加权。数据流连线带类型契约校验，全画布 localStorage 持久化 + 多标签页同步。定位多元化创意工作室，电商带货只是场景之一。
- **🛒 电商全链路六步爆款工作流**：商品多模态导入（链接/图片/视频抽帧）→ 5 大爆款结构与黄金 3 秒钩子库（JSON 数据资产 + 品类路由 + 胜率加权采样）→ 双 Agent 剧本创编与对立面评审 → `sell-stage` 9:16 GSAP 动态分镜预演 → 视觉提示词方案编译 → 任务队列并发调度出片 → 剪映草稿工程声画字微秒级对齐导出（含完整素材 zip 包）。
- **⚡ 单 Agent 极速直出模式**：高转化提示词预设库、AI 运镜智能润色扩写、多模态参考底图/视频导入、1~60s 自由时长微调。
- **🤖 多 Agent 协同编导研讨室**：接入真实 LLM 时进行导演 + 运镜 + 质检 + 调度四智体结构化推演并给出真实质检评分；未配置 API Key 时诚实标注「演示动画模式 · 评分非真实」，绝不伪造评分。
- **📊 数据反馈闭环**：回流看板手动录入平台数据（3 秒完播率/完播率/转化），按结构/钩子/品类聚合胜率（Laplace 平滑），ScriptWriter 采样按真实胜率加权。
- **🔥 自建 ComfyUI 私有 GPU 算力穿透**：本地开发走 Vite 反代、生产走零依赖伴生服务反代，直调 Wan 2.1 工作流，内置一键 Ping GPU 显存探测。
- **💰 虚拟钱包两阶段结算事务**：per-refId 冻结账本，生片前预冻结，成功核销，异常/超时/取消全额原路退款；无冻结凭据的核销/退款一律拒绝，重复结算幂等，孤儿冻结 30 分钟 TTL 自动回收；画布生成节点走同一条钱包管线（全站只此一份收口）。
- **📥 剪映 / CapCut 电脑版草稿交付**：视频轨 + 旁白音轨 + 花字字幕轨微秒级对齐的 `draft_content.json` 工程文件与完整素材 zip 包（视频素材 + 使用说明），解压放入剪映草稿目录即可导入；伴生服务在线时界面自动出现「发送到伴生服务落盘」按钮，一键解压到本地草稿目录；画布交付节点同样支持纯前端 zip 打包下载。
- **🔊 Edge-TTS 语音合成（伴生服务）**：`POST /api/tts` 调用 Edge TTS（纯 JS 实现，无需 Python / API Key）合成旁白 mp3 落盘，浏览器直接回读；开关 `WLS_TTS`，默认开启。
- **🎬 ffmpeg 服务端成片合成（伴生服务）**：`POST /api/render` 将分镜视频 + TTS 音轨 + 可选字幕合成为最终 mp4（音轨自动重编码、字幕软封），落盘后可直接回读下载；开关 `WLS_FFMPEG=auto` 自动探测 ffmpeg，镜像已内置。
- **🎭 剧情短剧粗剪台（保留兼容）**：内置《门缝》《未读》《13层》6 镜剧情预演与提示词包导出，零回归。

> 📖 **详尽实战手册请查阅**：[docs/HOW_TO_USE.md](./docs/HOW_TO_USE.md)（包含从零安装、ComfyUI 部署、剪映导入到踩坑排错的完整教程）。

> 📄 **开源许可**：自有代码 [MIT](./LICENSE)；**第三方依赖各自许可**（tldraw 为商业许可、GSAP 为自有免费许可），
> 完整清单与注意事项见 [`NOTICE`](./NOTICE)。

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

# 3. 运行质量检测 (116 项自动化测试：node 101 + vitest UI 15)
npm test

# 4. 生产打包验证
npm run build
```

---

## 🎨 Agent 创意画布（v2.1 新增模式）

顶栏「🎨 Agent 画布」或深链 `?view=canvas` 进入（tldraw 懒加载独立 chunk，不影响带货/短剧主包）。画布规划详见 [CANVAS_PLAN.md](./CANVAS_PLAN.md)。

**当前能力（一期 A+B + 二期 A/B 已交付）**：
- **自由创作空间**：9 种 Agent 节点（需求 Brief / 素材导入 / 脚本创编 / 分镜预演 / 视频生成 / 局部重绘 / 图像生成† / 3D 运镜台† / 成片交付）自由摆放连线，画布文档 localStorage 持久化 + 多标签页同步（† 为后续阶段占位，灰态诚实标注）
- **🖌️ 指哪改哪（v2.2 新增 · 局部重绘）**：产物卡连入重绘节点 → 笔刷涂抹 / 矩形框选涂抹重绘区（与源图同尺寸 mask PNG 落档，刷新可恢复继续编辑）→ 输入重绘指令执行 inpaint：ComfyUI 在线走真实工作流（FLUX.1 Fill / SD inpainting 预设 + 自定义 JSON，新增图像 inpaint Provider 与视频链路完全隔离），离线自动兜底演示重绘（mask 区域马赛克变换，「🧪 演示重绘 · 非真实生成」诚实标注）；重绘产物以**版本堆叠**挂在产物卡（‹ v k/N › 切换回退，上限 20 版，回退后可继续叠加重绘）
- **对话栏编排**：一句话或场景模板 → 无 Key 走确定性演示编排（「🧪 演示编排 · 非真实 LLM」标注），配置 Key 走真实 LLM 结构化拓扑（zod 校验 + 降级诚实标注）；整批节点支持「↩️ 撤销本次编排」与 Ctrl+Z 一次回滚
- **🧩 Skill 沉淀与复用（v2.3 新增）**：画布框选 ≥2 节点 →「📦 导出 Skill」产出 manifest JSON（节点拓扑 + zod 校验的参数槽位白名单 + 输入/输出声明；产物引用、maskRef、导入历史等设备本地产物字段自动剥离，跨设备干净可用）→「📥 导入 Skill」在新画布重建节点组（节点 id 全量重映射与现有节点共存，Ctrl+Z 精确回滚导入批次），入口节点高亮「📥 填新输入」，其余参数延续——换张商品图/换句 brief 即可重跑同拓扑。预置 2 个官方 Skill：**六步爆款带货流**（brief→product→script→storyboard→generate→deliver）与**单图快速出片**（product→generate 直连，「⚡ 单图直出 · 演示引擎」单镜生成 + 诚实标注）
- **🧠 记忆系统（v2.3 新增 · 结构化，不玄学）**：回流记录（结构与回流看板同源）经**同一 Laplace 聚合**（`computeWinRates`，全站只此一份，不另造）得出按结构/钩子/品类胜率，画布脚本创编节点采样时自动加权并展示「📊 本条建议来自你的历史数据」徽章（无历史数据如实不显示）。双模诚实运行：伴生服务 + `WLS_STORAGE=sqlite` 时记录走 `/api/memory/records`（healthz 能力位 `memory:'sqlite'`）；纯前端模式降级本机 IndexedDB 并标注「记忆仅存本地」。设置面板可查看（条数 + 三桶胜率 top）与一键清除（清除范围明示，清除后胜率回退 0.5 先验）
- **节点即管线**：脚本创编复用 ScriptWriter+Critic（演示模式 Critic 评分标注「非真实」）、分镜预演内嵌 GSAP 9:16 舞台（零改动复用 sell 模式组件）、视频生成走 `useVideoPipeline` 全链路（钱包两阶段事务/熔断/幂等上画布，钱包账本与六步工作台同源）
- **产物与交付**：出片产物自动成卡（视频转存 IndexedDB，`blob:` 拒绝持久化），素材导入三入口（图片上传/视频抽帧/链接存档），交付节点一键打包剪映草稿 zip（纯前端下载）+ 内嵌钱包余额显示
- **数据流契约**：连线带类型兼容校验（如 `分镜预演→视频生成` 合法、逆向拒绝并提示原因），边 id 跨刷新稳定，刷新后箭头自动物化恢复

**诚实边界**：可灵/即梦在画布模式暂未开放（请走带货工作台，未配 Key 时如实禁用）；Mock 引擎 0 灵感币；ComfyUI 离线时局部重绘自动降级演示模式（如实标注非真实生成）；单图直出仅 Mock/演示引擎（真实引擎待真实环境）；记忆系统纯前端模式仅存本机且如实标注；图像生成/3D 运镜台为后续阶段占位；tldraw 免费版带 License 水印（商用 License 决策待定）。

## 🖥️ 本地伴生服务（npx 形态，可选）

需要「生产构建直连 ComfyUI / 视频平台 API」或「剪映草稿 zip 一键落盘」时，可启动零依赖伴生服务：

```bash
# 一行命令（先 npm run build 构建，再启动服务）
npx weblockshot          # 或: npm run build && npm run start:server
# 自定义: node server/weblockshot-server.mjs --port 8080 --dist ./dist --draft-dir ./jianying-drafts
```

Windows 用户可直接双击 `start-weblockshot.bat`（自动安装依赖/构建/启动）。

能力：静态托管 `dist/` + `/api/kling` `/api/jimeng` `/api/comfyui` 反代（生产也能连 ComfyUI）+ `POST /api/jianying/draft-zip`（zip 直解到本地草稿目录）+ `POST /api/tts`（Edge-TTS 语音合成出 mp3）+ `POST /api/render`（ffmpeg 服务端成片合成）。

预留能力（配置开关，不设置 = 本地默认模式）：`GET /healthz`（版本/存储模式/uptime/能力位）、`WLS_STORAGE=memory|sqlite` 会话存储、`/api/llm` LLM 反代（需 `WLS_LLM_TARGET`）、`WLS_KEYS` 反代密钥注入（未设置 = 透传）、`PUT/GET/DELETE /api/sessions/:id`（BackendAdapter rest 模式后端）。

---

## ✅ 验证层级（诚实标注）

本项目的引擎/部署能力按「验证到哪一层」如实标注，不夸大：

| 能力 | 验证层级 | 说明 |
|---|---|---|
| 可灵 JWT 签名（HS512/HS256，官方头/载荷结构） | ✅ 契约验证 | 独立参考实现（node:crypto）向量锁定 + 交叉验证，见 `src/media/__tests__/authVectors.test.ts` |
| 即梦 V4 HMAC-SHA256 签名（火山引擎规范） | ✅ 契约验证 | 同上，完整 Authorization 串向量锁定 |
| 请求体形状 / 响应解析 / 错误码映射 | ✅ 契约验证 | `test/fixtures/kling|jimeng/` + `src/media/__tests__/providerContract.test.ts` |
| **Runway / Luma 海外引擎（M1）** | ✅ 契约验证 / ⏳ 待真实环境 | 请求体 / 端点 / 请求头 / 轮询状态映射 / 错误文案全部按官方文档实现并锁定 fixtures（`test/fixtures/runway|luma/`）；**尚未在真实账号下跑通出片**，无 Key 时不发起任何请求 |
| 可灵 / 即梦真实出片连通 | ⏳ 待真实环境 | `npm run verify:providers -- --kling-key=AK:SK --jimeng-key=AK:SK` 真实探测 |
| Docker 镜像构建 | ✅ CI 验证 | `.github/workflows/docker-build.yml`（只 build 不 push）；本地 `docker compose up --build` 可完整跑通 |
| Edge-TTS 语音合成（`/api/tts`） | ✅ 本机验证 | 真实出 mp3（zh-CN-XiaoxiaoNeural，38KB）；协议层 mock 单测不依赖网络 |
| ffmpeg 成片合成（`/api/render`） | ✅ CI 验证 / ⏳ 待生产长稳 | fake 子进程协议测试全链路；真实 ffmpeg 链路（testsrc+正弦音轨）在带 ffmpeg 环境（CI ubuntu runner）自动执行 |
| 剪映草稿一键落盘（伴生服务在线时按钮） | ✅ 本地验证（对接伴生 server） | UI 冒烟 mock fetch：探测可达→按钮出现→落盘成功；不可达→按钮不出现 |
| 手机 PWA（安装/SW 自更新/真机相机） | ⏳ 待真机 | manifest + SW 产物已生成并有构建验证 |
| BackendAdapter rest 模式 → 云后端 | ✅ 本地验证（对接伴生 server） / ⏳ 待真实云后端 | `/api/sessions/:id` 全流程有自动化测试 |

---

## 🚀 生产部署

### 1. BackendAdapter 双模式（数据持久化）

所有会话持久化经 `BackendAdapter` 预留层访问，模式由 `VITE_BACKEND_URL` 构建 / 运行环境决定：

| 模式 | 触发条件 | 行为 |
|---|---|---|
| **本地模式**（默认） | `VITE_BACKEND_URL` 为空 | 与纯前端现状完全一致：localStorage + IndexedDB，数据不出浏览器 |
| **服务端模式**（预留） | 配置了 `VITE_BACKEND_URL` | 会话快照 `PUT/GET/DELETE {后端}/api/sessions/:id`；后端不可达自动降级回本地模式 |

### 2. Docker 一键部署

```bash
# 构建并启动（前端 + 伴生 server 单容器）
docker compose up --build
# 访问 http://localhost:8080，健康检查: http://localhost:8080/healthz
```

- 多阶段构建：`node:22-alpine` 构建前端 → 运行层仅含 `dist/`、`server/` 与生产依赖
- CI 每次推送执行 `docker-build` job 验证镜像可构建（只 build 不 push）
- HTTPS：compose 内含 Caddy 反代注释模板（自动签发证书），或按注释换 nginx

### 3. 服务端环境变量（预留开关，不设置 = 本地默认模式）

| 变量 | 说明 |
|---|---|
| `PORT` / `DIST_DIR` / `DRAFT_DIR` | 端口 / 静态目录 / 剪映草稿目录（CLI 参数优先） |
| `WLS_STORAGE` | 会话存储模式：`memory`（默认，现状）/ `sqlite`（持久化；better-sqlite3 → node:sqlite → memory 三级降级） |
| `WLS_SQLITE_PATH` | sqlite 库文件路径（默认 `data/weblockshot-sessions.sqlite3`） |
| `WLS_KEYS` | 反代密钥注入（JSON：`{"kling":"Bearer xx","llm":"sk-xx"}`）；设置后对应引擎反代覆盖客户端 Authorization；未设置 = 透传模式 |
| `WLS_LLM_TARGET` | LLM API 反代目标；设置后 `/api/llm` 生效，未设置返回 501 |
| `WLS_TTS` | Edge-TTS 语音合成开关：`on`（默认）/ `off`（`/api/tts` 返回 501） |
| `TTS_DIR` | TTS mp3 落盘目录（默认 `data/tts`） |
| `WLS_FFMPEG` | ffmpeg 成片合成开关：`auto`（默认，探测二进制，缺失返回 501 + 安装提示）/ `off` |
| `RENDER_DIR` | 成片 mp4 落盘目录（默认 `data/render`） |
| `WLS_RENDER_TIMEOUT_SEC` | 单渲染任务超时秒数（默认 600，超时 kill 子进程返回 504） |
| `WLS_LOG_LEVEL` | pino 日志级别（默认 `info`，JSON 结构化输出） |
| `SENTRY_DSN` | 错误上报（预留 no-op，`/healthz` 上报 configured） |

### 4. 健康检查

```bash
curl http://localhost:5174/healthz
# {"ok":true,"version":"0.1.0","storage":"memory","uptimeSec":2,"node":"v22.x",
#  "keyMode":"passthrough","llmProxy":"off","sentry":"off","tts":"on","ffmpeg":"on"}
```

> `tts` / `ffmpeg` 为能力位：前端据此决定是否显示「发送到伴生服务落盘」等新按钮（探测失败 = 纯前端模式，行为与现状一致）。

---

## 📶 手机端（PWA + 响应式）

- **安装到主屏幕**：手机浏览器（iOS Safari / Android Chrome）访问部署地址 → 「添加到主屏幕」，以独立窗口（standalone）全屏运行；新版本发布后会弹出「🚀 发现新版本」提示条，点击刷新即完成自更新（不打断进行中的生成任务）
- **响应式断点**：≥1024px 桌面现状不变 / 768~1024px 侧栏与横条压缩 / <768px 单栏堆叠（六步横条变紧凑步骤指示器、双栏工作区纵向排列、表格横向滑动）
- **触控适配**：触屏设备所有可点击区域 ≥44px，卡片提供 :active 按压等价反馈；商品录入页在手机上直接调起后置相机拍摄
- **后台正确性**：生成任务切到后台再回来会立即刷新一次轮询状态，不傻等剩余间隔

---

## 📱 小程序版（miniapp 轻端）

`miniapp/` 为 Taro 4 + React 18 的微信小程序（weapp）轻端，与主仓通过 `@domain` 别名共享零依赖领域模块（轮询窗口等），**主仓 src 层面零改动**；依赖完全独立（独立 package.json，React 锁 18.3.1 以保证 Taro 兼容），不污染根 package.json。

```bash
cd miniapp
npm install
npm run build:weapp   # 不依赖微信开发者工具即可完成编译，产物在 miniapp/dist/
```

**三页功能**：index 商品录入（表单 + `chooseMedia` 首帧图）→ progress 任务进度（复用 `domain/pollingConfig` 轮询窗口与 pollSleep）→ result 看片（`Taro Video` 播放 + 复制链接）。

**能力边界（诚实标注）**：小程序端**不做**剪映草稿导出（需桌面文件系统能力）、**不做** Mock 引擎与 GSAP 动画体系；只做「录入 → 出片 → 看片」轻链路，复制视频链接后回桌面工作台「审片交付」继续。

**后端依赖**：任务经 `TARO_APP_API_BASE` 指向的后端 `/api` 反代提交；**小程序端不持有 API Key**——密钥由服务端 `WLS_KEYS` 注入（未配置 = 透传，远端显式 401）。

**部署要求**：request 合法域名要求 HTTPS + ICP 备案域名（`touristappid` 仅限本地工具预览）；`web-view` 与部分高级接口需企业主体账号。详见 [miniapp/README.md](./miniapp/README.md)。

---

## 📦 剪映草稿 zip 包使用说明（解压后放入剪映草稿目录）

在「交付播放器」页点击 **📦 下载完整草稿 zip 包 (含素材)**，得到 `<工程名>_剪映草稿.zip`，内含：

- `draft_content.json` / `draft_meta_info.json`：剪映标准草稿工程（9:16 画布、视频主轨、旁白音轨、花字字幕轨微秒级对齐）
- `assets/`：已生成的分镜视频素材与（可选的）旁白音频
- `README-使用说明.txt`：本包专属素材清单与导入指引

**免手动解压（伴生服务在线时）**：页面会自动探测本机伴生服务（`/healthz`），在线时显示 **📤 发送到伴生服务落盘** 按钮——点击后 zip 直发 `POST /api/jianying/draft-zip`，服务端自动解压到剪映草稿目录（响应返回 `savedPath`），跳过下方手动步骤；探测失败则按钮不显示，纯前端体验不变。

导入步骤：
1. 解压压缩包；
2. 打开电脑版剪映 (JianyingPro)，新建一个空草稿；
3. 关闭剪映，进入草稿目录（Windows 默认 `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\<草稿名>\`）；
4. 将解压出的 `draft_content.json`、`draft_meta_info.json` 与 `assets/` 复制进该目录（同名文件覆盖）；
5. 重新打开剪映即可看到三轨对齐的完整工程。

> 注：浏览器 Web Speech TTS 无法导出音频文件，若 `assets/voice_*.mp3` 缺失，可自行录制同名旁白放入 assets/，或在剪映中删除空音频片段。

---

## 🔊 语音合成（伴生服务 /api/tts）

启动伴生服务后（默认开启），可用 Edge-TTS 将任意文案合成旁白 mp3（纯 JS WebSocket 实现，无需 Python / API Key）：

```bash
curl -X POST http://localhost:5174/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"三秒抓住买家注意力","voice":"zh-CN-XiaoxiaoNeural","rate":"+10%"}'
# {"url":"/files/tts/1c83ab2f9286-mtr2oayj.mp3","path":".../data/tts/....mp3","bytes":38736,"voice":"zh-CN-XiaoxiaoNeural"}
```

- 声音：任意 Edge TTS ShortName（默认 `zh-CN-XiaoxiaoNeural`）；`rate` 支持相对语速（如 `+20%`）
- 限长：`text` ≤ 5000 字符（超限 400）；产物经 `GET /files/tts/<file>.mp3` 回读（`audio/mpeg`）
- 开关：`WLS_TTS=off` 关闭（返回 501）；`/healthz` 能力位 `tts: on|off`
- 验证层级：✅ 本机验证（真实出 mp3）；协议层 mock 单测不依赖网络

---

## 🎬 成片合成（伴生服务 /api/render）

将分镜视频 + TTS 音轨 + 可选字幕合成为最终 mp4（服务端 ffmpeg，本机需安装 ffmpeg；Docker 镜像已内置）：

```bash
curl -X POST http://localhost:5174/api/render \
  -H "Content-Type: application/json" \
  -d '{"videoUrl":"/files/tts/video.mp4","audioUrl":"/files/tts/voice.mp3","subtitleSrt":"1\n00:00:00,000 --> 00:00:03,000\n字幕","title":"我的成片"}'
# {"url":"/files/render/render_2026-09-07T10-00-00.mp4","path":".../data/render/....mp4","bytes":...}
```

- 来源：`videoUrl`/`audioUrl` 支持 http(s) 与本站相对路径（`/files/...`）；禁止 `file://` 与内网地址（SSRF 防护）；远程下载 500MB 上限
- 合成策略：视频流 copy + 音频重编码 aac（`-c:v copy` 因容器不兼容失败时自动回退 libx264 重编码）；字幕软封 `mov_text`
- 并发/超时：同一时间最多 1 个渲染任务（忙时 429）；单任务默认 10 分钟超时（`WLS_RENDER_TIMEOUT_SEC` 可调，超时 504）
- 开关：`WLS_FFMPEG=auto`（默认，探测 ffmpeg，缺失返回 501 + 安装提示）/ `off`；`/healthz` 能力位 `ffmpeg: on|off`
- 验证层级：✅ CI 验证（fake 子进程协议测试 + 真实 ffmpeg 链路）/ ⏳ 待生产长稳

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
├── server/                           # 零依赖伴生服务 (静态托管 + API 反代 + 剪映草稿落盘 + 记忆记录 API)
├── src/
│   ├── ai/                           # AI 智体层 (ScriptWriter, ScriptCritic, PromptPolisher, Retry)
│   ├── assets/
│   │   ├── hooks/                    # 爆款结构与钩子句式 JSON 数据资产（品类/情绪轴/胜率元数据）
│   │   └── presets/                  # 商业 Mock 预设资产与产品图源
│   ├── canvas/                       # Agent 创意画布 (CanvasDoc 契约, tldraw shape, 序列化, 持久化, 节点 Body, Skill manifest, 记忆源)
│   ├── director/                     # 导演中枢与执行引擎 (ExecutorEngine, StoryboardNode, VisualizerNode)
│   ├── domain/                       # 领域驱动核心 (Wallet, FSM, Idempotency, Feedback, PollingConfig, ShotJob)
│   ├── export/                       # 导出引擎 (剪映草稿三轨对齐 + 零依赖 zip 打包)
│   ├── hooks/                        # 共享管线 Hook (useVideoPipeline, useRevocableObjectUrl)
│   ├── media/                        # 媒体提供商 (ComfyUI, Kling, Jimeng, Mock, Audio TTS, AssetSize)
│   ├── persist/                      # IndexedDB 资产存储 (base64 大资产外移)
│   └── ui/                           # React 界面层 (WorkbenchHeader, SellWorkbench, Studios, FeedbackDashboard, Modals, canvas/)
├── vite.config.ts                    # Vite 构建配置 + API 代理 + vitest 配置
├── start-weblockshot.bat             # Windows 一键启动 (装依赖/构建/启动伴生服务)
├── CANVAS_PLAN.md                    # Agent 创意画布规划（一期~三期切片规格与验收标准）
└── package.json                      # 脚本定义与自动化测试配置
```

---

## 🧪 自动化测试验证

本项目拥有完善的自动化测试保障，执行 `npm test` 验证（node 单测 234 项 + vitest UI 冒烟 18 项）：
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
# tests 362 (node) + 18 (vitest), fail 0
```

### 画布 E2E 套件（`npm run e2e`）

把画布切片「用完即弃」的 Playwright 实机冒烟固化为可重复套件（`scripts/e2e-canvas.mjs`）：

- **覆盖**：开场层 → 对话栏演示编排 → 节点落位 → 刷新恢复；3D 运镜台（进入 / 场景预设 / 返回）；
  Skill 市场（安装 / 启停 / 卸载）；记忆图谱（真实空态或真实数据）；多画布项目 + 小地图 + 连接器 + 创作场景画廊
- **隔离**：独立浏览器上下文（localStorage / IndexedDB 不污染本机）+ 伴生服务 `WLS_STORAGE=memory` 起在随机端口
- **诚实跳过**：未安装 Playwright 或浏览器未下载时打印启用指引并 `exit 0`（不伪装通过、不阻塞 CI）

```bash
npm run e2e                 # 构建（dist 缺失时）+ 起伴生服务 + 跑全部步骤
npm run e2e -- --skip-build # 复用现有 dist（快速回归）
npm run e2e -- --headed     # 有头模式（排障）
```

### 覆盖率基线（`npm run test:coverage`）

关键纯函数层（画布契约 / 3D 摆台 / 记忆聚合 / 多画布 / 小地图 / MCP 操作）行覆盖率门槛 80%，
基线表与口径见 [`docs/coverage.md`](docs/coverage.md)（实测 **10/10 达标**；`--strict` 可作 CI 卡点）。

### 性能基准（`npm run perf`）

真实浏览器实测画布 200/500 节点帧率、记忆图谱 500 记录、3D 懒加载 chunk、Skill 市场 100 项，
基准表与优化建议见 [`docs/perf.md`](docs/perf.md)（**本期只测不改**）。

### 跨浏览器 + a11y（`npm run a11y`）

chromium / webkit 双引擎跑画布核心链路 + axe-core（WCAG 2.0 A/AA）扫描四个界面状态，
报告见 [`docs/a11y.md`](docs/a11y.md)（当前双引擎核心链路 **5/5**、axe 严重项 **0**）。

### 降级 / 迁移矩阵（`npm run degrade`）

实机验证六类能力缺失路径（旧单画布迁移、无 WebGL、无伴生服务、无 LLM Key、
`WLS_STORAGE=memory|sqlite`、ComfyUI 离线）是否优雅降级并如实标注，
矩阵见 [`docs/degrade-matrix.md`](docs/degrade-matrix.md)（当前 **6/6 通过**）。

---

## 📄 开源许可（License）

**本项目自有源代码以 [MIT License](./LICENSE) 发布**（`package.json` 的 `license` 字段为 `MIT`）。

> ⚠️ **依赖各自许可，不随本项目 MIT 改变** —— 完整清单见 [`NOTICE`](./NOTICE)，其中两项需要特别注意：
>
> - **tldraw（画布引擎）是商业许可，不是开源许可**：免费/未授权使用时画布带水印，且**生产环境未配置
>   license key 时渲染会在约 5 秒后停止**。本项目接受该限制，**不包含任何绕过许可校验或去水印的手段**；
>   正式上线需自行购买 tldraw license 并配置 `licenseKey`，或替换为 MIT 许可的画布引擎。
> - **GSAP 采用自有「标准免费」许可**（<https://gsap.com/standard-license>），并非 MIT。
>
> 随仓库分发的素材：Quaternius 通用动画库素体角色为 **CC0 1.0**（可商用、无再分发限制，见
> `public/models/LICENSE.md`）；Mixamo 等第三方模型**不随仓库分发**，仅支持用户本机自行导入。
>
> `package.json` 保留 `"private": true` 以防误发布到 npm，不影响本项目的开源属性。
