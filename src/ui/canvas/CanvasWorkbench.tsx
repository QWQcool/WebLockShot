import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tldraw, type Editor, type JsonObject, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import '../../canvas/canvas.css'
import {
  CANVAS_NODE_KINDS,
  CANVAS_NODE_META,
  CANVAS_NODE_SHAPE_TYPE,
  CANVAS_SCENE_TEMPLATES,
  createNodeId,
  nodeIdToShapeId,
  shapeIdToNodeId,
  validateCanvasDoc,
  validateEdgeKind,
  type CanvasDoc,
  type CanvasNodeKind,
} from '../../canvas/contract.ts'
import {
  clearCanvasDoc,
  loadCanvasDoc,
  saveCanvasDoc,
  subscribeExternalCanvasChanges,
} from '../../canvas/canvasStore.ts'
import {
  docEdgesToArrowCreations,
  docToShapePartials,
  editorPageToCanvasDraft,
} from '../../canvas/serialize.ts'
import { WlsNodeUtil } from '../../canvas/WlsNodeUtil.tsx'

/**
 * Agent 创意画布 · 一期 A（CANVAS_PLAN.md §4.1-1/2/6/7 + v1.1 变更）。
 *
 * 资产：tldraw 基座 + 初音青×Miroa 浅色换肤 + 9 种节点摆放 + 对话栏（一句话 → Brief 上画布）
 * + CanvasDoc 契约 + localStorage 持久化 + 多标签页同步。
 * 定位：多元化创意工作室（带货短视频只是场景之一，另有品牌视觉/短剧分镜/游戏宣传/App 界面模板）。
 * 节点业务管线（素材/脚本/生成等）是一期 B；灰态节点如实标注开放阶段，不装可用。
 */

type Props = {
  onSwitchToSell: () => void
  onSwitchToDrama: () => void
}

/**
 * B1 连线即数据流：扫描当前页所有箭头做两件事（返工后）：
 * 1. 类型兼容：两端均为 wls-node 且 validateEdgeKind 不通过 → 立即删除，返回首条拒绝原因
 *    （两端任一端不是 wls-node（如画在便签/图形上）不拦截）；
 * 2. 悬空清理：任一端绑定缺失的 arrow shape 级联删除（删节点后 tldraw 会留下失绑箭头的视觉残留）。
 *    正在画箭头（arrow 工具激活）或该箭头处于选中态（拖拽手柄中）时跳过，避免打断交互。
 */
function enforceEdgeCompat(editor: Editor): string | null {
  const shapes = editor.getCurrentPageShapes()
  const kindByShapeId = new Map<string, CanvasNodeKind>()
  for (const shape of shapes) {
    if (shape.type !== CANVAS_NODE_SHAPE_TYPE) continue
    const nodeId = shapeIdToNodeId(shape.id)
    const kind = (shape.props as { kind?: unknown }).kind
    if (nodeId && typeof kind === 'string') {
      kindByShapeId.set(shape.id, kind as CanvasNodeKind)
    }
  }

  const isDrawingArrow = editor.getCurrentToolId() === 'arrow'
  const selectedIds = isDrawingArrow ? new Set<string>() : new Set<string>(editor.getSelectedShapeIds())

  let reason: string | null = null
  const invalidArrowIds: TLShapeId[] = []
  for (const shape of shapes) {
    if (shape.type !== 'arrow') continue
    let startShapeId: string | null = null
    let endShapeId: string | null = null
    try {
      for (const binding of editor.getBindingsFromShape(shape, 'arrow')) {
        const terminal = (binding.props as { terminal?: unknown }).terminal
        if (terminal === 'start') startShapeId = binding.toId
        if (terminal === 'end') endShapeId = binding.toId
      }
    } catch {
      continue
    }
    if (!startShapeId || !endShapeId) {
      // 悬空箭头（一端失绑）：不在交互中则级联删除
      if (!isDrawingArrow && !selectedIds.has(shape.id)) {
        invalidArrowIds.push(shape.id)
      }
      continue
    }
    const fromKind = kindByShapeId.get(startShapeId)
    const toKind = kindByShapeId.get(endShapeId)
    if (!fromKind || !toKind) continue
    const check = validateEdgeKind(fromKind, toKind)
    if (!check.ok) {
      if (!reason) reason = check.reason
      invalidArrowIds.push(shape.id)
    }
  }
  if (invalidArrowIds.length > 0) {
    editor.deleteShapes(invalidArrowIds)
  }
  return reason
}

