import type { MediaAsset, VideoProviderId } from '../domain/shotJob.ts'

export type VideoGenRequest = {
  clientTaskId: string
  prompt: string
  negative?: string
  imageBase64?: string
  durationSec: number
  ratio: '9:16'
  shotId: string
  title?: string
  caption?: string
}

export type PollResult = {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress?: number
  error?: string
}

export interface VideoProvider {
  readonly id: VideoProviderId
  submit(req: VideoGenRequest): Promise<{ taskId: string }>
  poll(taskId: string): Promise<PollResult>
  getAsset(taskId: string): Promise<MediaAsset>
  cancel?(taskId: string): Promise<void>
  estimateCost(req: VideoGenRequest): string
}
