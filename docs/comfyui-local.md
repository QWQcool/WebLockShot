# 本地 ComfyUI 出片（Wan 2.2 TI2V-5B）实测记录

> 建立时间：2026-09-20　｜　机器：RTX 3080 **10GB** / RAM 68GB / ComfyUI **0.36.0** / PyTorch 2.13.0+cu130
> 结论一句话：**10GB 显存能跑**，但 5 秒 704×1280 一条要 **约 11 分钟**；2 秒档约 1.5 分钟；快速档约 1 分钟。

本文只记录**实跑得到**的数据。凡未在本机跑过的项，一律标注「未验证」——不摆样例数据。

---

## 1. 节点与参数（GET /object_info 实测）

| 用途 | 节点类名 | 关键输入（实测存在） |
|---|---|---|
| 加载扩散模型 | `UNETLoader` | `unet_name` / `weight_dtype` |
| 加载文本编码器 | `CLIPLoader` | `clip_name` / `type='wan'` / `device` |
| 加载 VAE | `VAELoader` | `vae_name` |
| 文本编码 | `CLIPTextEncode` | `text` / `clip` |
| 图像→视频 latent | `Wan22ImageToVideoLatent` | `vae` / `width` / `height` / `length` / `batch_size` / 可选 `start_image` |
| 采样 | `KSampler` | `seed` / `steps` / `cfg` / `sampler_name` / `scheduler` / `positive` / `negative` / `latent_image` / `denoise` |
| 解码 | `VAEDecode` | `samples` / `vae` |
| 合成视频 | `CreateVideo` | `images` / `fps`（可选 `audio`） |
| 落盘 | `SaveVideo` | `video` / `filename_prefix` / `format='mp4'` |

权重（`Comfy-Org/Wan_2.2_ComfyUI_Repackaged`，Apache-2.0）：

