import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, useValue, type JsonObject, type TLShapeId } from 'tldraw'
import { ExecutorEngine } from '../director/nodes/executorNode.ts'
import type { ShotJob } from '../domain/shotJob.ts'
import { VisualPlanSchema } from '../domain/sellVisual.ts'
import { walletManager } from '../domain/wallet.ts'
import {
  getAssetObjectUrl,
  idbRefToId,
  isIdbRef,
  putBlobAsset,
} from '../persist/assetStore.ts'
import {
  createNodeId,
  nodeIdToShapeId,
  readGenerateMetaPayload,
  readStoryboardMetaPayload,
  scriptDigest,
  writeGenerateMetaPayload,
  type Artifact,
} from './contract.ts'
import type { WlsNodeShape } from './WlsNodeUtil.tsx'

/**
 * B4 出片生成节点内嵌 UI（CANVAS_PLAN.md §9 B4）。
 *
 * - 生成走 ExecutorEngine 串行队列（每节点独立实例）：钱包两阶段事务 / 熔断 / 幂等 /
 *   FSM 状态机 / 轮询窗口全部复用既有实现，画布层零复制（sell 单例引擎不受影响）；
 * - 输入：连入 storyboard 节点 meta.story（边拓扑 script→storyboard→generate）；
 * - 引擎本期仅开放 Mock 实验画布（0 灵感币/镜）；可灵/即梦未接通如实禁用标注；
 * - 大资产：Mock 产物为 blob objectURL（跨刷新失效），出片后立即转存 IndexedDB，
 *   meta/产物卡只存 idbref:// 引用；
 * - 取消：ExecutorEngine 无取消 API，如实不提供（生成中刷新=中断，冻结款由钱包孤儿回收兜底）；
 * - 控件级 stopPropagation（B2 标准）：仅按钮阻断。
 */

const STATUS_LABEL: Record<Artifact['status'], string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已出片',
  failed: '失败',
}

function hasProviderKey(providerId: 'kling' | 'jimeng'): boolean {
  try {
    const raw = sessionStorage.getItem(`weblockshot.${providerId}_key`)
    return Boolean(raw?.trim())
  } catch {
    return false
  }
}

/** 沿指入箭头找 storyboard 节点的 meta.story，tldraw 响应式 */
function useUpstreamStoryboard(editor: ReturnType<typeof useEditor>, shapeId: TLShapeId) {
  return useValue(
    'upstreamStoryboard',
    () => {
      for (const binding of editor.getBindingsToShape(shapeId, 'arrow')) {
        const arrow = editor.getShape(binding.fromId)
        if (!arrow) continue
        const start = editor
          .getBindingsFromShape(arrow, 'arrow')
          .find((b) => (b.props as { terminal?: unknown }).terminal === 'start')
        if (!start || start.toId === shapeId) continue
        const src = editor.getShape(start.toId)
        if (!src || src.type !== 'wls-node') continue
        if ((src.props as { kind?: unknown }).kind !== 'storyboard') continue
        const payload = readStoryboardMetaPayload((src.props as { meta?: unknown }).meta)
        if (payload) return payload
      }
      return null
    },
    [editor, shapeId]
  )
}

