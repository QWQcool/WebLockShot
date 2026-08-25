import type { EditorMode } from './types'

export const DEFAULT_MODE: EditorMode = 'preset'

export function modeLabel(mode: EditorMode): string {
  return mode === 'preset' ? '预设模拟' : '自带 Token'
}

export function modeFooter(mode: EditorMode): string {
  return mode === 'preset'
    ? '当前为预设模拟 · 未消耗 Token · 数据来自仓库 presets/'
    : '当前为自带 Token · 密钥只存在本标签页会话 · 刷新需重填'
}
