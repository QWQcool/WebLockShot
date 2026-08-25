---
name: shot-stage
description: Compile WebLockShot Story JSON into the 9:16 GSAP animatic stage. Use when generating shots, editing the stage compiler, writing Token prompts, or validating story JSON.
---

# Shot Stage 契约

运行时产品不会调用本 skill。本文件是 **JSON → 舞台** 的唯一规格：实现编译器、写 Token 的 system prompt、改预设，都遵守它。

模型只填 JSON。禁止输出 HTML、CSS、JavaScript。禁止发明镜头词典之外的运动。

## 禁令

1. 不发明新角色，不改钩子结局，不把故事写成成片。
2. 不输出 Markdown 围栏。必须是可 `JSON.parse` 的单个对象。
3. 不要带 `alts`（那是仓库预设用的）。
4. `shots` 必须恰好 6 镜，`order` 为 1–6。
5. `motionId` / `shotSize` / `prop` 只许用下列词典。
6. 每镜 `purpose` 必填：这一镜推进了什么。结构不能空。
7. `durationSec` 在 2–5。整条目标约 18 秒。
8. 角色 `color` 为 `#RGB` 或 `#RRGGBB`。`anchor` 是外貌/服装一句，导出时每镜重复。

## 词典

`motionId`：`push_in` 缓慢推近 · `pull_out` 拉远 · `pan_left` 镜头左摇 · `pan_right` 镜头右摇 · `follow` 跟移主体 · `cut` 硬切 · `enter_stage` 人物入画 · `line_pop` 对白上屏

`shotSize`：`ecu` 大特写 · `cu` 特写 · `ms` 中景 · `ws` 全景

`prop`（可缺省，缺省=`none`）：`none` · `door` 门缝 · `note` 字条 · `lock` 门锁

台词非空时，编译器会把 `line_pop` **叠加**为次动作，不必把 `motionId` 写成 `line_pop`。

## Schema

```ts
type Story = {
  id: string
  title: string
  input: { character: string; conflict: string; hook: string }
  characters: { id: string; name: string; color: string; anchor: string }[]
  setting: { place: string; time: string; light: string }
  shots: Shot[] // 长度必须为 6
}

type Shot = {
  id: string           // 建议 "s1"..."s6"
  order: 1 | 2 | 3 | 4 | 5 | 6
  purpose: string
  shotSize: "ecu" | "cu" | "ms" | "ws"
  motionId: MotionId
  durationSec: number  // 2-5
  cast: string[]       // character id
  line: string         // 可空
  lineSpeaker?: string
  prop?: "none" | "door" | "note" | "lock"
}
```

## 舞台 DOM（编译器固定，模型不要写）

```
.stage[data-shot][data-size][data-prop]   9:16
  .layer-move
    .layer-bg
    .layer-cast     剪影块，按 cast[]
    .layer-prop     door | note | lock
  .layer-line       台词条
  .layer-slate      镜号 / 秒数
```

GSAP 只按 `motionId` 从词典取 tween，禁止为某一镜现场编新动画。`prefers-reduced-motion: reduce` 时跳到每镜首帧。

画幅恒定 9:16。这是 animatic，不是成片。
