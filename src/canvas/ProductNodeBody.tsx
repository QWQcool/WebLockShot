import { useState } from 'react'
import { useEditor, useValue, type JsonObject, type TLShapeId } from 'tldraw'
import { putDataUrlAsset } from '../persist/assetStore.ts'
import {
  CANVAS_NODE_SHAPE_TYPE,
  readProductMetaPayload,
  writeProductMetaPayload,
  type ProductImportItem,
} from './contract.ts'
import { upsertAssetCard } from './assetCard.ts'
import type { WlsNodeShape } from './WlsNodeUtil.tsx'

/**
 * B5 素材导入节点内嵌 UI（CANVAS_PLAN.md §9 B5）。
 *
 * 三入口取舍（如实说明）：
 * - 🖼️ 本地图片上传：本期实现（FileReader→dataURL→putDataUrlAsset→idbref→产物卡 type:image）；
 * - 🔗 平台链接粘贴：本期实现为「URL 档案留存」（沿用 sell 的纯前端限制诚实说明，不建产物卡）；
 * - 🎥 本地视频抽帧：Canvas 抽帧实现成本低，本期一并实现（帧图 → idbref → 产物卡 type:image）。
 *
 * 上游注入：brief→product 的 meta.text 预填商品标题（可编辑，上游变更时提示）。
 * 产物卡复用共享 upsertAssetCard（shotId 检索替换 + 新建后 zoomToFit）。
 */

/** 上游 brief 节点的 meta.text（沿指入箭头，tldraw 响应式） */
function useUpstreamBrief(editor: ReturnType<typeof useEditor>, shapeId: TLShapeId) {
  return useValue(
    'productUpstreamBrief',
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
        if ((src.props as { kind?: unknown }).kind !== 'brief') continue
        const m = (src.props as { meta?: unknown }).meta
        const text =
          m && typeof m === 'object' && !Array.isArray(m)
            ? (m as Record<string, unknown>).text
            : undefined
        if (typeof text === 'string' && text.trim()) return text.trim()
      }
      return null
    },
    [editor, shapeId]
  )
}

