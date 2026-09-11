/**
 * 3D 运镜台静态资源地址（与 three 无关的轻量模块，Studio 与 Viewport 共用）。
 *
 * ⚠️ 必须经 `publicUrl()` 拼 vite base，**禁止写死根绝对路径**：
 * GitHub Pages 为子路径部署（base `/WebLockShot/`），写死 `/models/…` 会 404，
 * 触发 drei `useGLTF` 抛错 → 无 ErrorBoundary 时整页白屏（2026-09-11 线上实测复现）。
 */
import { publicUrl } from '../assets/publicUrl.ts'

/** 内置素体模型（Quaternius Universal Animation Library，CC0；见 public/models/LICENSE.md） */
export const BUILTIN_CHARACTER_MODEL_URL = publicUrl('models/quaternius-universal-character.glb')
