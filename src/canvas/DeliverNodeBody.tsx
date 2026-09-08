import { useEffect, useState } from 'react'
import { useEditor, useValue, type JsonObject, type TLShapeId } from 'tldraw'
import { downloadJianyingDraftZip, buildJianyingZipPackage } from '../export/jianyingDraft.ts'
import { walletManager } from '../domain/wallet.ts'
import type { ShotJob } from '../domain/shotJob.ts'
import type { Story } from '../types.ts'
import { probeCompanion, sendDraftZipToCompanion } from '../services/companion/companionClient.ts'
import { getAssetObjectUrl, idbRefToId, isIdbRef } from '../persist/assetStore.ts'
import {
  CANVAS_NODE_SHAPE_TYPE,
  readAssetMetaPayload,
  readDeliverMetaPayload,
  readGenerateMetaPayload,
  writeDeliverMetaPayload,
} from './contract.ts'
import type { WlsNodeShape } from './WlsNodeUtil.tsx'

/**
 * B5 成片交付节点内嵌 UI（CANVAS_PLAN.md §9 B5）。
 *
 * - 输入：沿指入边收集 asset 卡产物（video/image）与 generate 节点 meta.artifacts；
 * - 一键打包剪映草稿 zip：复用 src/export/jianyingDraft.ts 既有链路（视频轨+字幕轨对齐），
 *   idbref 引用先 hydrate 为 blob objectURL 再传入（zip 打包内部 fetch(url) 不识别 idbref）；
 * - 诚实边界：图片不入剪映视频轨（跳过并计数）；伴生服务 /healthz 探测失败提示「在线落盘请启动伴生服务」；
 * - 钱包余额：walletManager 只读订阅（对齐钱包模态展示口径），零复制资金逻辑；
 * - 控件级 stopPropagation（B2 标准）：仅按钮阻断。
 */

/** 钱包余额只读订阅（walletManager 单例 + subscribe，零复制） */
function useWalletBalance(): { balance: number; frozen: number; total: number } {
  const [snap, setSnap] = useState(() =>
    typeof walletManager.getSnapshot === 'function'
      ? walletManager.getSnapshot()
      : { balance: 0, frozen: 0, total: 0 }
  )
  useEffect(() => {
    const sync = () => setSnap(walletManager.getSnapshot())
    sync()
    return walletManager.subscribe(sync)
  }, [])
  return snap
}

type DeliverItem = {
  kind: 'video' | 'image'
  url: string
  shotId: string
  title?: string
}

/** 沿指入边收集产物：asset 卡 + generate 节点 meta.artifacts（按 shotId/url 去重） */
function useCollectedItems(editor: ReturnType<typeof useEditor>, shapeId: TLShapeId) {
  return useValue(
    'deliverCollectedItems',
    () => {
      const items: DeliverItem[] = []
      const seen = new Set<string>()
      let story: Story | null = null
      for (const binding of editor.getBindingsToShape(shapeId, 'arrow')) {
        const arrow = editor.getShape(binding.fromId)
        if (!arrow) continue
        const start = editor
          .getBindingsFromShape(arrow, 'arrow')
          .find((b) => (b.props as { terminal?: unknown }).terminal === 'start')
        if (!start || start.toId === shapeId) continue
        const src = editor.getShape(start.toId)
        if (!src || src.type !== CANVAS_NODE_SHAPE_TYPE) continue
        const srcMeta = (src.props as { meta?: unknown }).meta
        const kind = (src.props as { kind?: unknown }).kind

        if (kind === 'asset') {
          const payload = readAssetMetaPayload(srcMeta)
          if (payload) {
            const key = payload.url
            if (!seen.has(key)) {
              seen.add(key)
              items.push({ kind: payload.type, url: payload.url, shotId: payload.shotId, title: payload.title })
            }
          }
        }

        if (kind === 'generate') {
          const payload = readGenerateMetaPayload(srcMeta)
          if (payload) {
            if (payload.story && !story) story = payload.story
            for (const a of payload.artifacts) {
              if (a.status !== 'succeeded' || !a.url) continue
              if (!seen.has(a.url)) {
                seen.add(a.url)
                items.push({ kind: 'video', url: a.url, shotId: a.shotId })
              }
            }
          }
        }
      }
      return { items, story }
    },
    [editor, shapeId]
  )
}