export function ProductNodeBody({ shape }: { shape: WlsNodeShape }) {
  const editor = useEditor()
  const meta = shape.props.meta
  const result = readProductMetaPayload(meta)
  const upstream = useUpstreamBrief(editor, shape.id)

  const [title, setTitle] = useState(result?.title ?? '')
  const [linkUrl, setLinkUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const effectiveTitle = title.trim() || upstream || ''
  const staleUpstream =
    result !== null && upstream !== null && upstream !== result.upstreamText

  const persist = (imports: ProductImportItem[], titleOverride?: string) => {
    const nextMeta = writeProductMetaPayload(
      { ...meta },
      {
        title: (titleOverride ?? effectiveTitle).slice(0, 120) || '未命名素材',
        upstreamText: upstream ?? '',
        imports,
      }
    )
    if (!nextMeta) {
      setError('导入记录未通过契约校验，已拒绝写入')
      return false
    }
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      props: { meta: nextMeta as JsonObject },
    })
    return true
  }

  const currentImports = (): ProductImportItem[] => result?.imports ?? []

  /** 图片 / 抽帧产物：dataURL → IndexedDB → idbref → 产物卡（type:image） */
  const importImage = async (dataUrl: string, name: string) => {
    setBusy(true)
    setError(null)
    setOkMsg(null)
    try {
      const shotId = `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const stored = await putDataUrlAsset(`canvas-asset-${shotId}`, dataUrl)
      if (!stored) {
        setError('素材写入 IndexedDB 失败，请重试')
        return
      }
      const imports: ProductImportItem[] = [
        ...currentImports(),
        { kind: 'image' as const, url: stored, name: name.slice(0, 120), createdAt: Date.now() },
      ]
      if (persist(imports)) {
        upsertAssetCard(
          editor,
          { shapeId: shape.id, x: shape.x, y: shape.y, w: shape.props.w },
          {
            type: 'image',
            url: stored,
            shotId,
            createdAt: Date.now(),
            // B6 任务 0 P2-3：产物卡 title 统一用商品标题（brief 预填），文件名仅兜底
            title: (effectiveTitle || name).slice(0, 120),
          }
        )
        setOkMsg(`✅ 已导入素材并生成产物卡：${name}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        void importImage(reader.result, file.name.replace(/\.[^/.]+$/, '') || '商品图')
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  /** 本地视频抽帧（Canvas 1 帧，低成本入口） */
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setOkMsg(null)
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.src = url
    video.muted = true
    video.onloadeddata = () => {
      video.currentTime = 1
    }
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 280
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          setError('抽帧失败：Canvas 不可用')
          return
        }
        ctx.drawImage(video, 0, 0, 160, 280)
        void importImage(canvas.toDataURL('image/jpeg', 0.8), `${file.name.replace(/\.[^/.]+$/, '')}-抽帧`)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    video.onerror = () => {
      setError('视频读取失败，无法抽帧')
      URL.revokeObjectURL(url)
      setBusy(false)
    }
    e.target.value = ''
  }

  const handleLinkImport = () => {
    const url = linkUrl.trim()
    if (!url || !/^https?:\/\//.test(url)) {
      setError('请输入以 http(s):// 开头的有效链接')
      return
    }
    setError(null)
    setOkMsg(null)
    const imports: ProductImportItem[] = [
      ...currentImports(),
      { kind: 'link' as const, url, name: effectiveTitle.slice(0, 120), createdAt: Date.now() },
    ]
    if (persist(imports)) {
      setLinkUrl('')
      setOkMsg('✅ 链接已作为档案留存（纯前端模式不抓取页面数据，请补充标题与卖点）')
    }
  }

  return (
    <div className="wls-product">
      {/* 上游注入：brief 标题预填 */}
      <input
        className="wls-product-title"
        value={title}
        maxLength={120}
        placeholder="商品标题（连入 Brief 自动预填）"
        aria-label="商品标题"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setTitle(e.target.value)
          persist(currentImports(), e.target.value)
        }}
      />
      {staleUpstream && (
        <div className="wls-product-stale" role="status">
          ↕️ 上游 Brief 已更新，标题可手动同步
        </div>
      )}

      {/* 入口：图片上传 */}
      <label className="wls-product-entry">
        <input
          type="file"
          accept="image/*"
          className="wls-product-file"
          onChange={handleImageUpload}
          disabled={busy}
        />
        🖼️ {busy ? '处理中…' : '上传商品图片'}
      </label>

      {/* 入口：链接粘贴 */}
      <div className="wls-product-linkrow">
        <input
          className="wls-product-link"
          value={linkUrl}
          maxLength={500}
          placeholder="https:// 平台商品链接"
          aria-label="平台商品链接"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setLinkUrl(e.target.value)}
        />
        <button
          type="button"
          className="wls-product-addlink"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleLinkImport}
        >
          存档
        </button>
      </div>
      <div className="wls-product-notice">
        🛡️ 诚实边界：纯前端模式受平台反爬与同源策略限制，链接仅作档案留存，不静默抓取数据。
      </div>

      {/* 入口：视频抽帧 */}
      <label className="wls-product-entry">
        <input
          type="file"
          accept="video/*"
          className="wls-product-file"
          onChange={handleVideoUpload}
          disabled={busy}
        />
        🎥 上传本地视频（抽 1 帧作参考）
      </label>

      {error && <div className="wls-product-error">⚠️ {error}</div>}
      {okMsg && <div className="wls-product-ok" role="status">{okMsg}</div>}

      {result && result.imports.length > 0 && (
        <div className="wls-product-imports">
          <div className="wls-product-imports-head">已导入 {result.imports.length} 条</div>
          {result.imports.slice(-3).map((it, i) => (
            <div key={`${it.createdAt}-${i}`} className="wls-product-import">
              <span className="wls-product-import-kind">
                {it.kind === 'image' ? '🖼️' : it.kind === 'video-frame' ? '🎞️' : '🔗'}
              </span>
              <span className="wls-product-import-name">{it.name || it.url.slice(0, 32)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
