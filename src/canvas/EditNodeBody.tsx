import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, useValue, type JsonObject, type TLShapeId } from 'tldraw'
import {
  getAssetObjectUrl,
  idbRefToId,
  isIdbRef,
  putBlobAsset,
} from '../persist/assetStore.ts'
import {
  demoInpaintPixels,
} from '../media/providers/inpaintDemo.ts'
import {
  COMFY_IMAGE_CUSTOM_WORKFLOW_KEY,
  COMFY_IMAGE_PRESETS,
  COMFY_IMAGE_PRESET_STORAGE_KEY,
  type ComfyUIImageWorkflowPreset,
  probeComfyImage,
  runInpaint,
} from '../media/providers/comfyuiImage.ts'
import {
  ASSET_VERSIONS_MAX,
  appendAssetVersion,
  CANVAS_NODE_SHAPE_TYPE,
  readAssetMetaPayload,
  readEditMetaPayload,
  writeEditMetaPayload,
  type AssetMetaPayload,
  type EditMetaPayload,
} from './contract.ts'
import type { WlsNodeShape } from './WlsNodeUtil.tsx'

/**
 * A1+A2 局部重绘（edit）节点内嵌 UI（CANVAS_PLAN.md §9 A1/A2）。
 *
 * A1（mask 编辑器）：
 * - 上游：沿指入箭头取 asset 产物卡（image / video）；视频取单帧定格（Canvas 抽帧）
 *   并诚实标注「单帧重绘回贴，非时序修复」（时序级修复在明确不做清单）；
 * - mask 覆盖层：与源图同尺寸的离屏 Canvas2D（白色=重绘区），显示层叠半透明粉色高亮；
 *   笔刷（3 档粗细）/ 矩形框选 / 清空重涂三种操作；
 * - 导出 mask：黑底白区 PNG（与源图同尺寸）→ putBlobAsset 落 idbref →
 *   meta.maskRef/sourceRef/sourceType 经 zod 契约写入（blob: 拒绝入档）；
 * - F5 恢复：从 idbref 读回 mask PNG，阈值化重放覆盖层（黑→透明，白→白色笔画+粉色高亮）；
 * - 交互冲突取舍：绘图区（stage）整体阻断 pointerdown，节点标题区保持 tldraw 原生拖拽。
 *
 * A2（重绘链路 + 版本堆叠）：
 * - 重绘指令（≤500）+ 预设选择（flux-fill / sd-inpaint / custom 占位符工作流）；
 * - ComfyUI 探测（/system_stats）：在线 → runInpaint 真实 inpaint（media 层组装）；
 *   离线 → 演示重绘兜底（mask 区域马赛克+通道轮换，标「🧪 演示重绘 · 非真实生成」）；
 * - 产物落 idbref → appendAssetVersion 推入源 asset 卡 meta.versions（最新在前，
 *   meta.url 指向当前版本），上限 20 截断最旧并如实提示；edit meta.sourceRef 同步
 *   指向新版本（mask 几何仍与图像对齐，可继续涂抹）；
 * - 版本切换/回退在 AssetNodeBody（‹ k/N ›），回退后再重绘基于当前显示版本叠加。
 */

/** 涂抹中的源图（图片元素或视频单帧画布，统一 CanvasImageSource；url 用于过期派生） */
type EditSource = {
  el: CanvasImageSource
  w: number
  h: number
  kind: 'image' | 'video-frame'
  url: string
}

type MaskMode = 'brush' | 'rect'
type ComfyProbe = 'checking' | 'online' | 'offline'

/** 笔刷三档 = 源图短边占比（小/中/大），下限 6px 保证可见 */
const BRUSH_FRACTIONS = [0.03, 0.07, 0.14] as const

const MASK_HIGHLIGHT = 'rgba(255, 126, 182, 0.5)'

const PRESET_LABEL: Record<ComfyUIImageWorkflowPreset, string> = {
  'flux-fill': 'FLUX Fill',
  'sd-inpaint': 'SD1.5 inpaint',
  custom: '自定义工作流',
}

function readStoredPreset(): ComfyUIImageWorkflowPreset {
  try {
    const stored = sessionStorage.getItem(COMFY_IMAGE_PRESET_STORAGE_KEY)
    if (stored && (COMFY_IMAGE_PRESETS as readonly string[]).includes(stored)) {
      return stored as ComfyUIImageWorkflowPreset
    }
  } catch {
    // 受限环境回退默认
  }
  return 'flux-fill'
}

