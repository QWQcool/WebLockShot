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
import type { WlsNodeShape } from './WlsNodeUtil.tsx'

/**
 * B3 分镜预演节点内嵌 UI（CANVAS_PLAN.md §9 B3）。
 *
 * - script→story 转换复用 src/director/nodes/storyboardNode.ts 的 scriptToStory（不新写转换）；
 * - 内嵌预演复用 src/stage/ShotStage + useShotTimeline（与 sell/drama 同一组件，零复制）；
 * - 诚实边界：本地 GSAP 预演不是成片，卡片内保留「本地预演 · 非成片」标注；
 * - 性能红线：timeline 默认 paused（无 story/未播放时 GSAP ticker 不运行），▶️ 按需启动不自动播放；
 * - 控件级 stopPropagation（B2 标准约定）：仅播放/生成按钮阻断，预演区放行事件流。
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

export function StoryboardNodeBody({ shape }: { shape: WlsNodeShape }) {
  const editor = useEditor()
  const meta = shape.props.meta
  const result = readStoryboardMetaPayload(meta)
  const upstream = useUpstreamScript(editor, shape.id)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 上游脚本变更检测（沿 B2 upstreamText 快照模式，改用摘要指纹）
  const staleScript =
    result !== null && upstream !== null && scriptDigest(upstream.script) !== result.scriptDigest

  const handleGenerate = () => {
    if (busy) return
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

  return (
    <div className="wls-storyboard">
      {result ? (
        <div className="wls-storyboard-source" title={result.scriptLogline}>
          📝 来自脚本：{result.scriptLogline}
        </div>
      ) : upstream ? (
        <div className="wls-storyboard-upstream" title={upstream.script.logline}>
          🔗 上游脚本就绪：{upstream.script.logline}
        </div>
      ) : (
        <div className="wls-storyboard-hint">
          连入 script 节点（script→storyboard）并生成脚本后，可一键生成分镜
        </div>
      )}

      {staleScript && (
        <div className="wls-storyboard-stale" role="status">
          ↕️ 上游脚本已更新，重新生成分镜可同步（不自动覆盖已生成分镜）
        </div>
      )}

      {/* 控件级 stopPropagation（B2 标准）：仅按钮阻断 */}
      <button
        type="button"
        className="wls-storyboard-generate"
        disabled={busy || !upstream?.script}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={handleGenerate}
      >
        {busy ? '🎞️ 编译中…' : result ? '🔄 重新生成分镜' : '🎬 生成分镜'}
      </button>

      {error && <div className="wls-storyboard-error">⚠️ {error}</div>}

      {result && <StoryboardStage story={result.story} />}
    </div>
  )
}
