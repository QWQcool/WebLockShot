import type { EditorMode } from './types'

export const DEFAULT_MODE: EditorMode = 'preset'

export function modeLabel(mode: EditorMode): string {
  return mode === 'preset' ? '预设模拟' : '自带 Token'
}

export function modeFooter(mode: EditorMode): string {
  return mode === 'preset'
    ? '当前为预设模拟 · 仅供预览网站功能 · 不能改台词和运动 · 未消耗 Token'
    : '当前为自带 Token · 可改主题和分镜 · 密钥只存在本标签页会话 · 刷新需重填'
}
