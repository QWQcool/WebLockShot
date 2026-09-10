import { useEffect, useRef, useState } from 'react'
import { useEditor, useValue, type JsonObject, type TLShapeId } from 'tldraw'
import { scriptToStory } from '../director/nodes/storyboardNode.ts'
import { ShotStage } from '../stage/ShotStage.tsx'
import { useShotTimeline } from '../stage/useShotTimeline.ts'
import type { Story } from '../types.ts'
import {
  CANVAS_NODE_SHAPE_TYPE,
  readScriptMetaPayload,
  readStoryboardMetaPayload,
  scriptDigest,
  writeStoryboardMetaPayload,
} from './contract.ts'
import {
  describeShotPlanSource,
  frameSequenceToShotPlan,
  readShotPlanMetaPayload,
  readStage3DFrameSequence,
  stage3dFramesDigest,
  writeShotPlanMetaPayload,
  type CanvasShotPlan,
  type Stage3DFrameSequence,
} from './stage3dFrames.ts'
import { FrameThumb } from './FrameThumb.tsx'
import type { WlsNodeShape } from './WlsNodeUtil.tsx'

/**
 * B3 分镜预演节点内嵌 UI（CANVAS_PLAN.md §9 B3）+ D3「3D 台自由分镜」来源模式。
 *
 * 两种来源互斥（写 meta 时互相剔除痕迹键）：
 * - **script → 6 镜**（既有）：scriptToStory 生成标准 6 镜 Story，内嵌 ShotStage 9:16 预演；
 * - **stage3d → 自由镜数分镜**（D3）：读上游 stage3d 节点导出的机位帧序列（meta.stage3dFrames），
 *   镜数 = 机位数（1~12 不伪造不截断），每镜帧图/相机参数/运镜文字齐备（C 升级口轨迹随帧入库）。
 *
 * 诚实边界：本地预演不是成片；自由分镜镜数超上限诚实拒绝。
 * 性能红线：timeline 默认 paused；控件级 stopPropagation（B2 约定）。
 */

/** prefers-reduced-motion 订阅（ShotStage 静帧模式开关） */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return reduced
}

/** 上游 script 节点的 meta.script（沿指入箭头找 kind=script 的节点），tldraw 响应式 */
function useUpstreamScript(editor: ReturnType<typeof useEditor>, shapeId: TLShapeId) {
  return useValue(
    'upstreamScriptPayload',
    () => {
      for (const binding of editor.getBindingsToShape(shapeId, 'arrow')) {
        const arrow = editor.getShape(binding.fromId)
        if (!arrow) continue
        const start = editor
          .getBindingsFromShape(arrow, 'arrow')
          .find((b) => (b.props as { terminal?: unknown }).terminal === 'start')
        if (!start || start.toId === shapeId) continue
        const src = editor.getShape(start.toId)
        if (!src || src.type !== CANVAS_NODE_SHAPE_TYPE) continue
        if ((src.props as { kind?: unknown }).kind !== 'script') continue
        const payload = readScriptMetaPayload((src.props as { meta?: unknown }).meta)
        if (payload?.script) return payload
      }
      return null
    },
    [editor, shapeId]
  )
}

/** D3：上游 stage3d 节点的 meta.stage3dFrames（机位帧序列），tldraw 响应式 */
function useUpstreamStage3dFrames(
  editor: ReturnType<typeof useEditor>,
  shapeId: TLShapeId
): Stage3DFrameSequence | null {
  return useValue(
    'upstreamStage3dFrames',
    () => {
      for (const binding of editor.getBindingsToShape(shapeId, 'arrow')) {
        const arrow = editor.getShape(binding.fromId)
        if (!arrow) continue
        const start = editor
          .getBindingsFromShape(arrow, 'arrow')
          .find((b) => (b.props as { terminal?: unknown }).terminal === 'start')
        if (!start || start.toId === shapeId) continue
        const src = editor.getShape(start.toId)
        if (!src || src.type !== CANVAS_NODE_SHAPE_TYPE) continue
        if ((src.props as { kind?: unknown }).kind !== 'stage3d') continue
        const seq = readStage3DFrameSequence((src.props as { meta?: unknown }).meta)
        if (seq) return seq
      }
      return null
    },
    [editor, shapeId]
  )
}

