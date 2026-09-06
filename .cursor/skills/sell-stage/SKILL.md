---
name: sell-stage
description: Compile WebLockShot E-commerce Story JSON into the 9:16 GSAP sell animatic stage. Use when generating sell shots, editing the sell compiler, or structuring e-commerce scripts.
---

# Sell Stage 契约（带货分镜规格）

本文件是 **带货脚本/提示词 → 9:16 舞台** 的唯一规格。
带货分镜核心原则：**学爆款结构、钩子前置第 1 镜、卖点中段演示、促单 CTA 收尾第 6 镜**。

## 禁令与硬约束

1. `shots` 必须恰好 6 镜，`order` 为 1–6。
2. **结构定式**：
   - 第 1 镜必须承担 `hook`（钩子，前 3 秒留人）；
   - 第 2 镜必须承担 `pain`（痛点放大/痛感场景带入）；
   - 第 3 镜必须承担 `reveal`（产品首发亮相/主角登场）；
   - 第 4 镜必须承担 `demo`（核心功能/上身体验/解压演示）；
   - 第 5 镜必须承担 `proof`（效果对比/品质背书/价格锚点）；
   - 第 6 镜必须承担 `cta`（限时优惠/库存紧张/引导点击购买）。
3. 运动词典只许使用标准 8 项：
   `push_in` · `pull_out` · `pan_left` · `pan_right` · `follow` · `cut` · `enter_stage` · `line_pop`。
4. 景别词典只许使用 4 项：
   `ecu` (大特写) · `cu` (特写) · `ms` (中景) · `ws` (全景)。
5. 道具词典为封闭集：
   `none` · `door` · `note` · `lock`（电商促销卡/字幕统一走 line 或视觉正向词，不发明新 prop）。
6. 每镜 `durationSec` 在 2–5 秒之间，整条带货视频目标约 18 秒。
7. 不输出 Markdown 围栏，输出可直接解析的 JSON。

## 带货 6 镜标准分镜建议

| 镜号 | 角色 Role | 建议时长 | 推荐景别 | 推荐运动 | 画面重点与字幕 |
| --- | --- | --- | --- | --- | --- |
| s1 | hook | 2-3s | cu / ecu | cut / push_in | 惊人视觉反差/痛点疑问，强视觉冲击，大字吸睛 |
| s2 | pain | 3s | ws / ms | pan_left / pan_right | 还原糟糕翻车现场/共鸣痛点日常 |
| s3 | reveal | 3s | cu | enter_stage / push_in | 主角产品华丽入画，高光质感特写 |
| s4 | demo | 3-4s | ms / cu | follow / push_in | 动作演示使用过程，极致解压与顺畅感 |
| s5 | proof | 3s | ecu / cu | cut / pull_out | 左右分屏/前后效果对比/权威认证 |
| s6 | cta | 3s | cu | line_pop | 产品定格 + 限时抢购/拍一发三指令字幕 |
