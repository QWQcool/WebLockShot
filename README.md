# WEB锁镜 WebLockShot (v1.1)

面向电商带货与竖屏创作者的 **多 Agent 视频生成工作台（仿爆款）**。
- **带货工作台（P0 主入口）**：商品导入（链接/图片/本地视频抽帧）→ 爆款套路库与句式扩充（promptBooster）→ 双 Agent 脚本审稿 → `sell-stage` 6 镜分镜预演 → 视觉提示词方案 → MediaRecorder 真实录制生成真 WebM 出片 → 6 镜顺序连续审片播放器。
- **剧情短剧粗剪台（保留兼容）**：保留原有的《门缝》《未读》《13层》6 镜 GSAP 剧情预演与提示词包导出，零回归。

在线体验：https://qwqcool.github.io/WebLockShot/
（推送 `main` 后由 GitHub Actions 自动部署）

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开终端提示的本地地址（通常是 `http://localhost:5173`）。

```bash
npm run build
npm run preview
```

无服务端、无登录。密钥只写在浏览器 `sessionStorage`，绝不进入 Git。

## 真实 vs mock

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 爆款结构库（5 套模板 + 钩子句式库） | **真实**，纯前端 | 覆盖痛点开场、效果反差、开箱测评、短剧植入、价格锚点；均有 zod 严格契约与单测保障 |
| 带货脚本扩写与审稿（ScriptWriter & ScriptCritic） | **真实**，纯前端 | 0 key 演示模式走本地模板工程扩写与规则审稿；填入 API Key 即可联动大模型 |
| 商品导入三入口（链接/图片/参考视频） | **真实**，纯前端 | 遵循诚信红线：因反爬与跨域限制，链接如实保存档案并引导补充卖点（不造假爬取）；图片本地即时预览；视频本地 Canvas 抽帧 |
| 9:16 动态舞台与分镜预演（sell-stage & shot-stage） | **真实**，纯前端 | GSAP + `@gsap/react` 驱动，带货分镜严格遵循 s1 钩子、s6 CTA 契约 |
| 媒体生成与出片（P0 阶段） | **真实模拟**，纯前端 | 使用 `MediaRecorder` 对 9:16 动态舞台进行实时录制，产出真正可播放的 WebM 视频 Blob，**不是** setTimeout 伪造进度 |
| 任务调度与幂等防重 | **真实**，单机队列 | 基于 `sha1(shotId + prompt + duration + provider)` 幂等防重，同意图不重复提交；单镜支持独立重试与局部重生成 |
| 会话中断与恢复 | **真实**，纯前端 | `PipelineSessionV2` 自动存盘，中途刷新页面自动恢复当前节点与任务进度，兼容读取 v1 旧剧情会话 |
| 可灵 / 即梦真实视频 API 直调 | P1 阶段规划 | P0 先以 MediaRecorder 真实录制走通完整 submit→poll→asset 异步状态机 |
| 剧情短剧模式（《门缝》《未读》《13层》） | **真实**，纯前端 | 完全保留且通过一键切换无缝使用，原有提示词导出与断点续传不回归 |

下一步优先（未做）：考虑生成音乐，让粗镜头 画面表现更加精细，做类似nano banana的精细化镜头修改操作空间

## 可靠性设计

密钥只进 `sessionStorage`，**不写** `localStorage`。

### 重试

`src/ai/client.ts` 通过 `src/ai/retry.ts` 做指数退避 + 抖动。

| 错误 | 是否重试 | 原因 |
| --- | --- | --- |
| `network`（fetch 失败 / 断网 / CORS） | 是 | 瞬时网络问题 |
| `http` 429 / 5xx | 是 | 限流或服务端抖动；429 优先读 `Retry-After`（秒数或 HTTP 日期），上限 30s |
| `http` 其它 4xx | 否 | 请求本身不合格 |
| `config` | 否 | 没填 Base URL / Key / 模型，重试没用 |
| `empty` | 否 | 模型没返回文本，是质量问题不是网络问题 |
| `AbortSignal` 取消 | 立即停 | 不再进入下一次请求或退避等待 |

参数：最多重试 **3** 次（合计最多 4 次请求）。退避基底 **500 / 1000 / 2000ms**，再乘 `1 ± 20%` 抖动。耗尽后错误信息带「重试 3 次仍失败」。控制台会打 `[weblockshot.retry]` 日志。

### 断点续传

生成改为「先外壳、再逐镜」。`localStorage` 键：

- `weblockshot.generateSession`：进行中的任务
- `weblockshot.lastGoodStory`：上一份完整可用 6 镜

会话结构（`version: 1`）：

```ts
{
  id, startedAt,
  input: { theme, character, conflict, hook },
  model,                 // 不含 API Key
  envelope: null | { id, title, input, characters, setting },
  shots: Shot[]          // 已成功的镜，每完成 1 镜立刻写入
}
```

恢复流程：刷新后若会话未完成 → 提示「发现未完成的生成，是否继续？」→ **继续**从下一镜调用 LLM，已保存的镜不重跑 → **放弃**删除会话。全部完成时清会话，并写入 `lastGoodStory`。切到 Token 模式时，若有上一版完整粗剪会载入，舞台可继续播。

### 失败降级

生成失败时舞台不换成半成品：

- **有上一版**：错误文案写明「上次可用版本仍可播放」，并打「上次可用版本」标记。
- **全新失败**：写明「没有可降级的上一版」，当前舞台保持进入生成前的可播内容。

## 手动验证（现场演示）

1. `npm run dev`，切到 **自带 Token**，填好 Base URL / Key / 模型名。打开 DevTools → Console，过滤 `weblockshot.retry`。
2. 点 **生成粗剪**，等出现「正在生成第 2 镜」或更高。DevTools → Application → Local Storage，确认 `weblockshot.generateSession` 里 `shots` 已有 1 条以上。
3. **断网**（或 Chrome Network 选 Offline）。观察控制台每隔约 0.5s / 1s / 2s 打出重试日志；约 3 次后报错「重试 3 次仍失败」。若以前成功过，错误旁有「上次可用版本」，舞台仍可点播放。
4. **恢复网络**，刷新页面。应看到「发现未完成的生成，是否继续？已保存 N/6 镜」。点 **继续**：从下一镜接着请求，已保存的镜不会再打一轮完整 6 镜。
5. 全部完成后，`weblockshot.generateSession` 消失，`weblockshot.lastGoodStory` 更新。再断网点生成：失败后仍播这一版。

```bash
npm run test    # 重试：network 3 次、config 不重试、AbortSignal 立即停
npm run lint
npm run build
```

## 技术

Vite + React + TypeScript。舞台由 `Story` JSON 编译，GSAP 只使用镜头词典里的 `motionId`。预设数据在 `presets/hook-at-the-door/story.json`。契约见 `.cursor/skills/shot-stage/SKILL.md` 与 `PLAN.md`。

## 投入时间

规划与取舍约 1 小时（`PLAN.md`）。本切片实现与打磨见提交说明。到达 5 小时上限时，主路径必须可走通。