export function DeliverNodeBody({ shape }: { shape: WlsNodeShape }) {
  const editor = useEditor()
  const meta = shape.props.meta
  const result = readDeliverMetaPayload(meta)
  const { items, story } = useCollectedItems(editor, shape.id)
  const wallet = useWalletBalance()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [companion, setCompanion] = useState<{ available: boolean; draftZip: boolean } | null>(null)

  // 伴生服务 /healthz 探测（沿用既有交互模式：探测失败 = 按钮不出现 + 诚实提示）
  useEffect(() => {
    let cancelled = false
    void probeCompanion().then((r) => {
      if (!cancelled) setCompanion({ available: r.available, draftZip: r.draftZip })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const videos = items.filter((i) => i.kind === 'video')
  const images = items.filter((i) => i.kind === 'image')

  /** 收集的产物 → ShotJob[]（idbref 先 hydrate 为 blob objectURL，zip 打包内部 fetch 需要） */
  const buildJobs = async (): Promise<ShotJob[]> => {
    const jobs: ShotJob[] = []
    for (const item of videos) {
      let url = item.url
      if (isIdbRef(url)) {
        const u = await getAssetObjectUrl(idbRefToId(url))
        if (!u) continue // hydrate 失败如实跳过
        url = u
      }
      const dur = story?.shots.find((s) => `${story.id}-${s.id}` === item.shotId)?.durationSec ?? 3
      jobs.push({
        shotId: item.shotId,
        taskKey: `deliver-${item.shotId}`,
        provider: 'mock',
        status: 'succeeded',
        attempt: 1,
        asset: { shotId: item.shotId, url, durationSec: dur },
        progress: 100,
      })
    }
    return jobs
  }

  const handlePackage = async (mode: 'download' | 'companion') => {
    if (busy) return
    if (videos.length === 0) {
      setError('没有可打包的视频产物：请先连入 generate/asset 节点并完成出片')
      return
    }
    if (!story) {
      setError('未找到分镜工程数据（story）：请连入 generate 节点（其 meta 携带 story 快照）后重试')
      return
    }
    setBusy(true)
    setError(null)
    setOkMsg(null)
    try {
      const jobs = await buildJobs()
      if (jobs.length === 0) {
        setError('产物引用 hydrate 失败（IndexedDB 读取异常），请重新生成产物')
        return
      }
      const projectTitle = story.title || 'WebLockShot_画布交付工程'
      if (mode === 'download') {
        await downloadJianyingDraftZip({ story, jobs, projectTitle })
      } else {
        const pkg = await buildJianyingZipPackage({ story, jobs, projectTitle })
        const sent = await sendDraftZipToCompanion(pkg.bytes)
        if (!sent.ok) {
          setError(`落盘失败：${sent.error}。可改用「下载 zip 包」手动解压。`)
          return
        }
        setOkMsg(`✅ 已落盘到伴生服务：${sent.savedPath}（${sent.files.length} 个文件）`)
      }
      const nextMeta = writeDeliverMetaPayload({ ...meta }, {
        lastPackagedAt: Date.now(),
        videoCount: jobs.length,
        imageSkipped: images.length,
      })
      if (nextMeta) {
        editor.updateShape({
          id: shape.id,
          type: shape.type,
          props: { meta: nextMeta as JsonObject },
        })
      }
      if (mode === 'download') {
        setOkMsg(
          `✅ 已下载剪映草稿 zip（${jobs.length} 镜视频）${images.length > 0 ? `；${images.length} 张图片不入剪映视频轨，已跳过` : ''}`
        )
      }
    } catch (err) {
      setError(`打包失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wls-deliver">
      {/* 钱包余额（只读订阅，对齐钱包模态口径） */}
      <div className="wls-deliver-wallet">
        💰 灵感币余额 <strong>{wallet.balance}</strong>
        {wallet.frozen > 0 && <span className="wls-deliver-frozen">（冻结 {wallet.frozen}）</span>}
      </div>

      <div className="wls-deliver-items">
        {items.length === 0 ? (
          <div className="wls-deliver-hint">
            连入 generate / asset 节点（产物卡）后，此处汇总产物并打包剪映草稿
          </div>
        ) : (
          <>
            <div className="wls-deliver-count">
              🎬 视频产物 {videos.length} 镜
              {images.length > 0 && ` · 🖼️ 图片 ${images.length} 张（不入剪映轨，打包时跳过）`}
            </div>
            {/* P2-2：videos=0 的引导常驻派生显示（不依赖点击触发 error state） */}
            {videos.length === 0 && (
              <div className="wls-deliver-error" role="alert">
                没有可打包的视频产物：图片不入剪映视频轨，请连入 generate 节点完成出片
              </div>
            )}
            {items.slice(0, 4).map((it) => (
              <div key={it.shotId + it.url} className="wls-deliver-item">
                <span>{it.kind === 'video' ? '🎬' : '🖼️'}</span>
                <span className="wls-deliver-item-name">{it.title || it.shotId.slice(-10)}</span>
              </div>
            ))}
            {items.length > 4 && (
              <div className="wls-deliver-more">…共 {items.length} 条产物</div>
            )}
          </>
        )}
      </div>

      {/* 控件级 stopPropagation（B2 标准）；videos=0 时按钮仍可点，点击后给出诚实引导（B6 任务 0 P2-2） */}
      <button
        type="button"
        className="wls-deliver-pack"
        disabled={busy}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => void handlePackage('download')}
      >
        {busy ? '📦 打包中…' : '📦 打包剪映草稿 zip（纯前端下载）'}
      </button>

      {companion?.draftZip && (
        <button
          type="button"
          className="wls-deliver-pack wls-deliver-companion"
          disabled={busy || videos.length === 0}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void handlePackage('companion')}
        >
          📤 发送到伴生服务落盘
        </button>
      )}
      {companion !== null && !companion.available && (
        <div className="wls-deliver-companion-note">
          🛰️ 在线落盘请启动伴生服务（当前未探测到 /healthz）——不影响本地 zip 下载
        </div>
      )}

      {error && <div className="wls-deliver-error">⚠️ {error}</div>}
      {okMsg && <div className="wls-deliver-ok" role="status">{okMsg}</div>}

      {result?.lastPackagedAt && (
        <div className="wls-deliver-history">
          上次打包：{new Date(result.lastPackagedAt).toLocaleString('zh-CN', { hour12: false })} ·{' '}
          {result.videoCount ?? 0} 镜视频
          {result.imageSkipped ? ` · 跳过图片 ${result.imageSkipped}` : ''}
        </div>
      )}
    </div>
  )
}
