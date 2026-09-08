import { useState } from 'react'
import { useEditor, useValue, type JsonObject } from 'tldraw'
import { critiqueScript } from '../ai/agents/scriptCritic.ts'
import { writeScript } from '../ai/agents/scriptWriter.ts'
import { TOKEN_STORAGE_KEY, type TokenConfig } from '../types.ts'
import {
  CANVAS_NODE_SHAPE_TYPE,
  CANVAS_SCRIPT_SCENES,
  SCRIPT_SCENE_LABEL,
  SCRIPT_SCENE_TEMPLATE_ID,
  briefTextToWriterInput,
  readScriptMetaPayload,
  scriptSceneOf,
  writeScriptMetaPayload,
  type CanvasScriptScene,
  type ScriptMetaPayload,
} from './contract.ts'
import type { WlsNodeShape } from './WlsNodeUtil.tsx'

/**
 * B2 脚本创编节点内嵌 UI（CANVAS_PLAN.md §9 B2）。
 *
 * - 业务逻辑完全复用 src/ai 层（ScriptWriter + Critic），画布层零复制生成逻辑；
 * - 有 Key（sessionStorage TOKEN_STORAGE_KEY）走真实 LLM；无 Key 走本地规则引擎
 *   并以 meta.demo=true + 「演示 · 评分非真实」徽章如实标注；
 * - 上游注入：沿指入箭头找 brief 节点 meta.text；无上游时节点内手动输入；
 * - 生成结果经 zod 契约校验后写入 shape meta（updateShape → 既有防抖落盘）。
 */

/** 读取 sessionStorage 的 LLM Token 配置（与 MultiAgentStudio 同一来源，不复制存储逻辑） */
function readTokenConfig(): TokenConfig | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as TokenConfig
  } catch {
    // 受限环境按无 Key 处理
  }
  return null
}