export const CanvasWorkbench: React.FC<Props> = ({ onSwitchToSell, onSwitchToDrama }) => {
  const editorRef = useRef<Editor | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const suppressSaveRef = useRef(false)
  // 惰性读取已保存文档（首次访问时执行一次）
  const docRef = useRef<CanvasDoc | null>(null)
  const [docName, setDocName] = useState<string>('')
  const [savedAt, setSavedAt] = useState<string>('—')

  const getDoc = useCallback((): CanvasDoc => {
    if (docRef.current === null) docRef.current = loadCanvasDoc()
    return docRef.current
  }, [])

  useEffect(() => {
    setDocName(getDoc().name)
  }, [getDoc])

  const persistNow = useCallback(() => {
    const editor = editorRef.current
    if (!editor || suppressSaveRef.current) return
    const current = getDoc()
    const draft = editorPageToCanvasDraft(editor, {
      id: current.id,
      name: current.name,
      updatedAt: Date.now(),
    })
    const validated = validateCanvasDoc({ ...draft, version: 1 as const })
    if (!validated) return
    docRef.current = validated
    const ok = saveCanvasDoc(validated)
    setSavedAt(
      ok
        ? new Date(validated.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
        : '保存失败（localStorage 不可用）'
    )
  }, [getDoc])

  const schedulePersist = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      persistNow()
    }, 400)
  }, [persistNow])

  // B1：非法连线提示条（画布内顶部居中，3 秒自动消失）
  const [edgeNotice, setEdgeNotice] = useState<string | null>(null)
  const edgeNoticeTimerRef = useRef<number | null>(null)
  const showEdgeNotice = useCallback((reason: string) => {
    setEdgeNotice(reason)
    if (edgeNoticeTimerRef.current !== null) {
      window.clearTimeout(edgeNoticeTimerRef.current)
    }
    edgeNoticeTimerRef.current = window.setTimeout(() => {
      edgeNoticeTimerRef.current = null
      setEdgeNotice(null)
    }, 3000)
  }, [])

  // B1：非法连线/悬空箭头检查（延迟到 store 更新完成后执行，避免在监听回调内改 store）。
  // 注意：restore（挂载/跨页同步）发生在 store.listen 注册之前，其变更不会触发监听，
  // 因此 replaceCanvasShapes 末尾必须主动调度一次检查。
  const compatCheckTimerRef = useRef<number | null>(null)
  const scheduleCompatCheck = useCallback(() => {
    if (compatCheckTimerRef.current !== null) return
    compatCheckTimerRef.current = window.setTimeout(() => {
      compatCheckTimerRef.current = null
      const editor = editorRef.current
      if (!editor) return
      const reason = enforceEdgeCompat(editor)
      if (reason) showEdgeNotice(reason)
    }, 0)
  }, [showEdgeNotice])

  useEffect(() => {
    return () => {
      if (edgeNoticeTimerRef.current !== null) {
        window.clearTimeout(edgeNoticeTimerRef.current)
      }
      if (compatCheckTimerRef.current !== null) {
        window.clearTimeout(compatCheckTimerRef.current)
      }
    }
  }, [])

  /** 整体替换画布内容：节点 + 按 doc.edges 物化箭头（B1 P1 返工：刷新后箭头重建，边不丢） */
  const replaceCanvasShapes = useCallback(
    (editor: Editor, doc: CanvasDoc) => {
      suppressSaveRef.current = true
      try {
        const shapes = editor.getCurrentPageShapes()
        const staleIds = shapes
          .filter((s) => s.type === CANVAS_NODE_SHAPE_TYPE || s.type === 'arrow')
          .map((s) => s.id)
        if (staleIds.length > 0) editor.deleteShapes(staleIds)
        if (doc.nodes.length > 0) {
          editor.createShapes(docToShapePartials(doc))
        }
        const { arrowPartials, bindingCreates } = docEdgesToArrowCreations(doc)
        if (arrowPartials.length > 0) {
          editor.createShapes(arrowPartials)
          // 绑定创建后 ArrowBindingUtil 会自动按锚点重算箭头几何（端点吸附节点边缘）
          editor.createBindings(bindingCreates)
        }
        editor.zoomToFit()
      } finally {
        suppressSaveRef.current = false
      }
      // restore 的 store 变更不会触发 listen（注册在后），这里主动做一次兼容/悬空检查
      scheduleCompatCheck()
    },
    [scheduleCompatCheck]
  )

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      // 暴露到 window 供实机冒烟/自动化诊断使用（不参与业务逻辑）
      ;(window as unknown as { __wlsEditor?: Editor }).__wlsEditor = editor

      // 载入已保存文档（有内容才灌入；空文档不动画布）
      const initial = getDoc()
      if (initial.nodes.length > 0) {
        replaceCanvasShapes(editor, initial)
      }

      // 画布任何变更 → 防抖 400ms 落盘 + 非法连线检查
      const unsub = editor.store.listen(
        () => {
          scheduleCompatCheck()
          schedulePersist()
        },
        { scope: 'document' }
      )

      return () => {
        unsub()
        editorRef.current = null
      }
    },
    [getDoc, replaceCanvasShapes, scheduleCompatCheck, schedulePersist]
  )

  // 多标签页同步：storage 事件 → 校验通过且更新则整体替换画布内容（含箭头物化）
  useEffect(() => {
    return subscribeExternalCanvasChanges((external) => {
      const editor = editorRef.current
      if (!editor) return
      if (external.updatedAt <= getDoc().updatedAt) return
      docRef.current = external
      setDocName(external.name)
      replaceCanvasShapes(editor, external)
    })
  }, [getDoc, replaceCanvasShapes])

  const addNode = useCallback((kind: CanvasNodeKind, meta: Record<string, unknown> = {}) => {
    const editor = editorRef.current
    if (!editor) return
    const nodeId = createNodeId()
    const bounds = editor.getViewportPageBounds()
    const w = 260
    const h = 160
    editor.createShape({
      id: nodeIdToShapeId(nodeId) as TLShapeId,
      type: CANVAS_NODE_SHAPE_TYPE,
      x: Math.round(bounds.center.x - w / 2 + (Math.random() * 60 - 30)),
      y: Math.round(bounds.center.y - h / 2 + (Math.random() * 60 - 30)),
      props: { w, h, kind, meta: meta as JsonObject },
    })
  }, [])

  // 对话栏：一句话 → Brief 节点上画布（一期 A 只落画布；调 LLM 编排是一期 B，页内诚实标注）
  const [chatDraft, setChatDraft] = useState('')
  const chatInputRef = useRef<HTMLInputElement>(null)
  const onChatSend = useCallback(() => {
    const text = chatDraft.trim()
    if (!text) return
    addNode('brief', { text })
    setChatDraft('')
    chatInputRef.current?.focus()
  }, [addNode, chatDraft])

  const onChatKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault()
        onChatSend()
      }
    },
    [onChatSend]
  )

  const onTemplatePick = useCallback(
    (prompt: string) => {
      setChatDraft(prompt)
      chatInputRef.current?.focus()
    },
    []
  )

  const onRename = useCallback(
    (name: string) => {
      const trimmed = name.trim() || '未命名画布'
      docRef.current = { ...getDoc(), name: trimmed }
      setDocName(trimmed)
      persistNow()
    },
    [getDoc, persistNow]
  )

  const onClear = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const ids = editor
      .getCurrentPageShapes()
      .filter((s) => s.type === CANVAS_NODE_SHAPE_TYPE || s.type === 'arrow')
      .map((s) => s.id)
    if (ids.length > 0) editor.deleteShapes(ids)
    docRef.current = { ...getDoc(), nodes: [], edges: [] }
    clearCanvasDoc()
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
  }, [getDoc])

  const paletteItems = useMemo(
    () => CANVAS_NODE_KINDS.map((kind) => ({ kind, ...CANVAS_NODE_META[kind] })),
    []
  )

  return (
    <div className="wls-canvas-app" data-testid="canvas-workbench">
      {/* 顶栏：品牌 + 模式切换（对齐 WorkbenchHeader 交互） */}
      <header className="wls-canvas-topbar">
        <div className="header-brand">
          <span className="logo-badge">WLS</span>
          <div className="brand-text">
            <h1>WebLockShot · Agent 创意画布</h1>
            <span className="wls-canvas-phase-tag">一期 A · 初意工作室（自由创作空间）</span>
          </div>
        </div>

        <div className="mode-toggle" role="tablist" aria-label="工作模式">
          <button type="button" className="mode-btn" onClick={onSwitchToSell}>
            🎯 带货工作台
          </button>
          <button type="button" className="mode-btn" onClick={onSwitchToDrama}>
            🎭 剧情短剧
          </button>
          <button type="button" className="mode-btn active" aria-current="page">
            🎨 Agent 画布
          </button>
        </div>
      </header>

      <div className="wls-canvas-body">
        {/* 左侧节点面板 */}
        <aside className="wls-node-palette" aria-label="Agent 节点面板">
          <div className="wls-palette-title">Agent 节点</div>
          {paletteItems.map((item) => (
            <button
              key={item.kind}
              type="button"
              className="wls-palette-item"
              title={item.hint}
              onClick={() => addNode(item.kind)}
            >
              <span className="wls-palette-accent" style={{ background: item.accent }} />
              <span className="wls-palette-icon">{item.icon}</span>
              <span className="wls-palette-label">{item.label}</span>
              <span className="wls-palette-phase">{item.phase}</span>
            </button>
          ))}
          <div className="wls-palette-tip">
            点击添加节点到画布中央；灰态节点为后续阶段占位（诚实标注，不装可用）。
          </div>
        </aside>

        {/* tldraw 画布 */}
        <main className="wls-canvas-stage">
          <div className="wls-canvas-toolbar">
            <input
              className="wls-canvas-name"
              value={docName}
              maxLength={120}
              aria-label="画布名称"
              onChange={(e) => onRename(e.target.value)}
            />
            <button type="button" className="wls-canvas-btn" onClick={onClear}>
              🧹 清空画布
            </button>
            <span className="wls-canvas-save-state">已保存 {savedAt}</span>
          </div>
          <div className="wls-canvas-root">
            <Tldraw shapeUtils={[WlsNodeUtil]} onMount={handleMount}>
              <CanvasEmptyHint />
            </Tldraw>

            {/* B1：非法连线拒绝提示条（画布内顶部居中，3 秒自动消失） */}
            {edgeNotice && (
              <div className="wls-edge-toast" role="alert" data-testid="edge-notice">
                ⛔ {edgeNotice}
              </div>
            )}

            {/* 对话栏：对齐 Miora 图1 底部大输入卡 + 场景模板快捷入口 */}
            <div className="wls-chat-dock">
              <div className="wls-chat-bar">
                <input
                  ref={chatInputRef}
                  className="wls-chat-input"
                  value={chatDraft}
                  maxLength={500}
                  placeholder="描述你想要什么，Agent 帮你上画布…"
                  aria-label="对话栏：一句话生成 Brief 节点"
                  onChange={(e) => setChatDraft(e.target.value)}
                  onKeyDown={onChatKeyDown}
                />
                <button type="button" className="wls-chat-send" onClick={onChatSend}>
                  发送 ↗
                </button>
              </div>
              <div className="wls-chat-templates">
                {CANVAS_SCENE_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className="wls-chat-chip"
                    title={tpl.prompt}
                    onClick={() => onTemplatePick(tpl.prompt)}
                  >
                    {tpl.icon} {tpl.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/** 画布内诚实标注条（tldraw 左上菜单下方，单一信息位） */
function CanvasEmptyHint() {
  return (
    <div className="wls-canvas-hint" dir="ltr">
      对话栏一期 A 只落 Brief 节点 · 连线与业务管线为一期 B · 灰态节点为二/三期占位 · License 水印为 tldraw 免费版
    </div>
  )
}
