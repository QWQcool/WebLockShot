# 覆盖率基线（CANVAS_PLAN.md §9 T2）

> 更新：2026-09-11 · 门槛：**关键纯函数层行覆盖率 ≥ 80%**

## 怎么跑

```bash
npm run test:coverage            # 打印基线表（不阻塞，未达标如实列出）
npm run test:coverage -- --strict # 任一目标文件 < 80% 行覆盖 → exit 1（供 CI 卡点）
npm run test:coverage -- --json   # 机器可读输出
```

实现：`scripts/coverage-canvas.mjs` —— 复用 Node 内置 `--experimental-test-coverage`，
测试文件清单**直接从 `package.json` 的 `test:node` 读取**（单一来源，零重复维护）。

## 基线（实测，2026-09-11）

| 文件 | 行 % | 分支 % | 函数 % | 判定 |
|---|---|---|---|---|
| `src/canvas/contract.ts` | 99.93 | 91.93 | 98.81 | ✅ |
| `src/canvas/stage3dMeta.ts` | 99.08 | 86.21 | 91.67 | ✅ |
| `src/canvas/stage3dScenes.ts` | 100 | 92.86 | 100 | ✅ |
| `src/canvas/stage3dAnim.ts` | 100 | 92.86 | 100 | ✅ |
| `src/canvas/memorySource.ts` | 100 | 89.47 | 100 | ✅ |
| `src/domain/feedback.ts` | 100 | 97.22 | 82.61 | ✅ |
| `src/canvas/projectStore.ts` | 88.8 | 69.51 | 95.24 | ✅ |
| `src/canvas/minimap.ts` | 100 | 100 | 100 | ✅ |
| `src/canvas/mcpOps.ts` | 100 | 91.38 | 100 | ✅ |
| `src/canvas/sceneGallery.ts` | 98.45 | 75 | 100 | ✅ |

**达标 10/10**（门槛只看行覆盖率；分支/函数列供参考）。

## 口径与诚实边界

- **只统计 Node 侧单测覆盖**。React 组件层（`*.ui.test.tsx`）由 vitest 跑（26 项），
  不进本门槛——Node 测试运行器无法渲染组件，混入会得到失真的分母。
- **未覆盖即未覆盖，不做数字美化**。`--strict` 未开启时脚本对未达标项打印
  「未覆盖行」明细而非静默通过。
- `src/domain/feedback.ts` 的 IndexedDB I/O 分支（浏览器专属）由
  `src/domain/__tests__/feedback.test.ts` 中的**最小内存替身**驱动覆盖；
  该替身只用于验证事务接线与降级路径，不改变聚合层实现
  （`computeWinRates` 仍是唯一聚合层，红线不变）。
- 覆盖率是**基线快照**而非永久承诺：新增纯函数模块应同步加入
  `scripts/coverage-canvas.mjs` 的 `TARGETS` 清单。

## 当前缺口

无。历史缺口（`feedback.ts` 73.84% → 100%）已在 T2 补齐并固化为回归。