export function GenerateNodeBody({ shape }: { shape: WlsNodeShape }) {
  const editor = useEditor()
  const meta = shape.props.meta
  const result = readGenerateMetaPayload(meta)
  const upstream = useUpstreamStoryboard(editor, shape.id)

  // 每节点独立引擎实例：复用 ExecutorEngine 全部队列/钱包/FSM 语义，不碰 sell 单例
  const engineRef = useRef<ExecutorEngine | null>(null)
  if (!engineRef.current) engineRef.current = new ExecutorEngine()
  const engine = engineRef.current

  const [jobs, setJobs] = useState<ShotJob[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playingArtifact, setPlayingArtifact] = useState<string | null>(null)
  // 生成时上游 story 的摘要快照（产物条目写入 meta 时使用，与 B2/B3 模式一致）
  const storyDigestRef = useRef('')
  // 最新上游（subscribe 回调内使用，避免 effect 依赖链）
  const upstreamRef = useRef(upstream)
  upstreamRef.current = upstream

  const story = upstream?.story ?? null
  const costPerShot = walletManager.getCost('mock', 1)
  const totalCost = costPerShot * (story?.shots.length ?? 0)

  /** 读取本节点当前 meta（getShape 返回宽型 shape，需窄化为 wls-node） */
  const readSelfMeta = (): Record<string, unknown> => {
    const s = editor.getShape(shape.id)
    if (!s || s.type !== 'wls-node') return {}
    return s.props.meta as unknown as Record<string, unknown>
  }

  /** 产物条目落盘（仅终态写 meta，与 B2/B3 读写模式一致） */
  const markArtifact = (shotId: string, status: Artifact['status'], url?: string, err?: string) => {
    const order = Number(shotId.split('-s').pop()) || 1
    const baseMeta = readSelfMeta()
    const current = readGenerateMetaPayload(baseMeta)
    const list = current?.artifacts ?? []
    const next: Artifact[] = [
      ...list.filter((a) => a.shotId !== shotId),
      { shotId, order, status, ...(url ? { url } : {}), ...(err ? { error: err } : {}) },
    ].sort((a, b) => a.order - b.order)
    const nextMeta = writeGenerateMetaPayload(baseMeta, {
      providerId: 'mock',
      artifacts: next,
      storyDigest: storyDigestRef.current,
    })
    if (!nextMeta) return
    editor.updateShape({ id: shape.id, type: shape.type, props: { meta: nextMeta as JsonObject } })
  }

  /** 画布创建/更新产物卡（kind='asset'）：按 shotId 检索——已有卡就原地替换 url（重建防堆积，不依赖组件内存 ref） */
  const createAssetCard = (shotId: string, url: string) => {
    const self = editor.getShape(shape.id)
    if (!self || self.type !== 'wls-node') return
    const existing = editor
      .getCurrentPageShapes()
      .find(
        (s): s is WlsNodeShape =>
          s.type === 'wls-node' &&
          (s.props as { kind?: unknown }).kind === 'asset' &&
          (s.props as { meta?: Record<string, unknown> }).meta?.shotId === shotId
      )
    if (existing) {
      const meta = { ...(existing.props.meta as unknown as Record<string, unknown>) }
      meta.url = url
      meta.createdAt = Date.now()
      editor.updateShape({
        id: existing.id,
        type: existing.type,
        props: { meta: meta as JsonObject },
      })
      return
    }
    const story = upstreamRef.current?.story
    const shot = story?.shots.find((s) => `${story.id}-${s.id}` === shotId)
    const count = editor.getCurrentPageShapes().filter(
      (s) => s.type === 'wls-node' && (s.props as { kind?: unknown }).kind === 'asset'
    ).length
    const nodeId = createNodeId()
    editor.createShape({
      id: nodeIdToShapeId(nodeId) as TLShapeId,
      type: 'wls-node',
      x: self.x + self.props.w + 60 + Math.floor(count / 2) * 240,
      y: self.y + (count % 2) * 400,
      props: {
        w: 200,
        h: 380,
        kind: 'asset',
        meta: {
          type: 'video',
          url,
          shotId,
          createdAt: Date.now(),
          ...(shot?.line ? { title: shot.line.slice(0, 40) } : {}),
        } as JsonObject,
      },
    })
  }

  /** 出片成功：blob 产物转存 IndexedDB → 产物条目持久化 → 画布创建产物卡 */
  const handleJobSucceeded = useCallback(
    async (job: ShotJob) => {
      if (!job.asset?.url) return
      const shotId = job.shotId
      let ref = job.asset.url
      if (job.asset.url.startsWith('blob:')) {
        // blob objectURL 跨刷新失效：立即转存 IndexedDB（转存失败则如实标记不可用）
        try {
          const blob = await (await fetch(job.asset.url)).blob()
          const stored = await putBlobAsset(`canvas-asset-${shotId}`, blob)
          if (stored) {
            ref = stored
          } else {
            markArtifact(shotId, 'failed', undefined, '产物转存 IndexedDB 失败，请重新生成')
            return
          }
        } catch {
          markArtifact(shotId, 'failed', undefined, '产物读取失败（blob 已失效），请重新生成')
          return
        }
      }
      markArtifact(shotId, 'succeeded', `${ref}?v=${Date.now()}`)
      createAssetCard(shotId, `${ref}?v=${Date.now()}`)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markArtifact/createAssetCard 闭包仅依赖 editor 与 ref（稳定）
    [editor]
  )

  // 订阅引擎任务流：UI 状态 + 成功产物落档/建卡。
  // succeeded 每次都处理（不做内存 ref 去重——tldraw 虚拟化下组件 remount 会清空 ref 导致堆积）：
  // 幂等性由 markArtifact（按 shotId 覆盖）+ putBlobAsset（同 key 覆盖）+ createAssetCard（检索替换）保证。
  useEffect(() => {
    const unsub = engine.subscribe((latest) => {
      setJobs([...latest])
      for (const j of latest) {
        if (j.status === 'succeeded') {
          void handleJobSucceeded(j)
        }
      }
    })
    return unsub
  }, [engine, handleJobSucceeded])

  const handleGenerate = async () => {
    if (busy || !story) return
    setBusy(true)
    setError(null)
    storyDigestRef.current = scriptDigest(story)
    try {
      const plans = story.shots.map((shot) =>
        VisualPlanSchema.parse({
          shotId: `${story.id}-${shot.id}`,
          order: shot.order,
          positive: `${shot.purpose}。${shot.line || '高质量商业镜头'}`,
          caption: shot.line,
          durationSec: shot.durationSec,
        })
      )
      await engine.enqueueShots(plans, 'mock')
    } catch (err) {
      setError(`任务入队失败：${err instanceof Error ? err.message : '未知错误'}`)
      setBusy(false)
    }
  }

  // 队列完成（全部到终态）后解除 busy
  const running = jobs.some((j) => j.status === 'queued' || j.status === 'running')
  useEffect(() => {
    if (busy && jobs.length > 0 && !running) setBusy(false)
  }, [busy, jobs.length, running])

  const staleStory =
    result !== null && upstream !== null && scriptDigest(upstream.story) !== result.storyDigest
  const artifacts = result?.artifacts ?? []
  const succeededCount = artifacts.filter((a) => a.status === 'succeeded').length
  const playing = artifacts.find((a) => a.shotId === playingArtifact && a.status === 'succeeded')

  return (
    <div className="wls-generate">
      {story ? (
        <div className="wls-generate-upstream" title={story.title}>
          🔗 上游分镜就绪：{story.shots.length} 镜 · {story.title}
        </div>
      ) : (
        <div className="wls-generate-hint">连入 storyboard 节点并生成分镜后，可逐镜出片</div>
      )}

      {staleStory && (
        <div className="wls-generate-stale" role="status">
          ↕️ 上游分镜已更新，重新生成可同步（不自动覆盖已有产物）
        </div>
      )}

      {/* 引擎与成本（诚实标注）：Mock 本身是合法引擎，非演示；可灵/即梦画布本期未接通 */}
      <div className="wls-generate-engine">
        <span className="wls-generate-engine-tag">Mock 实验画布</span>
        <span className="wls-generate-cost">
          {story ? `${story.shots.length} 镜 · ${totalCost} 灵感币` : '— 灵感币'}
        </span>
      </div>
      <div className="wls-generate-engine-note">
        可灵 / 即梦{hasProviderKey('kling') || hasProviderKey('jimeng') ? '（已配置 Key，画布模式暂未开放）' : '（未配置 Key）'}暂不可用，请走带货工作台
      </div>

      <button
        type="button"
        className="wls-generate-run"
        disabled={busy || !story}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => void handleGenerate()}
      >
        {busy ? '⚙️ 串行出片中…' : result ? '🔄 重新生成全部' : '⚙️ 开始逐镜出片'}
      </button>
      <div className="wls-generate-cancel-note">
        生成不支持中途取消；刷新页面会中断任务，未完成镜不扣费（冻结款由钱包孤儿回收兜底）
      </div>

      {error && <div className="wls-generate-error">⚠️ {error}</div>}

      {/* 产物列表：镜号 + 状态 + 播放（B2/B3 控件级阻断只作用于按钮） */}
      {(jobs.length > 0 || artifacts.length > 0) && (
        <div className="wls-generate-artifacts">
          <div className="wls-generate-artifacts-head">
            产物 {succeededCount}/{(story?.shots.length ?? 0)} 已出片
          </div>
          {(jobs.length > 0
            ? jobs.map((j) => ({
                shotId: j.shotId,
                order: Number(j.shotId.split('-s').pop()) || 1,
                status: j.status as Artifact['status'],
                url: j.asset?.url,
                error: j.error,
              }))
            : artifacts
          )
            .sort((a, b) => a.order - b.order)
            .map((a) => (
              <button
                key={a.shotId}
                type="button"
                className={`wls-generate-artifact status-${a.status}`}
                disabled={a.status !== 'succeeded'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setPlayingArtifact(a.shotId === playingArtifact ? null : a.shotId)}
              >
                <span className="wls-generate-artifact-order">镜 {a.order}</span>
                <span className="wls-generate-artifact-status">{STATUS_LABEL[a.status]}</span>
                {a.status === 'succeeded' && <span className="wls-generate-artifact-play">▶</span>}
              </button>
            ))}
          {playing && <ArtifactPlayer artifact={playing} />}
        </div>
      )}
    </div>
  )
}

/** 产物内嵌播放器：idbref 引用按需 hydrate 为 blob objectURL（大资产不进 meta） */
function ArtifactPlayer({ artifact }: { artifact: Artifact }) {
  const missingUrl = !artifact.url
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (missingUrl || !artifact.url) return
    let revoked: string | null = null
    let cancelled = false
    // IndexedDB 异步 hydrate：所有 setState 均在 await 之后，不同步触发重渲染
    void (async () => {
      if (isIdbRef(artifact.url)) {
        const u = await getAssetObjectUrl(idbRefToId(artifact.url))
        if (cancelled) return
        if (u) {
          revoked = u
          setSrc(u)
        } else {
          setErr('IndexedDB 资产读取失败，请重新生成')
        }
      } else {
        setSrc(artifact.url ?? null)
      }
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [missingUrl, artifact.url])

  if (missingUrl) return <div className="wls-generate-error">⚠️ 产物引用缺失，请重新生成</div>

  if (err) return <div className="wls-generate-error">⚠️ {err}</div>
  if (!src) return <div className="wls-generate-busy">产物加载中…</div>
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- 播放器自带控制条
    <video className="wls-generate-player" src={src} controls playsInline onPointerDown={(e) => e.stopPropagation()} />
  )
}
