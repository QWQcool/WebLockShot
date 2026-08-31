# WEB锁镜 WebLockShot

给竖屏短剧创作者一台 **出可灵 / 即梦之前的免费粗剪台**。用主题、人物、冲突、钩子拆成可播放的 6 镜动态分镜（HTML + GSAP 模板，不是成片），锁镜头和台词之后，导出一份可粘贴到可灵或即梦的提示词。

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

无服务端、无登录。密钥只写在浏览器 `sessionStorage`，刷新标签页需重填，不会进 Git。

## 怎么体验（主路径，约 3 分钟）

1. 默认就是 **预设模拟**，零 Token。内置三个主题：《门缝》《未读》《13层》。台词和运动不能手改，只能看。
2. 点 **播放**，看完 6 镜竖屏粗剪。可点 **重做这一镜** 看官方第二版本，再用 **观看历史镜头** 还原。
3. 顶栏 **导出提示词** 复制一份通用包，到可灵或即梦自行粘贴。
4. 切到 **自带 Token**：填主题和三个短框后生成；可重做、按补充改镜、改时长。推荐 [OpenRouter](https://openrouter.ai) 或硅基流动。

页脚会写明当前是预设还是 Token。本产品 **不代出视频**。

## 真实 vs mock

| 能力 | 状态 |
| --- | --- |
| 预设 6 镜播放、切换故事、重做看备选、历史还原、导出 | **真实**，纯前端 |
| Token 拆镜 / 重做 / 按补充改镜 | **真实**（需用户密钥）；无密钥时按钮不可用 |
| 可灵 / 即梦出视频 | **不做**；只导出提示词 |
| 角色图 / 视频 | **不做**；剪影色块 |
| 提示词质量 | 模板编译，**不是**模型二次润色 |
| 支付、账号、云端存稿 | **不做** |
| 网络异常自动重试 / 逐镜断点续传 / 失败留上一版 | **真实**，纯前端 |

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