/** 内嵌 9:16 预演舞台（story 存在时才挂载，timeline 默认 paused 不占 ticker） */
function StoryboardStage({ story }: { story: Story }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const timeline = useShotTimeline(story, reducedMotion, rootRef, story.id)
  const current = story.shots[timeline.shotIndex] ?? story.shots[0]

  return (
    <div className="wls-storyboard-stage">
      <div
        ref={rootRef}
        className="wls-storyboard-viewport"
        style={{ width: '100%', aspectRatio: '9 / 16', position: 'relative', overflow: 'hidden' }}
      >
        {story.shots.map((shot, idx) => (
          <div
            key={shot.id}
            style={{ display: idx === timeline.shotIndex ? 'block' : 'none', height: '100%' }}
          >
            <ShotStage story={story} shot={shot} />
          </div>
        ))}
      </div>
      {/* 控件级 stopPropagation（B2 标准）：预演区放行事件流，仅按钮阻断 */}
      <div className="wls-storyboard-controls">
        <button
          type="button"
          className="wls-storyboard-play"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={timeline.playing ? timeline.pause : timeline.play}
        >
          {timeline.playing ? '⏸ 暂停' : '▶️ 播放'}
        </button>
        <span className="wls-storyboard-indicator">
          镜 {current.order}/{story.shots.length} · {timeline.time.toFixed(1)}/
          {timeline.duration.toFixed(1)}s
        </span>
        <span className="wls-storyboard-note" title="本地 GSAP 预演仅用于锁节奏与构图，不是生成视频">
          本地预演 · 非成片
        </span>
      </div>
    </div>
  )
}