| 文件 | 目录 | 大小 |
|---|---|---|
| `wan2.2_ti2v_5B_fp16.safetensors` | `models/diffusion_models/` | 9.31 GB |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders/` | 6.27 GB |
| `wan2.2_vae.safetensors` | `models/vae/` | 1.31 GB |

硬约束：宽高必须是 **32 的倍数**（VAE 16× 空间压缩再 2×2 patchify）；`length` 落在 **4n+1** 网格上；原生 **24fps**。

> ⚠️ 内置模板 `blueprints/Text to Video (Wan 2.2).json` 与 `Image to Video (Wan 2.2).json` 都是
> **14B 双阶段**版（两个 UNET + 两个 4-step LoRA + `wan_2.1_vae`），**不是** TI2V-5B。
> 5B 的 workflow 是本项目手写并按 `/object_info` 逐项核对的（见 `src/media/providers/comfyui.ts`）。

---

## 2. 性能基准（本机实测）

单条出片端到端耗时 = 模型装载 + 采样 + VAE 解码 + 编码落盘。三条数据均为同一台机器、同一进程内顺序提交（模型已缓存）。

| 序号 | 分辨率 | 帧数 | 时长@24fps | steps | cfg | 采样器/调度 | 端到端耗时 | 产物大小 | 显存峰值 |
|---|---|---|---|---|---|---|---|---|---|
| A | 480×832 | 13 | 0.54s | 4 | 5 | euler / simple | **72.4s** | 77 KB | 满（见注） |
| B | 704×1280 | 49 | 2.04s | 8 | 5 | euler / simple | **92.5s** | 376 KB | 满（见注） |
| C（目标） | 704×1280 | 121 | **5.04s** | 20 | 5 | euler / simple | **655s ≈ 10 分 55 秒** | 1.29 MB | 满（见注） |

产物校验（ComfyUI 自带 PyAV，逐帧解码计数）：

```
A: h264 / 480×832 / 13 帧 / 24fps / 0.542s / 77012 B
B: h264 / 704×1280 / 49 帧 / 24fps / 2.042s / 376339 B
C: h264 / 704×1280 / 121 帧 / 24fps / 5.042s / 1347743 B
```

C 的采样段实测 **20.1 s/it × 20 步 = 6 分 42 秒**，其余约 4 分钟为模型装载与 VAE 解码。

### 关于「显存峰值」

nvidia-smi 采样（1 秒一次，全程未落）显示 `memory.used` 直接打满 10240 MiB / 10240 MiB。
这**不能**读成「刚好塞得下」：ComfyUI 0.36 对 Wan 权重启用了 **dynamic VRAM loading**
（日志原文 `Model WAN22 prepared for dynamic VRAM loading. 9535MB Staged.`），
即权重常驻宿主内存、按需流式进出显存。打满意味着 WDDM 已经在**借用系统内存**，
这也是首次装载要花掉数十秒的原因。**诚实结论：10GB 属于「能跑但要靠 offload」，不是「原生放得下」。**

RAM 侧观测：`ram_free` 从 32.5 GB 降到 ~24 GB，与 9.5 GB staged + 6.4 GB 文本编码器量级吻合。

### 换算到画布出片

画布 generate 节点另有「质量档」换算（`src/media/providers/comfyui.ts`）：

| 质量档 | 分辨率 | 帧数上限 | steps | 单镜估算（UI 显示） | 实测 |
|---|---|---|---|---|---|
| fast | 480×832 | 49（≈2.0s） | 8 | 90s（含模型冷启的保守值） | **热跑 30~33s**（`npm run e2e:comfyui` 两次：30s / 33s） |
| standard | 704×1280 | 97（≈4.0s） | 16 | 250s | 未单独实跑（按 20s/it 外推） |
| high | 704×1280 | 121（≈5.0s） | 20 | 660s | **655s**（本文表 C） |

> 6 镜一次全出（high 档）≈ **1 小时 6 分**；fast 档 6 镜 ≈ 3 分钟（热跑）。
> 出片前确认弹层会把估算耗时与引擎名如实写出来，不让人干等黑屏。

### ⚠️ 必须与轮询窗口联动（否则 high 档必然「假失败」）

executor 的轮询窗口默认 **10 分钟**（`src/domain/pollingConfig.ts`：200 次 × 3s，UI 上限 20 分钟），
而 high 档单镜实测 **655s（10 分 55 秒）**。窗口不够的后果不是「慢」，而是：

> **超时 → 全额退款 → 标记 failed，而 ComfyUI 那边其实还在跑并最终写出文件。**

画布本身**没有**轮询窗口开关（该下拉只在两个 Studio 里），所以这条路径必然踩中。
修复方式：`ExecutorEngine.setPollingWindowMinutes()` 在入队前**只升不降**地按引擎耗时抬窗口
（只影响本节点自己的引擎实例，不污染 sell 单例），并在节点内与确认弹层如实显示「窗口已从 10 提到 12 分钟」。

换算表（`comfyRequiredWindowMinutes`，单镜估算向上取整 + 1 分钟余量）：

| 档位 | 单镜估算 | 需要的窗口 | 相对默认 10 分钟 |
|---|---|---|---|
| fast | 90s | 3 分钟 | 不抬 |
| standard | 250s | 6 分钟 | 不抬 |
| high | 660s | **12 分钟** | **必须抬** |

---

## 3. 自动化用法（HTTP API）

```bash
# 健康检查（含显卡 / 显存）
curl http://127.0.0.1:8188/system_stats

# 查单个节点参数（不要拉全量 958 个节点）
curl http://127.0.0.1:8188/object_info/Wan22ImageToVideoLatent

# 提交（API 格式：{"<id>":{"class_type":...,"inputs":{...}}}）
curl -X POST http://127.0.0.1:8188/prompt -H 'Content-Type: application/json' \
  -d '{"client_id":"wls","prompt":{ ... }}'

# 轮询 / 取产物
curl http://127.0.0.1:8188/history/<prompt_id>
curl 'http://127.0.0.1:8188/view?filename=xxx.mp4&subfolder=&type=output'
```

应用侧已实现：`src/media/providers/comfyui.ts`（`submit` / `poll` / `getAsset` / `probeCapabilities`），
画布 E2E：`npm run e2e:comfyui`。

### 三个容易踩的坑

1. **步进进度只能走 WebSocket**（`ws://…/ws?clientId=…` 的 `progress` 消息）。
   HTTP 侧 `/queue` 不带 value/max，所以 provider 拿不到真实步进时**不给进度数字**，
   而不是编造一个递增的假百分比。