function readStoredCustomWorkflow(): string {
  try {
    return sessionStorage.getItem(COMFY_IMAGE_CUSTOM_WORKFLOW_KEY) ?? ''
  } catch {
    return ''
  }
}

/** 加载图片元素（objectURL / 直链通用） */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('源图加载失败'))
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/** 源图统一转 PNG Blob（真实 inpaint 上传用） */
async function editSourceToBlob(src: EditSource): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = src.w
  canvas.height = src.h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(src.el, 0, 0)
  return canvasToBlob(canvas)
}

/** 上游 asset 产物卡（沿指入箭头，tldraw 响应式；含 shapeId 供 A2 版本回写） */
function useUpstreamAsset(
  editor: ReturnType<typeof useEditor>,
  shapeId: TLShapeId
): { payload: AssetMetaPayload; shapeId: TLShapeId } | null {
  return useValue(
    'editUpstreamAsset',
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
        if ((src.props as { kind?: unknown }).kind !== 'asset') continue
        const meta = (src.props as { meta?: unknown }).meta
        const payload = readAssetMetaPayload(meta)
        if (payload) return { payload, shapeId: start.toId }
      }
      return null
    },
    [editor, shapeId]
  )
}

/** 指针事件 → mask 自然坐标（显示层 CSS 缩放换算；非等比缩放时 x/y 各自映射仍精确） */
function pointFromEvent(
  e: React.PointerEvent<HTMLCanvasElement>,
  w: number,
  h: number
): { x: number; y: number } | null {
  const rect = e.currentTarget.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: ((e.clientX - rect.left) / rect.width) * w,
    y: ((e.clientY - rect.top) / rect.height) * h,
  }
}

/** 同一笔画分别落到 mask（白色不透明）与高亮层（半透明粉） */
function strokeSeg(
  mask: HTMLCanvasElement,
  pink: HTMLCanvasElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number
): void {
  const paint = (canvas: HTMLCanvasElement, style: string) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = style
    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }
  paint(mask, '#ffffff')
  paint(pink, MASK_HIGHLIGHT)
}

/** 矩形框选（归一化负坐标）落到两层 */
function fillRectOnBoth(
  mask: HTMLCanvasElement,
  pink: HTMLCanvasElement,
  a: { x: number; y: number },
  b: { x: number; y: number }
): void {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(a.x - b.x)
  const h = Math.abs(a.y - b.y)
  const mctx = mask.getContext('2d')
  if (mctx) {
    mctx.fillStyle = '#ffffff'
    mctx.fillRect(x, y, w, h)
  }
  const pctx = pink.getContext('2d')
  if (pctx) {
    pctx.fillStyle = MASK_HIGHLIGHT
    pctx.fillRect(x, y, w, h)
  }
}

/** mask 是否涂过任何区域（全空时禁止导出/重绘，诚实提示） */
function maskHasPaint(mask: HTMLCanvasElement): boolean {
  const ctx = mask.getContext('2d')
  if (!ctx) return false
  const { data } = ctx.getImageData(0, 0, mask.width, mask.height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true
  }
  return false
}

/**
 * F5 恢复：导出格式为黑底白区 PNG，重放时阈值化——
 * 白（r>127）→ 不透明白色笔画；黑 → 透明（避免黑底被整块高亮成粉色）。
 */
function replayMaskToCanvases(
  img: HTMLImageElement,
  mask: HTMLCanvasElement,
  pink: HTMLCanvasElement,
  w: number,
  h: number
): void {
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.drawImage(img, 0, 0, w, h)
  const image = tctx.getImageData(0, 0, w, h)
  const px = image.data
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] > 127) {
      px[i] = 255
      px[i + 1] = 255
      px[i + 2] = 255
      px[i + 3] = 255
    } else {
      px[i + 3] = 0
    }
  }
  tctx.putImageData(image, 0, 0)
  mask.getContext('2d')?.drawImage(tmp, 0, 0)
  const pctx = pink.getContext('2d')
  if (pctx) {
    pctx.drawImage(tmp, 0, 0)
    pctx.globalCompositeOperation = 'source-in'
    pctx.fillStyle = MASK_HIGHLIGHT
    pctx.fillRect(0, 0, w, h)
    pctx.globalCompositeOperation = 'source-over'
  }
}

