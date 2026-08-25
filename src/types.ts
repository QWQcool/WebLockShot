export const MOTION_IDS = [
  'push_in',
  'pull_out',
  'pan_left',
  'pan_right',
  'follow',
  'cut',
  'enter_stage',
  'line_pop',
] as const

export type MotionId = (typeof MOTION_IDS)[number]

export const SHOT_SIZES = ['ecu', 'cu', 'ms', 'ws'] as const
export type ShotSize = (typeof SHOT_SIZES)[number]

export const PROP_IDS = ['none', 'door', 'note', 'lock'] as const
export type PropId = (typeof PROP_IDS)[number]

export const SHOT_SIZE_LABEL: Record<ShotSize, string> = {
  ecu: '大特写',
  cu: '特写',
  ms: '中景',
  ws: '全景',
}

export const MOTION_LABEL: Record<MotionId, string> = {
  push_in: '缓慢推近',
  pull_out: '拉远',
  pan_left: '镜头左摇',
  pan_right: '镜头右摇',
  follow: '跟移主体',
  cut: '硬切',
  enter_stage: '人物入画',
  line_pop: '对白上屏',
}

export type StoryInput = {
  theme: string
  character: string
  conflict: string
  hook: string
}

export type Character = {
  id: string
  name: string
  color: string
  /** 外貌/服装一句，导出时每镜重复，防换脸 */
  anchor: string
}

export type Setting = {
  place: string
  time: string
  light: string
}

export type Shot = {
  id: string
  order: 1 | 2 | 3 | 4 | 5 | 6
  purpose: string
  shotSize: ShotSize
  motionId: MotionId
  durationSec: number
  cast: string[]
  line: string
  lineSpeaker?: string
  /** 封闭道具集；缺省视为 none */
  prop?: PropId
  /** 仅预设文件使用；模型输出不要带 alts */
  alts?: Shot[]
}

export type Story = {
  id: string
  title: string
  input: StoryInput
  characters: Character[]
  setting: Setting
  shots: Shot[]
}

export type EditorMode = 'preset' | 'token'

export type TokenConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export const TOKEN_STORAGE_KEY = 'weblockshot.token' as const