2. **缓存破坏参数不能用 `?` 硬拼**。ComfyUI 的产物直链自带 query
   （`/view?filename=a.mp4&subfolder=&type=output`），拼成 `…type=output?v=123` 会让 `type`
   变成 `output?v=123` → 404。统一走 `withCacheBuster()` 按需选 `&` / `?`。
3. **浏览器不能直连 `127.0.0.1:8188`（会 403，且只在 POST 上暴露）**。
   ComfyUI 新版 `server.py` 的 `create_origin_only_middleware` 会校验「回环 Host + Origin 是否同域」：

   ```python
   if 'Host' in request.headers and 'Origin' in request.headers:
       if loopback(host) and host_domain != origin_domain:
           return web.Response(status=403)   # WARNING: non matching host and origin ...
   ```

   页面跑在 `127.0.0.1:<本项目端口>` 时，`Origin: http://127.0.0.1:<本项目端口>` 与
   `Host: 127.0.0.1:8188` 不同域 → **凡带 Origin 的请求（POST /prompt、POST /upload/image）
   一律 403**；GET 不带 Origin 所以 `GET /system_stats` 看起来是通的，**很容易误判成连上了**。
   实测报错原文：

   ```
   [WARNING] request with non matching host and origin 127.0.0.1:8188 != 127.0.0.1:25354, returning 403
   ```

   **正解 = 走同源反代**（反代把 `host`/`origin`/`referer` 全摘掉，该中间件直接跳过）：

   | 场景 | 反代 | 实现 |
   |---|---|---|
   | `npm run dev` | `/api/comfyui` → `http://127.0.0.1:8188` | `vite.config.ts`（`configure` 里 removeHeader origin/referer） |
   | 伴生服务托管 dist | `/api/comfyui` → `http://127.0.0.1:8188` | `server/weblockshot-server.mjs`（本就 delete host/origin/referer） |

   代码侧：`localEngineProxyUrl()` 在回环主机下返回**绝对**同源反代 URL
   （`http://127.0.0.1:PORT/api/comfyui`）——必须绝对，因为产物直链要过画布契约
   `persistentUrlSchema`（只接受 `idbref://` 或 `http(s)://`，相对路径会被拒）。
   设置面板的 Base URL **留空即自动走反代**；填了具体地址则以其为准（远程 GPU 场景）。

   > 另一条路是让 ComfyUI 自身放行（`--enable-cors-header '*'`），但它只加 CORS 响应头，
   > **不解除**上面这个 host/origin 一致性校验，本机直连仍然 403，所以本项目选择走反代。

---

## 4. 预设清单与验证状态

| 预设 | 状态 | 说明 |
|---|---|---|
| `wan2.2-ti2v-5b` | ✅ **本机端到端验证**（本文全部数据） | 原生 ComfyUI 节点，3 件官方权重 |
| `custom` | ✅ 代码路径可用 | 直接提交用户自带的 API 格式 JSON，支持 `{{PROMPT}}` 等占位符 |
| `wan2.1-i2v` | ⚠️ **未验证** | 依赖第三方插件 Kijai **WanVideoWrapper**（`WanVideoModelLoader` / `EmptyWanLatentVideo` / `VHS_VideoCombine`），本机未安装 |
| `minimax-h3` | ⚠️ **未验证（接口预留）** | 节点形状按内置模板对齐（`MiniMaxH3ImageToVideo` + video/audio 双 VAE + `VAEDecodeAudio`，**含音画同步**）。本机未下载权重；其文本编码器 `qwen3vl_32b_*` 为 32B 规模，**10GB 显存不可行**，故仅预留接口 |

历史遗留的 `cogvideox-5b` / `svd-xt` **从未实现**，已从预设白名单移除。
设置面板的 `<select>` 会把旧值归一渲染，但**出片路径不做静默替换**：
读到未知预设直接抛错（`unknownPresetMessage`），避免「选了 A 跑了 B」。

### 缺失依赖自检

`comfyUIVideoProvider.probeCapabilities('minimax-h3')` 会逐个
`GET /object_info/{node}` 校验节点存在性 + 权重是否在 combo 枚举里，返回
`{ ok, missingNodes, missingModels, verified, unknownPreset }`。
设置面板「测试连接」按钮在连通后自动跑一次，把缺什么如实列出来。