export function ScriptNodeBody({ shape }: { shape: WlsNodeShape }) {
  const editor = useEditor()
  const meta = shape.props.meta
  const result = readScriptMetaPayload(meta)
  const scene = scriptSceneOf(meta)

  // 上游 Brief 文本：沿指入箭头找 brief 节点 meta.text（tldraw 响应式，连线变化即刷新）
  const upstreamText = useValue(
    'upstreamBriefText',
    () => {
      for (const binding of editor.getBindingsToShape(shape.id, 'arrow')) {
        const arrow = editor.getShape(binding.fromId)
        if (!arrow) continue
        const start = editor
          .getBindingsFromShape(arrow, 'arrow')
          .find((b) => (b.props as { terminal?: unknown }).terminal === 'start')
        if (!start || start.toId === shape.id) continue
        const src = editor.getShape(start.toId)
        if (!src || src.type !== CANVAS_NODE_SHAPE_TYPE) continue
        if ((src.props as { kind?: unknown }).kind !== 'brief') continue
        const srcMeta = (src.props as { meta?: unknown }).meta
        const text =
          srcMeta && typeof srcMeta === 'object' && !Array.isArray(srcMeta)
            ? (srcMeta as Record<string, unknown>).text
            : undefined
        if (typeof text === 'string' && text.trim()) return text.trim()
      }
      return null
    },
    [editor, shape.id]
  )

  const [manualText, setManualText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveText = upstreamText ?? manualText.trim()
  // 上游 Brief 与生成时快照不一致 → 提示可重新生成（不自动覆盖已生成结果）
  const staleUpstream = result !== null && upstreamText !== null && upstreamText !== result.upstreamText

  const handleGenerate = async () => {
    if (busy) return
    if (!effectiveText) {
      setError('未连入 Brief 节点，请在节点内输入需求文本')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const token = readTokenConfig()
      const demo = !token?.apiKey?.trim()
      const { productTitle, sellingPoints } = briefTextToWriterInput(effectiveText)
      const script = await writeScript({
        productTitle,
        sellingPoints,
        templateId: SCRIPT_SCENE_TEMPLATE_ID[scene],
        tokenConfig: demo ? null : token,
      })
      const review = await critiqueScript(script, demo ? null : token)
      const payload: ScriptMetaPayload = {
        scriptScene: scene,
        script,
        critic: {
          score: review.score,
          passed: review.passed,
          summary: review.summary,
          strengths: review.strengths,
          suggestions: review.suggestions,
        },
        demo,
        upstreamText: effectiveText,
      }
      const nextMeta = writeScriptMetaPayload({ ...meta }, payload)
      if (!nextMeta) {
        setError('脚本结果未通过契约校验，已拒绝写入（诚实失败，不半渲染）')
        return
      }
      editor.updateShape({
        id: shape.id,
        type: shape.type,
        props: { meta: nextMeta as JsonObject },
      })
    } catch (err) {
      setError(`生成失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setBusy(false)
    }
  }

  // B2 返工：控件级 pointerdown 冒泡阻断（B4/B5 generate/product/deliver 同此约定）。
  // tldraw 在画布容器上监听 pointerdown 启动交互并 setPointerCapture，会把后续 pointer
  // 事件重定向到画布，节点内控件的真实鼠标点击/输入会失效——因此每个交互控件各自阻断；
  // 卡片空白区/标题区/结果摘要展示区放行事件流（起笔画线、空白区拖动节点均正常）。
  // 注意：不要提升到 .wls-script 根容器（会吞掉从 body 起笔的画线事件，B2 二轮回归教训）。
  const stopPointer = (e: React.PointerEvent) => e.stopPropagation()

  return (
    <div className="wls-script">
      {/* 上游注入 / 手动输入 */}
      {upstreamText ? (
        <div className="wls-script-upstream" title={upstreamText}>
          🔗 上游 Brief：{upstreamText}
        </div>
      ) : (
        <textarea
          className="wls-script-input"
          value={manualText}
          maxLength={2000}
          placeholder="未连入 Brief；输入需求：商品/主题 + 核心卖点…"
          aria-label="脚本需求输入"
          onPointerDown={stopPointer}
          onChange={(e) => setManualText(e.target.value)}
        />
      )}

      {staleUpstream && (
        <div className="wls-script-stale" role="status">
          ↕️ 上游 Brief 已更新，重新生成可同步最新需求（不自动覆盖已生成结果）
        </div>
      )}

      {/* 契约路由 + 生成（busy 期间禁点防连击） */}
      <div className="wls-script-controls">
        <select
          className="wls-script-scene"
          value={scene}
          aria-label="脚本契约路由"
          disabled={busy}
          onPointerDown={stopPointer}
          onChange={(e) => {
            const next = e.target.value as CanvasScriptScene
            editor.updateShape({
              id: shape.id,
              type: shape.type,
              props: { meta: { ...meta, scriptScene: next } as JsonObject },
            })
          }}
        >
          {CANVAS_SCRIPT_SCENES.map((s) => (
            <option key={s} value={s}>
              {SCRIPT_SCENE_LABEL[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="wls-script-generate"
          disabled={busy || !effectiveText}
          onPointerDown={stopPointer}
          onClick={() => void handleGenerate()}
        >
          {busy ? '📝 推演中…' : result ? '🔄 重新生成' : '📝 生成脚本'}
        </button>
      </div>

      {busy && <div className="wls-script-busy">ScriptWriter → Critic 双智体推演中，请稍候…</div>}
      {error && <div className="wls-script-error">⚠️ {error}</div>}

      {/* 结果摘要（meta 驱动，刷新后还原） */}
      {result && (
        <div className="wls-script-result">
          <div className="wls-script-badges">
            {result.demo ? (
              <span className="wls-script-badge-demo" title="未配置 LLM Key，本地规则引擎产物，评分非真实质检">
                🧪 演示 · 评分非真实
              </span>
            ) : (
              <span className="wls-script-badge-real" title="真实 LLM 结构化脚本 + Critic 评分">
                ✓ 真实 LLM
              </span>
            )}
            <span className="wls-script-badge-scene">{SCRIPT_SCENE_LABEL[result.scriptScene]}</span>
          </div>
          <p className="wls-script-logline" title={result.script.logline}>
            {result.script.logline}
          </p>
          <div className="wls-script-stats">
            <span>拍点 {result.script.beats.length}</span>
            <span>目标 {result.script.lengthTargetSec}s</span>
            <span>
              Critic {result.critic.score}/100 · {result.critic.passed ? '通过' : '待改'}
            </span>
          </div>
          <ul className="wls-script-notes">
            {result.critic.suggestions.slice(0, 2).map((s, i) => (
              <li key={`sug-${i}`} title={s}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