/** D3：自由镜数分镜列表（镜数 = 机位数；每镜帧图 + 运镜文字 + 相机参数） */
function ShotPlanList({ plan, source }: { plan: CanvasShotPlan; source: string }) {
  return (
    <div className="wls-storyboard-shots" data-testid="wls-shotplan">
      <div className="wls-storyboard-shots-head" title={source}>
        🎥 {source} · 本地预演 · 非成片
      </div>
      {plan.shots.map((shot, i) => (
        <div className="wls-storyboard-shot" key={`${i}-${shot.frameRef}`} data-testid="wls-shotplan-shot">
          <FrameThumb
            frameRef={shot.frameRef}
            alt={`镜 ${i + 1} 帧`}
            className="wls-storyboard-shot-thumb"
          />
          <div className="wls-storyboard-shot-meta">
            <span className="wls-storyboard-shot-order">镜 {i + 1}</span>
            <span className="wls-storyboard-shot-motion" title={shot.motionText}>
              {shot.motionText}
            </span>
            <span className="wls-storyboard-shot-cam">
              机位 ({shot.camera.position.map((n) => Math.round(n * 10) / 10).join(', ')}) · FOV{' '}
              {shot.camera.fov}°
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function StoryboardNodeBody({ shape }: { shape: WlsNodeShape }) {
  const editor = useEditor()
  const meta = shape.props.meta
  const result = readStoryboardMetaPayload(meta)
  const planResult = readShotPlanMetaPayload(meta)
  const upstream = useUpstreamScript(editor, shape.id)
  const upstreamStage3d = useUpstreamStage3dFrames(editor, shape.id)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 来源互斥：script 优先（既有行为不变）；无 script 上游时启用 3D 台自由分镜来源
  const scriptMode = upstream !== null
  const stage3dMode = !scriptMode && upstreamStage3d !== null

  // 上游脚本变更检测（沿 B2 upstreamText 快照模式，改用摘要指纹）
  const staleScript =
    result !== null && upstream !== null && scriptDigest(upstream.script) !== result.scriptDigest
  // D3：上游机位帧变更检测
  const staleStage3d =
    planResult !== null &&
    upstreamStage3d !== null &&
    stage3dFramesDigest(upstreamStage3d) !== planResult.stage3dDigest

  /** script → 6 镜（既有链路，零改动） */
  const handleGenerateScript = () => {
    if (!upstream?.script) {
      setError('未连入已生成脚本的 script 节点：先连线 script→storyboard 并在 script 节点生成脚本')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const story = scriptToStory(upstream.script, upstream.script.logline.slice(0, 30))
      const nextMeta = writeStoryboardMetaPayload({ ...meta }, {
        story,
        scriptDigest: scriptDigest(upstream.script),
        scriptLogline: upstream.script.logline,
      })
      if (!nextMeta) {
        setError('分镜结果未通过契约校验，已拒绝写入（诚实失败，不半渲染）')
        return
      }
      editor.updateShape({
        id: shape.id,
        type: shape.type,
        props: { meta: nextMeta as JsonObject },
      })
    } catch (err) {
      setError(`分镜生成失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setBusy(false)
    }
  }

  /** D3：stage3d 机位帧序列 → 自由镜数分镜（镜数 = 机位数，1~12） */
  const handleGenerateStage3d = () => {
    if (!upstreamStage3d) {
      setError('未连入已导出执导帧的 stage3d 节点：先进入 3D 运镜台点「导出分镜（全部机位）」')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const check = frameSequenceToShotPlan(upstreamStage3d)
      if (!check.ok) {
        setError(check.reason)
        return
      }
      const nextMeta = writeShotPlanMetaPayload({ ...meta }, {
        shotPlan: check.plan,
        stage3dDigest: stage3dFramesDigest(upstreamStage3d),
        stage3dSource: describeShotPlanSource(upstreamStage3d),
      })
      if (!nextMeta) {
        setError('自由分镜未通过契约校验，已拒绝写入（诚实失败，不半渲染）')
        return
      }
      editor.updateShape({
        id: shape.id,
        type: shape.type,
        props: { meta: nextMeta as JsonObject },
      })
    } catch (err) {
      setError(`自由分镜生成失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setBusy(false)
    }
  }

  const handleGenerate = () => {
    if (busy) return
    if (scriptMode) {
      handleGenerateScript()
      return
    }
    if (stage3dMode) {
      handleGenerateStage3d()
      return
    }
    setError('未连入上游：先连线 script→storyboard（6 镜）或 stage3d→storyboard（3D 台自由分镜）')
  }

  return (
    <div className="wls-storyboard">
      {result ? (
        <div className="wls-storyboard-source" title={result.scriptLogline}>
          📝 来自脚本：{result.scriptLogline}
        </div>
      ) : planResult ? (
        <div className="wls-storyboard-source" title={planResult.stage3dSource}>
          🎥 来自 3D 运镜台：{planResult.stage3dSource}
        </div>
      ) : upstream ? (
        <div className="wls-storyboard-upstream" title={upstream.script.logline}>
          🔗 上游脚本就绪：{upstream.script.logline}
        </div>
      ) : upstreamStage3d ? (
        <div
          className="wls-storyboard-upstream"
          title={upstreamStage3d.frames.map((f) => f.cameraName).join('、')}
        >
          🔗 上游机位帧就绪：{upstreamStage3d.frames.length} 机位（镜数=机位数）
        </div>
      ) : (
        <div className="wls-storyboard-hint">
          连入 script 节点（生成 6 镜）或 stage3d 节点（3D 台自由分镜），再生成分镜
        </div>
      )}

      {staleScript && (
        <div className="wls-storyboard-stale" role="status">
          ↕️ 上游脚本已更新，重新生成分镜可同步（不自动覆盖已生成分镜）
        </div>
      )}
      {staleStage3d && (
        <div className="wls-storyboard-stale" role="status">
          ↕️ 上游机位帧已更新，重新生成自由分镜可同步（不自动覆盖已生成分镜）
        </div>
      )}

      {/* 控件级 stopPropagation（B2 标准）：仅按钮阻断 */}
      <button
        type="button"
        className="wls-storyboard-generate"
        disabled={busy || (!scriptMode && !stage3dMode)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={handleGenerate}
      >
        {busy
          ? '🎞️ 编译中…'
          : scriptMode
            ? result
              ? '🔄 重新生成分镜'
              : '🎬 生成分镜'
            : stage3dMode
              ? planResult
                ? '🔄 重新生成分镜'
                : '🎬 生成 3D 自由分镜'
              : '🎬 生成分镜'}
      </button>

      {error && <div className="wls-storyboard-error">⚠️ {error}</div>}

      {result && <StoryboardStage story={result.story} />}
      {planResult && (
        <ShotPlanList plan={planResult.shotPlan} source={planResult.stage3dSource} />
      )}
    </div>
  )
}