export function EditNodeBody({ shape }: { shape: WlsNodeShape }) {
  const editor = useEditor()
  const upstream = useUpstreamAsset(editor, shape.id)
  const upstreamUrl = upstream?.payload.url ?? null
  const metaPayload = readEditMetaPayload(shape.props.meta)

  // hooks 必须在所有 early return 之前（B4 P1 教训）
  const viewRef = useRef<HTMLCanvasElement | null>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const pinkCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef<{ active: boolean; mode: MaskMode; last: { x: number; y: number }; pointerId: number } | null>(null)
  const rectAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const rectSnapRef = useRef<{ mask: ImageData | null; pink: ImageData | null } | null>(null)

  const [source, setSource] = useState<EditSource | null>(null)
  const [srcErr, setSrcErr] = useState<string | null>(null)
  const [mode, setMode] = useState<MaskMode>('brush')
  const [tier, setTier] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  // A2：重绘指令（完整契约或轻量合并均可恢复）/ 预设 / ComfyUI 探测 / 重绘 busy
  const [instruction, setInstruction] = useState(() => {
    const raw = shape.props.meta.instruction
    if (typeof raw === 'string') return raw
    return ''
  })
  const [preset, setPreset] = useState<ComfyUIImageWorkflowPreset>(readStoredPreset)
  const [customJson, setCustomJson] = useState(readStoredCustomWorkflow)
  const [probe, setProbe] = useState<ComfyProbe>('checking')
  const [redrawing, setRedrawing] = useState(false)

  /** 源图是否指向当前上游（上游切换时旧源图渲染为加载态，避免闪烁错图） */
  const sourceStale = source !== null && source.url !== upstreamUrl

  /* ComfyUI 探测（异步完成，探测失败 = 演示模式兜底并如实标注） */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const ok = await probeComfyImage()
      if (!cancelled) setProbe(ok ? 'online' : 'offline')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* 源图加载：image 直读；video 单帧定格（seek 至 min(1s, 半长) 抽帧） */
  useEffect(() => {
    if (!upstreamUrl) return
    let cancelled = false
    let revoked: string | null = null
    void (async () => {
      try {
        let objectUrl = upstreamUrl
        if (isIdbRef(upstreamUrl)) {
          const u = await getAssetObjectUrl(idbRefToId(upstreamUrl))
          if (cancelled) return
          if (!u) {
            setSrcErr('IndexedDB 源资产读取失败，请重新导入素材')
            return
          }
          revoked = u
          objectUrl = u
        }
        if (upstream?.payload.type === 'video') {
          const video = document.createElement('video')
          video.src = objectUrl
          video.muted = true
          await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve()
            video.onerror = () => reject(new Error('视频读取失败'))
          })
          const t =
            Number.isFinite(video.duration) && video.duration > 0
              ? Math.min(1, video.duration / 2)
              : 0
          await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve()
            video.onerror = () => reject(new Error('视频抽帧失败'))
            video.currentTime = t
          })
          if (cancelled) return
          if (video.videoWidth <= 0 || video.videoHeight <= 0) {
            throw new Error('视频无可抽取的画面帧')
          }
          const frame = document.createElement('canvas')
          frame.width = video.videoWidth
          frame.height = video.videoHeight
          const ctx = frame.getContext('2d')
          if (!ctx) throw new Error('Canvas 不可用，无法抽帧')
          ctx.drawImage(video, 0, 0)
          setSource({ el: frame, w: frame.width, h: frame.height, kind: 'video-frame', url: upstreamUrl })
        } else {
          const img = await loadImage(objectUrl)
          if (cancelled) return
          setSource({ el: img, w: img.naturalWidth, h: img.naturalHeight, kind: 'image', url: upstreamUrl })
        }
        setSrcErr(null)
      } catch (err) {
        if (!cancelled) setSrcErr(err instanceof Error ? err.message : '源图加载失败')
      } finally {
        if (revoked) URL.revokeObjectURL(revoked)
      }
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [upstreamUrl, upstream?.payload.type])

  const redrawView = useCallback(() => {
    const view = viewRef.current
    const pink = pinkCanvasRef.current
    if (!view || !pink || !source) return
    const ctx = view.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, view.width, view.height)
    ctx.drawImage(source.el, 0, 0, view.width, view.height)
    ctx.drawImage(pink, 0, 0, view.width, view.height)
  }, [source])

  /* mask 覆盖层初始化 + F5 恢复（sourceRef 与当前上游配对才重放） */
  useEffect(() => {
    if (!source || source.url !== upstreamUrl) return
    const mask = document.createElement('canvas')
    mask.width = source.w
    mask.height = source.h
    const pink = document.createElement('canvas')
    pink.width = source.w
    pink.height = source.h
    maskCanvasRef.current = mask
    pinkCanvasRef.current = pink
    redrawView()

    const payload = readEditMetaPayload(shape.props.meta)
    if (!payload || payload.sourceRef !== upstreamUrl || !isIdbRef(payload.maskRef)) return
    let cancelled = false
    void (async () => {
      const u = await getAssetObjectUrl(idbRefToId(payload.maskRef))
      if (cancelled || !u) return
      try {
        const img = await loadImage(u)
        replayMaskToCanvases(img, mask, pink, source.w, source.h)
        redrawView()
      } catch {
        // mask 读取失败按空白层处理，不阻断编辑
      } finally {
        URL.revokeObjectURL(u)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source, upstreamUrl, shape.props.meta, redrawView])

  /* 显示层重绘（绘制过程走直接 blit 不经 state；mask 恢复重放由 init effect 内 redrawView 驱动） */
  useEffect(() => {
    const view = viewRef.current
    if (!view || !source || sourceStale) return
    view.width = source.w
    view.height = source.h
    const ctx = view.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, view.width, view.height)
    ctx.drawImage(source.el, 0, 0, view.width, view.height)
    if (pinkCanvasRef.current) {
      ctx.drawImage(pinkCanvasRef.current, 0, 0, view.width, view.height)
    }
  }, [source, sourceStale])

  const brushSize = useCallback(
    (src: EditSource) =>
      Math.max(6, Math.round(Math.min(src.w, src.h) * BRUSH_FRACTIONS[Math.min(tier, BRUSH_FRACTIONS.length - 1)])),
    [tier]
  )

  /* mask 绘制：stage 已整体阻断 pointerdown（不与节点拖动/画线冲突），此处自由捕获指针 */
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mask = maskCanvasRef.current
    const pink = pinkCanvasRef.current
    if (!mask || !pink || !source || sourceStale) return
    const p = pointFromEvent(e, source.w, source.h)
    if (!p) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = { active: true, mode, last: p, pointerId: e.pointerId }
    if (mode === 'brush') {
      strokeSeg(mask, pink, p, p, brushSize(source))
    } else {
      rectAnchorRef.current = p
      rectSnapRef.current = {
        mask: mask.getContext('2d')?.getImageData(0, 0, mask.width, mask.height) ?? null,
        pink: pink.getContext('2d')?.getImageData(0, 0, pink.width, pink.height) ?? null,
      }
    }
    redrawView()
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawingRef.current
    const mask = maskCanvasRef.current
    const pink = pinkCanvasRef.current
    if (!d?.active || e.pointerId !== d.pointerId || !mask || !pink || !source) return
    const p = pointFromEvent(e, source.w, source.h)
    if (!p) return
    if (d.mode === 'brush') {
      strokeSeg(mask, pink, d.last, p, brushSize(source))
      d.last = p
    } else {
      const anchor = rectAnchorRef.current
      if (!anchor) return
      const snap = rectSnapRef.current
      const mctx = mask.getContext('2d')
      const pctx = pink.getContext('2d')
      if (snap?.mask) mctx?.putImageData(snap.mask, 0, 0)
      if (snap?.pink) pctx?.putImageData(snap.pink, 0, 0)
      fillRectOnBoth(mask, pink, anchor, p)
    }
    redrawView()
  }

  const endDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawingRef.current
    if (!d || e.pointerId !== d.pointerId) return
    drawingRef.current = null
    rectAnchorRef.current = null
    rectSnapRef.current = null
  }

  const handleClear = () => {
    const mask = maskCanvasRef.current
    const pink = pinkCanvasRef.current
    if (!mask || !pink) return
    mask.getContext('2d')?.clearRect(0, 0, mask.width, mask.height)
    pink.getContext('2d')?.clearRect(0, 0, pink.width, pink.height)
    redrawView()
    setOkMsg(null)
  }

  /* 导出 mask：黑底白区 PNG（与源图同尺寸）→ IndexedDB → meta 契约落盘 */
  const handleExport = async () => {
    const mask = maskCanvasRef.current
    if (!source || !mask || exporting) return
    if (!maskHasPaint(mask)) {
      setErrMsg('请先涂抹重绘区域（笔刷或框选），再导出 mask')
      return
    }
    setExporting(true)
    setErrMsg(null)
    setOkMsg(null)
    try {
      const out = document.createElement('canvas')
      out.width = source.w
      out.height = source.h
      const ctx = out.getContext('2d')
      if (!ctx) throw new Error('Canvas 不可用')
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(mask, 0, 0)
      const blob = await canvasToBlob(out)
      if (!blob) throw new Error('mask PNG 编码失败')
      const id = `canvas-mask-${shape.id.replace('shape:wls-', '')}-${Date.now().toString(36)}`
      const stored = await putBlobAsset(id, blob)
      if (!stored) throw new Error('mask 写入 IndexedDB 失败，请重试')
      const payload: EditMetaPayload = {
        maskRef: stored,
        sourceRef: upstreamUrl ?? '',
        sourceType: source.kind,
      }
      const nextMeta = writeEditMetaPayload({ ...shape.props.meta }, payload)
      if (!nextMeta) throw new Error('mask 结果未通过契约校验，已拒绝写入')
      editor.updateShape({
        id: shape.id,
        type: shape.type,
        props: { meta: nextMeta as JsonObject },
      })
      setOkMsg(`✅ mask 已导出（${source.w}×${source.h}，白色=重绘区）并落档，可继续编辑重涂`)
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'mask 导出失败')
    } finally {
      setExporting(false)
    }
  }

  /* A2：执行重绘（在线真实 inpaint / 离线演示兜底），产物版本推入源 asset 卡 */
  const handleRedraw = async () => {
    const mask = maskCanvasRef.current
    if (!source || !mask || redrawing || sourceStale) return
    const instructionText = instruction.trim()
    if (!instructionText) {
      setErrMsg('请输入重绘指令（想改哪里、改成什么）')
      return
    }
    if (!maskHasPaint(mask)) {
      setErrMsg('请先涂抹重绘区域（笔刷或框选），再执行重绘')
      return
    }
    if (preset === 'custom' && !customJson.trim()) {
      setErrMsg('custom 预设需要填写自定义工作流 JSON（含 {{SOURCE}}/{{MASK}}/{{PROMPT}} 占位符）')
      return
    }
    setRedrawing(true)
    setErrMsg(null)
    setOkMsg(null)
    try {
      const demo = probe !== 'online'
      let outBlob: Blob
      if (demo) {
        // 演示重绘：mask 区域马赛克 + 通道轮换（确定性纯函数，如实标注非真实生成）
        const canvas = document.createElement('canvas')
        canvas.width = source.w
        canvas.height = source.h
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 不可用')
        ctx.drawImage(source.el, 0, 0)
        const imageData = ctx.getImageData(0, 0, source.w, source.h)
        const maskData = mask.getContext('2d')?.getImageData(0, 0, source.w, source.h) ?? null
        demoInpaintPixels(imageData.data, maskData?.data ?? null, source.w, source.h)
        ctx.putImageData(imageData, 0, 0)
        const blob = await canvasToBlob(canvas)
        if (!blob) throw new Error('演示重绘 PNG 编码失败')
        outBlob = blob
      } else {
        const sourceBlob = await editSourceToBlob(source)
        const maskOut = document.createElement('canvas')
        maskOut.width = source.w
        maskOut.height = source.h
        const mctx = maskOut.getContext('2d')
        if (!mctx || !sourceBlob) throw new Error('Canvas 不可用')
        mctx.fillStyle = '#000000'
        mctx.fillRect(0, 0, maskOut.width, maskOut.height)
        mctx.drawImage(mask, 0, 0)
        const maskBlob = await canvasToBlob(maskOut)
        if (!maskBlob) throw new Error('mask PNG 编码失败')
        outBlob = await runInpaint({
          sourceImage: sourceBlob,
          maskImage: maskBlob,
          prompt: instructionText,
          preset,
          customWorkflowJson: preset === 'custom' ? customJson : undefined,
          filenamePrefix: `WebLockShot_inpaint_${shape.id.replace('shape:wls-', '')}`,
        })
      }

      const id = `canvas-inpaint-${shape.id.replace('shape:wls-', '')}-${Date.now().toString(36)}`
      const stored = await putBlobAsset(id, outBlob)
      if (!stored) throw new Error('重绘产物写入 IndexedDB 失败，请重试')
      if (!upstream) throw new Error('上游产物卡已断开，无法堆叠版本')

      // 版本堆叠进源 asset 卡（最新在前；上限 20 截断最旧并如实提示）
      const upstreamProps = editor.getShape(upstream.shapeId)?.props as
        | { meta?: Record<string, unknown> }
        | undefined
      const appended = appendAssetVersion(
        { ...(upstreamProps?.meta ?? {}) },
        { url: stored, instruction: instructionText, demo, createdAt: Date.now() }
      )
      if (!appended) throw new Error('重绘版本未通过契约校验，已拒绝写入（blob: 拒绝持久化）')
      editor.updateShape({
        id: upstream.shapeId,
        type: CANVAS_NODE_SHAPE_TYPE,
        props: { meta: appended.meta as JsonObject },
      })

      // edit meta 同步：指令持久化（未导出 mask 时轻量合并，不触发 A1 必填契约）；
      // 已导出 mask 时走完整契约并让 sourceRef 跟随新版本（mask 几何仍对齐，可继续涂抹）
      const latestProps = editor.getShape(shape.id)?.props as
        | { meta?: Record<string, unknown> }
        | undefined
      const latestMeta = { ...(latestProps?.meta ?? {}) }
      const latestPayload = readEditMetaPayload(latestMeta)
      const nextEditMeta = latestPayload
        ? writeEditMetaPayload(latestMeta, {
            ...latestPayload,
            instruction: instructionText,
            sourceRef: stored,
          })
        : { ...latestMeta, instruction: instructionText }
      if (nextEditMeta) {
        editor.updateShape({
          id: shape.id,
          type: shape.type,
          props: { meta: nextEditMeta as JsonObject },
        })
      }

      const truncateNote =
        appended.truncated > 0 ? `（超出 ${ASSET_VERSIONS_MAX} 版上限，已截断最旧 ${appended.truncated} 版）` : ''
      setOkMsg(
        demo
          ? `🧪 演示重绘完成 · 非真实生成，版本已堆叠到产物卡${truncateNote}`
          : `✅ ComfyUI 真实重绘完成，版本已堆叠到产物卡${truncateNote}`
      )
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : '重绘失败')
    } finally {
      setRedrawing(false)
    }
  }

  /* 渲染分支（所有 hooks 已在上方调用） */
  if (!upstream) {
    return (
      <div className="wls-edit">
        <div className="wls-edit-empty">
          连入产物卡（🖼️ 图片 / 🎬 视频）后在此涂抹重绘区域。
          <br />
          <span className="wls-edit-empty-sub">涂抹 → 指令 → 重绘（无 ComfyUI 时演示重绘兜底）</span>
        </div>
      </div>
    )
  }

  if (srcErr) {
    return (
      <div className="wls-edit">
        <div className="wls-edit-error">⚠️ {srcErr}</div>
      </div>
    )
  }

  return (
    <div className="wls-edit">
      {source?.kind === 'video-frame' && (
        <div className="wls-edit-frame-note" role="status">
          🎞️ 单帧定格 · 单帧重绘回贴，非时序修复
        </div>
      )}
      {metaPayload && metaPayload.sourceRef !== upstreamUrl && (
        <div className="wls-edit-stale" role="status">
          ↕️ 源图已更换，已存 mask 不再适用，请重新涂抹导出
        </div>
      )}

      {!source || sourceStale ? (
        <div className="wls-edit-loading">源图加载中…</div>
      ) : (
        <>
          {/* 工具条：模式 / 笔刷档位 / 清空（控件级 stopPropagation） */}
          <div className="wls-edit-toolbar">
            <button
              type="button"
              className={`wls-edit-tool${mode === 'brush' ? ' active' : ''}`}
              title="笔刷涂抹"
              aria-pressed={mode === 'brush'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setMode('brush')}
            >
              ✏️ 笔刷
            </button>
            <button
              type="button"
              className={`wls-edit-tool${mode === 'rect' ? ' active' : ''}`}
              title="矩形框选"
              aria-pressed={mode === 'rect'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setMode('rect')}
            >
              ⬜ 框选
            </button>
            <span className="wls-edit-tiers" role="group" aria-label="笔刷粗细">
              {['细', '中', '粗'].map((label, i) => (
                <button
                  key={label}
                  type="button"
                  className={`wls-edit-tier${tier === i ? ' active' : ''}`}
                  disabled={mode !== 'brush'}
                  title={`笔刷${label}`}
                  aria-pressed={tier === i}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setTier(i)}
                >
                  {label}
                </button>
              ))}
            </span>
            <button
              type="button"
              className="wls-edit-tool wls-edit-clear"
              title="清空重涂"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleClear}
            >
              🗑️ 清空
            </button>
          </div>

          {/* 绘图区：整体阻断 pointerdown（节点拖动走标题区），画布内自由绘制 */}
          <div className="wls-edit-stage" onPointerDown={(e) => e.stopPropagation()}>
            <canvas
              ref={viewRef}
              className={`wls-edit-canvas${mode === 'rect' ? ' rect-mode' : ''}`}
              data-testid="wls-edit-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrawing}
              onPointerCancel={endDrawing}
            />
          </div>

          <div className="wls-edit-actions">
            <button
              type="button"
              className="wls-edit-export"
              disabled={exporting}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void handleExport()}
            >
              {exporting ? '📤 导出中…' : '📤 导出 mask'}
            </button>
            {metaPayload && metaPayload.sourceRef === upstreamUrl && (
              <span className="wls-edit-stored" title={metaPayload.maskRef}>
                mask 已落档
              </span>
            )}
          </div>

          {/* A2：重绘指令 + 执行（探测两态如实标注） */}
          <div className="wls-edit-inpaint">
            <textarea
              className="wls-edit-instruction"
              value={instruction}
              maxLength={500}
              placeholder="重绘指令：例：把背景换成大理石台面"
              aria-label="重绘指令"
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <div className="wls-edit-inpaint-row">
              <span
                className={`wls-edit-probe wls-edit-probe-${probe}`}
                title={probe === 'online' ? 'ComfyUI 在线，将执行真实 inpaint' : '未检测到 ComfyUI，将执行客户端演示重绘（非真实生成）'}
              >
                {probe === 'checking' ? '⏳ 探测 ComfyUI…' : probe === 'online' ? '🟢 ComfyUI 在线' : '⚪ 演示模式'}
              </span>
              <select
                className="wls-edit-preset"
                value={preset}
                aria-label="重绘工作流预设"
                disabled={probe !== 'online' || redrawing}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const next = e.target.value as ComfyUIImageWorkflowPreset
                  setPreset(next)
                  try {
                    sessionStorage.setItem(COMFY_IMAGE_PRESET_STORAGE_KEY, next)
                  } catch {
                    // 受限环境忽略
                  }
                }}
              >
                {COMFY_IMAGE_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {PRESET_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            {preset === 'custom' && probe === 'online' && (
              <textarea
                className="wls-edit-custom-json"
                value={customJson}
                maxLength={20000}
                placeholder='自定义工作流 JSON，占位符：{{SOURCE}} {{MASK}} {{PROMPT}} {{NEGATIVE}} {{SEED}}'
                aria-label="自定义重绘工作流 JSON"
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  setCustomJson(e.target.value)
                  try {
                    sessionStorage.setItem(COMFY_IMAGE_CUSTOM_WORKFLOW_KEY, e.target.value)
                  } catch {
                    // 受限环境忽略
                  }
                }}
              />
            )}
            <button
              type="button"
              className="wls-edit-redraw"
              disabled={redrawing || probe === 'checking'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void handleRedraw()}
            >
              {redrawing ? '🖌️ 重绘中…' : '🖌️ 开始重绘'}
            </button>
          </div>

          {errMsg && <div className="wls-edit-error">⚠️ {errMsg}</div>}
          {okMsg && (
            <div className="wls-edit-ok" role="status">
              {okMsg}
            </div>
          )}
        </>
      )}
    </div>
  )
}