---

## 5. 画布端插件点（本次改动）

- 引擎来源：设置面板写的 `weblockshot.video_provider`。画布只认已接通的
  `mock` / `comfyui`（`src/canvas/generateProvider.ts`），未接通的
  `kling` / `jimeng` / `runway` / `luma` 回落 mock 并在节点内如实列出。
- 产物契约：`generateMetaPayloadSchema.providerId` 由 `z.literal('mock')` 放宽为
  `z.enum(['mock','comfyui'])`。
- **产物持久化（P0）**：出片后把上游 `/view` 直链**转存本地 IndexedDB**（`src/canvas/assetPersist.ts`），
  meta 里存 `idbref://`。这样清 output 目录 / 换机器 / ComfyUI 服务停掉都不影响播放与剪映打包 ——
  而一条 5 秒镜头是 30s~11min 的真实算力换来的。转存**失败不判任务失败**：保留直链并写
  `persistedLocally: false`，产物卡如实显示「⚠️ 未转存本地 · 依赖上游服务在线」。
- 未改：`src/ai/`、`src/persist.ts`、`src/types.ts`（sell 6 镜管线红线，diff 为零）。

### 产物持久化的边界（如实）

| 情形 | 行为 |
|---|---|
| 正常（同源反代可拉取） | 转存 `idbref://`，`persistedLocally: true`；离线可播、可打包剪映草稿 |
| 上游 4xx/5xx 或网络异常 | **不判失败**，保留直链 + `false` + 原因（console 与卡片都要能看到） |
| 上游声明的体积 > 256MB | 直接不下载（省一次白下载），保留直链 + `false` |
| 浏览器配额不足 / 隐私模式 | 保留直链 + `false` |
| 产物 URL 不是 http(s)（如已是 idbref） | 无需转存，判 `true` |

> `ASSET_PERSIST_MAX_BYTES = 256MB`：实测 5s / 704×1280 仅 1.29MB，256MB 是安全余量。
> 转存走的是 `DeliverNodeBody` 早已支持的 `idbref://` 通路（打包前 hydrate 成 blob objectURL），
> 所以**打包剪映草稿反而更稳**：以前直连上游，现在读本地副本。

---

## 6. 复现步骤

```powershell
# 1. 起 ComfyUI（后台，避免前台阻塞）
Start-Process -FilePath 'D:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe' `
  -ArgumentList @('-s','ComfyUI\main.py','--windows-standalone-build','--listen','127.0.0.1','--port','8188') `
  -WorkingDirectory 'D:\ComfyUI\ComfyUI_windows_portable' `
  -RedirectStandardOutput 'D:\ComfyUI\comfy-out.log' -RedirectStandardError 'D:\ComfyUI\comfy-err.log' -WindowStyle Hidden

# 2. 确认在线
Invoke-RestMethod 'http://127.0.0.1:8188/system_stats'

# 3. 画布真实出片 E2E（环境不满足会如实跳过，不伪装通过）
npm run e2e:comfyui
```

`npm run e2e:comfyui` 的实测结果（2026-09-20，本机）：

```
✔ ① 进入画布（预置 ComfyUI 引擎）
✔ ② 搭图：product(填标题) + generate + 连线 product→generate
✔ ③ 引擎标签显示「ComfyUI 本地算力」（设置真实生效）
     · 真实出片完成，耗时 33s
✔ ④ 出片前确认弹层如实标注预计耗时，确认后真实出片
✔ ⑤ 产物是同源反代直链（绝对 http）且缓存参数拼接正确
     · 产物可解码 480×832 · 2.04s
✔ ⑥ 产物卡可播放（<video> 真实解码，不是死链）
✔ ⑦ 负向验收：切回 mock 重新出片 → 产物必须变回非 http 引用
✔ ⑧ 无未捕获页面错误
=== ComfyUI 出片 E2E 全部通过 ===
```

该套件**不进 CI**（需要真 GPU + 本机 ComfyUI）。它在 ComfyUI 离线、Playwright 缺失或权重不全时
打印缺什么后 `exit 0`，不伪装通过。
