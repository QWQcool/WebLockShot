import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tldraw, type Editor, type JsonObject, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import '../../canvas/canvas.css'
import { chatCompletionsText } from '../../ai/client.ts'
import { TOKEN_STORAGE_KEY, type TokenConfig } from '../../types.ts'
import {
  CANVAS_NODE_KINDS,
  CANVAS_NODE_META,
  CANVAS_NODE_SHAPE_TYPE,
  CANVAS_SCENE_TEMPLATES,
  OFFICIAL_SKILLS,
  buildDemoOrchestrationPlan,
  createNodeId,
  extractSkillManifest,
  filterOrchestrationParams,
  initialNodeY,
  nodeAvailability,
  nodeIdToShapeId,
  parseOrchestrationPlan,
  routeOrchestrationScene,
  shapeIdToNodeId,
  skillManifestToNodes,
  validateCanvasDoc,
  validateEdgeKind,
  validateSkillManifest,
  validateSkillManifestDetailed,
  readAssetMetaPayload,
  type CanvasDoc,
  type CanvasNodeKind,
  type OrchestrationPlan,
  type SkillManifest,
} from '../../canvas/contract.ts'
import { subscribeExternalCanvasChanges } from '../../canvas/canvasStore.ts'
import {
  createProject,
  deleteProject,
  loadProjectDoc,
  readProjectsIndex,
  renameProject,
  saveProjectDoc,
  setActiveProject,
  type ProjectsIndex,
} from '../../canvas/projectStore.ts'
import { type MiniRect } from '../../canvas/minimap.ts'
import { MiniMap } from './MiniMap.tsx'
import {
  docEdgesToArrowCreations,
  docToShapePartials,
  editorPageToCanvasDraft,
} from '../../canvas/serialize.ts'
import { WlsNodeUtil } from '../../canvas/WlsNodeUtil.tsx'
import { MemoryGraphView } from './MemoryGraphView.tsx'
import type { MemoryGraphThumbInput } from '../../canvas/memoryGraph.ts'
import { SkillMarketView } from './SkillMarketView.tsx'
import { ConnectorPanelView } from './ConnectorPanelView.tsx'
import { CanvasOnboardingView } from './CanvasOnboardingView.tsx'
import { SceneGalleryView } from './SceneGalleryView.tsx'
import {
  mcpEdgeArrowId,
  mcpNodeShapeId,
  validateMcpOps,
  type McpCreateEdgeOp,
  type McpCreateNodeOp,
  type McpOp,
} from '../../canvas/mcpOps.ts'
import { probeMcpCapability, pullMcpOps, pushTopology } from '../../services/companion/mcpClient.ts'
import { ORCHESTRATION_SYSTEM_PROMPT } from '../../canvas/orchestrationPrompt.ts'
import { markOnboardingSeen, readOnboardingSeen } from '../../canvas/canvasOnboarding.ts'
import { findInstalledByName, readSkillLibrary, type InstalledSkill } from '../../canvas/skillLibrary.ts'
import { Stage3DStudio } from '../stage3d/Stage3DStudio.tsx'
import {
  readStage3DMetaPayload,
  writeStage3DMetaPayload,
  createEmptyStage3DPayload,
  STAGE3D_OPEN_EVENT,
  type Stage3DMetaPayload,
} from '../../canvas/stage3dMeta.ts'
import {
  writeStage3DFrameSequence,
  type Stage3DFrameSequence,
} from '../../canvas/stage3dFrames.ts'
import { useLanguage, useT } from '../../i18n/useLanguage.ts'
import { setLanguage } from '../../i18n/language.ts'
import { nodeAvailabilityKey, nodeHint, nodeLabel, templateLabel } from '../../i18n/strings.ts'
import { TldrawLicenseNotice } from './TldrawLicenseNotice.tsx'

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
  // I1：界面语言（默认中文；切换后顶栏/工具条/节点面板/对话栏即时重渲染）
  const lang = useLanguage()
  const t = useT()
  const editorRef = useRef<Editor | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const suppressSaveRef = useRef(false)
  // 惰性读取已保存文档（首次访问时执行一次）。
  // ⚠️ D9 关键：**项目 id 与文档必须绑定在同一条目里**——否则防抖落盘若用旧闭包的
  // activeProjectId + 新 docRef，会把新项目文档写进旧项目键（实测数据串写）。
  const docRef = useRef<{ projectId: string; doc: CanvasDoc } | null>(null)
  const [docName, setDocName] = useState<string>('')
  const [savedAt, setSavedAt] = useState<string>('—')

  // D9 多画布项目：索引（含老单文档首次迁移）+ 当前项目；每项目独立存储键，切换不串数据
  const [projectIndex, setProjectIndex] = useState<ProjectsIndex>(() => readProjectsIndex())
  const activeProjectId = projectIndex.activeId
  const [projectNotice, setProjectNotice] = useState<string | null>(null)

  const getDoc = useCallback((): CanvasDoc => {
    if (docRef.current === null) {
      docRef.current = { projectId: activeProjectId, doc: loadProjectDoc(undefined, activeProjectId) }
    }
    return docRef.current.doc
  }, [activeProjectId])

  useEffect(() => {
    setDocName(getDoc().name)
  }, [getDoc])

  const persistNow = useCallback(() => {
    const editor = editorRef.current
    if (!editor || suppressSaveRef.current) return
    const entry = docRef.current
    if (!entry) return
    const draft = editorPageToCanvasDraft(editor, {
      id: entry.doc.id,
      name: entry.doc.name,
      updatedAt: Date.now(),
    })
    const validated = validateCanvasDoc({ ...draft, version: 1 as const })
    if (!validated) return
    // 落盘目标由 ref 条目自带（与文档同源），不受闭包中 activeProjectId 新旧影响
    docRef.current = { projectId: entry.projectId, doc: validated }
    const ok = saveProjectDoc(undefined, entry.projectId, validated)
    setSavedAt(
      ok
        ? new Date(validated.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
        : '保存失败（localStorage 不可用）'
    )
  }, [])

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

  // S1：tldraw 选中集里的 wls-node 数量（session scope 变更；导出 Skill 按钮的可用条件）
  const [selectedNodeCount, setSelectedNodeCount] = useState(0)

  // S1：导出 Skill 提示条（复用 B1 toast 样式，3 秒自动消失）
  const [skillNotice, setSkillNotice] = useState<string | null>(null)
  const skillNoticeTimerRef = useRef<number | null>(null)
  const showSkillNotice = useCallback((msg: string) => {
    setSkillNotice(msg)
    if (skillNoticeTimerRef.current !== null) {
      window.clearTimeout(skillNoticeTimerRef.current)
    }
    skillNoticeTimerRef.current = window.setTimeout(() => {
      skillNoticeTimerRef.current = null
      setSkillNotice(null)
    }, 3000)
  }, [])

  useEffect(() => {
    return () => {
      if (edgeNoticeTimerRef.current !== null) {
        window.clearTimeout(edgeNoticeTimerRef.current)
      }
      if (compatCheckTimerRef.current !== null) {
        window.clearTimeout(compatCheckTimerRef.current)
      }
      if (skillNoticeTimerRef.current !== null) {
        window.clearTimeout(skillNoticeTimerRef.current)
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

  /** D9：切换项目（保存当前 → 载入目标文档 → 整体替换画布内容） */
  const switchProject = useCallback(
    (id: string) => {
      const editor = editorRef.current
      if (id === activeProjectId) return
      persistNow()
      const next = setActiveProject(undefined, id)
      setProjectIndex(next)
      const doc = loadProjectDoc(undefined, id)
      docRef.current = { projectId: id, doc }
      setDocName(doc.name)
      setProjectNotice(`已切换到项目「${doc.name}」`)
      if (editor) replaceCanvasShapes(editor, doc)
    },
    [activeProjectId, persistNow, replaceCanvasShapes]
  )

  /** D9：新建项目并切过去 */
  const handleCreateProject = useCallback(() => {
    const name = window.prompt(
      t('project.newPrompt'),
      t('project.defaultName', { n: projectIndex.projects.length + 1 })
    )
    if (name === null) return
    // 切走前先把当前项目落盘（否则未落盘内容会随 docRef 重置丢失）
    persistNow()
    const r = createProject(undefined, name)
    if (!r.ok) {
      setProjectNotice(`⛔ ${r.reason}`)
      return
    }
    setProjectIndex(r.index)
    const doc = loadProjectDoc(undefined, r.id)
    docRef.current = { projectId: r.id, doc }
    setDocName(doc.name)
    const editor = editorRef.current
    if (editor) replaceCanvasShapes(editor, doc)
    setProjectNotice(`✓ 已新建项目「${doc.name}」`)
  }, [projectIndex.projects.length, persistNow, replaceCanvasShapes, t])

  /** D9：删除当前项目（至少保留一个；删后自动切到剩余项目） */
  const handleDeleteProject = useCallback(() => {
    if (projectIndex.projects.length <= 1) {
      setProjectNotice('⛔ 至少保留一个项目')
      return
    }
    const current = projectIndex.projects.find((p) => p.id === activeProjectId)
    if (!window.confirm(t('project.deleteConfirm', { name: current?.name ?? '' }))) return
    const r = deleteProject(undefined, activeProjectId)
    if (!r.ok) {
      setProjectNotice(`⛔ ${r.reason}`)
      return
    }
    setProjectIndex(r.index)
    const doc = loadProjectDoc(undefined, r.id)
    docRef.current = { projectId: r.id, doc }
    setDocName(doc.name)
    const editor = editorRef.current
    if (editor) replaceCanvasShapes(editor, doc)
    setProjectNotice(`已删除项目并切换到「${doc.name}」`)
  }, [projectIndex.projects, activeProjectId, replaceCanvasShapes, t])

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

      // S1：选中集变化（session scope）→ 统计 wls-node 数量，驱动「导出 Skill」按钮可用态
      const unsubSession = editor.store.listen(
        () => {
          let count = 0
          for (const id of editor.getSelectedShapeIds()) {
            if (editor.getShape(id)?.type === CANVAS_NODE_SHAPE_TYPE) count++
          }
          setSelectedNodeCount((prev) => (prev === count ? prev : count))
        },
        { scope: 'session' }
      )

      return () => {
        unsub()
        unsubSession()
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
      docRef.current = { projectId: docRef.current?.projectId ?? activeProjectId, doc: external }
      setDocName(external.name)
      replaceCanvasShapes(editor, external)
    })
  }, [getDoc, replaceCanvasShapes, activeProjectId])

  const addNode = useCallback((kind: CanvasNodeKind, meta: Record<string, unknown> = {}) => {
    const editor = editorRef.current
    if (!editor) return
    const nodeId = createNodeId()
    const bounds = editor.getViewportPageBounds()
    // B2/B3/B4/B5：按节点内容定默认尺寸
    const [w, h] =
      kind === 'script'
        ? [300, 220]
        : kind === 'storyboard'
          ? [300, 560]
          : kind === 'generate'
            ? [300, 320]
            : kind === 'asset'
              ? [200, 380]
              : kind === 'product'
                ? [300, 340]
                : kind === 'deliver'
                  ? [300, 400]
                  : kind === 'edit'
                    ? [300, 460]
                    : [260, 160]
    // B4 任务 0：初始摆放避开底部对话栏浮层（避让带 150px），防止控件被遮挡
    const y = initialNodeY(
      bounds.center.y,
      h,
      bounds.maxY,
      150,
      Math.random() * 60 - 30
    )
    editor.createShape({
      id: nodeIdToShapeId(nodeId) as TLShapeId,
      type: CANVAS_NODE_SHAPE_TYPE,
      x: Math.round(bounds.center.x - w / 2 + (Math.random() * 60 - 30)),
      y: Math.round(y),
      props: { w, h, kind, meta: meta as JsonObject },
    })
  }, [])

  // C0：对话栏一键收起（折叠为右下角小胶囊，点击展开还原），收起态完整暴露 tldraw 底部工具条
  const [chatCollapsed, setChatCollapsed] = useState(false)

  // E1 记忆图谱（Miora 图4 回炉）：画布工具条入口 + 真实素材缩略叶（打开时从 asset 卡收集）
  const [isMemoryGraphOpen, setIsMemoryGraphOpen] = useState(false)
  const [memoryThumbs, setMemoryThumbs] = useState<MemoryGraphThumbInput[]>([])

  // E2 Skill 市场（Miora 图5 回炉）：工具条入口 + 已安装库状态（官方快捷按钮启停过滤）
  const [isSkillMarketOpen, setIsSkillMarketOpen] = useState(false)
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>(() => readSkillLibrary())
  const refreshInstalledSkills = useCallback(() => {
    setInstalledSkills(readSkillLibrary())
  }, [])

  // D4 连接器面板（Miora 图6 回炉）：工具条入口 + 全屏覆盖层（协议层 mock，诚实标注未接入）
  const [isConnectorPanelOpen, setIsConnectorPanelOpen] = useState(false)

  // D5 开场层（Miora 图1 形态）：首次进入叠加（五类场景 tab + 大输入卡 + 连接器条），
  // 「进入画布」/ Esc 后写入已读标记，之后折叠为底部既有对话栏（不重复弹）
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() => !readOnboardingSeen())
  const closeOnboarding = useCallback(() => {
    markOnboardingSeen()
    setIsOnboardingOpen(false)
  }, [])

  // D6 创作场景画廊（Miora 图8 回炉）：工具条/开场层入口；卡片点击 → 预填对话栏 或 一键编排（复用 B6）
  const [isSceneGalleryOpen, setIsSceneGalleryOpen] = useState(false)

  // D8 MCP 反向驱动：能力位就绪（伴生服务 + 可选 SDK）时启用拓扑镜像推送与 Agent 操作批轮询
  const [mcpReady, setMcpReady] = useState(false)
  const [mcpNotice, setMcpNotice] = useState<string | null>(null)
  const mcpSeqRef = useRef(0)
  // 导入盐：隔离 Agent 侧 id 与本地 id 空间（同一 Agent 反复下发不冲突）。
  // 初值留空，在桥接 effect 内惰性生成——render 期不调用 Math.random（react/purity）
  const mcpSaltRef = useRef('')
  const mcpPushedSigRef = useRef('')

  // D1 3D 运镜台：stage3d 节点按钮派发 window 事件 → 打开全屏 Stage3DStudio；
  // 摆台数据经 writeStage3DMetaPayload 写回节点 meta.stage3d（走既有 shape 变更 → 持久化链路）
  const [stage3dTarget, setStage3dTarget] = useState<{ shapeId: TLShapeId; payload: Stage3DMetaPayload } | null>(null)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ shapeId: TLShapeId }>).detail
      if (!detail?.shapeId) return
      const shape = editorRef.current?.getShape(detail.shapeId)
      if (!shape || shape.type !== CANVAS_NODE_SHAPE_TYPE) return
      const meta = (shape.props as { meta?: Record<string, unknown> }).meta ?? {}
      const check = meta.stage3d !== undefined ? readStage3DMetaPayload(meta.stage3d) : null
      setStage3dTarget({
        shapeId: detail.shapeId,
        payload: check?.ok ? check.payload : createEmptyStage3DPayload(),
      })
    }
    window.addEventListener(STAGE3D_OPEN_EVENT, handler)
    return () => window.removeEventListener(STAGE3D_OPEN_EVENT, handler)
  }, [])

  const handleStage3DChange = useCallback((payload: Stage3DMetaPayload) => {
    setStage3dTarget((prev) => {
      if (!prev) return prev
      const editor = editorRef.current
      if (editor) {
        const shape = editor.getShape(prev.shapeId)
        if (shape && shape.type === CANVAS_NODE_SHAPE_TYPE) {
          const meta = (shape.props as { meta?: Record<string, unknown> }).meta ?? {}
          const written = writeStage3DMetaPayload(meta, payload)
          if (written) {
            editor.updateShape({
              id: prev.shapeId,
              type: shape.type,
              props: { meta: written as JsonObject },
            })
          }
        }
      }
      return { ...prev, payload }
    })
  }, [])

  /**
   * D3：3D 运镜台导出机位帧序列 → 一次 updateShape 原子写入
   * meta.stage3d（当前摆台数据）+ meta.stage3dFrames（渲染帧 + 运镜轨迹 + 文字描述）。
   * 下游 generate / storyboard 沿边读取该导出物（B/D 口）。
   */
  const handleStage3DExportFrames = useCallback(
    (sequence: Stage3DFrameSequence, payload: Stage3DMetaPayload) => {
      setStage3dTarget((prev) => {
        if (!prev) return prev
        const editor = editorRef.current
        if (editor) {
          const shape = editor.getShape(prev.shapeId)
          if (shape && shape.type === CANVAS_NODE_SHAPE_TYPE) {
            const baseMeta = (shape.props as { meta?: Record<string, unknown> }).meta ?? {}
            const withStage = writeStage3DMetaPayload(baseMeta, payload) ?? baseMeta
            const written = writeStage3DFrameSequence(withStage, sequence)
            if (written) {
              editor.updateShape({
                id: prev.shapeId,
                type: shape.type,
                props: { meta: written as JsonObject },
              })
            }
          }
        }
        return { ...prev, payload }
      })
    },
    []
  )
  const openMemoryGraph = useCallback(() => {
    const editor = editorRef.current
    const thumbs: MemoryGraphThumbInput[] = []
    if (editor) {
      for (const s of editor.getCurrentPageShapes()) {
        if (s.type !== CANVAS_NODE_SHAPE_TYPE) continue
        const props = s.props as { kind?: unknown; meta?: Record<string, unknown> }
        if (props.kind !== 'asset') continue
        const payload = readAssetMetaPayload(props.meta)
        if (payload && payload.type === 'image') {
          thumbs.push({ ref: payload.url, label: payload.title || payload.shotId })
        }
      }
    }
    setMemoryThumbs(thumbs)
    setIsMemoryGraphOpen(true)
  }, [])

  // 对话栏：B6 LLM/演示两态编排（一句话 → 整批节点+连线上画布，可一键撤销）
  const [chatDraft, setChatDraft] = useState('')
  const chatInputRef = useRef<HTMLInputElement>(null)
  const [orchestrating, setOrchestrating] = useState(false)
  const [orchestrationNotice, setOrchestrationNotice] = useState<string | null>(null)
  const [orchestrationNoticeOpen, setOrchestrationNoticeOpen] = useState(false)
  // 撤销按钮显隐信号（ids 本体存 orchestrationIdsRef，避免渲染期读 ref）
  const [hasUndoable, setHasUndoable] = useState(false)
  // P1 修复：撤销 ids 用 ref 快照（布置时写入）——不依赖渲染期 state（tldraw shape 组件
  // 可能 remount 导致 state 重置/闭包过期，B4/B6 两轮教训）
  const orchestrationIdsRef = useRef<TLShapeId[] | null>(null)
  const orchestrationUndoTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (orchestrationUndoTimerRef.current !== null) {
        window.clearTimeout(orchestrationUndoTimerRef.current)
      }
    }
  }, [])

  const showOrchestrationNotice = useCallback((msg: string) => {
    setOrchestrationNotice(msg)
    setOrchestrationNoticeOpen(true)
    if (orchestrationUndoTimerRef.current !== null) {
      window.clearTimeout(orchestrationUndoTimerRef.current)
    }
  }, [])

  const closeOrchestrationNotice = useCallback(() => {
    setOrchestrationNoticeOpen(false)
    if (orchestrationUndoTimerRef.current !== null) {
      window.clearTimeout(orchestrationUndoTimerRef.current)
      orchestrationUndoTimerRef.current = null
    }
  }, [])

  /**
   * P1 修复：撤销本次编排——直接读布置时记录的 shapeIds 快照（ref），不依赖渲染期引用；
   * 除整批 shapes 外，再扫描「两端任在本批」的箭头一并删除；异常不吞（console 保留现场）。
   */
  const handleOrchestrationUndo = useCallback(() => {
    const editor = editorRef.current
    const ids = orchestrationIdsRef.current
    if (!editor || !ids || ids.length === 0) return
    try {
      const idSet = new Set<string>(ids)
      // 相关箭头一并删：两端任一端在本批中的箭头（防用户已手动改动拓扑后残留连线）
      const relatedArrows = editor
        .getCurrentPageShapes()
        .filter((s) => {
          if (s.type !== 'arrow') return false
          const bs = editor.getBindingsFromShape(s, 'arrow')
          return bs.some((b) => idSet.has(b.toId))
        })
        .map((s) => s.id)
      editor.deleteShapes([...ids, ...relatedArrows])
      orchestrationIdsRef.current = null
      setHasUndoable(false)
      closeOrchestrationNotice()
    } catch (err) {
      console.warn('[Canvas][orchestration-undo] 删除失败:', err)
      closeOrchestrationNotice()
    }
  }, [closeOrchestrationNotice])

  /** 把编排计划落到画布：单一 editor.run batch（节点+连线整体，Ctrl+Z 一次回滚） */
  const applyOrchestrationPlan = useCallback(
    (plan: OrchestrationPlan, mode: 'demo' | 'llm'): TLShapeId[] => {
      const editor = editorRef.current
      if (!editor) return []
      const created: TLShapeId[] = []
      const orchestrationId = `orch-${Date.now().toString(36)}`
      const bounds = editor.getViewportPageBounds()
      const nodeShapeIds: TLShapeId[] = []
      // S3（主控批准并入）：编程式 run 不自动打 history mark，对齐 S2 导入修复——
      // 保证 Ctrl+Z 精确回滚本次编排批次，不连带撤销用户之前的操作
      editor.markHistoryStoppingPoint()
      editor.run(() => {
        plan.nodes.forEach((node, index) => {
          const nodeId = createNodeId()
          const shapeId = nodeIdToShapeId(nodeId) as TLShapeId
          nodeShapeIds.push(shapeId)
          // 编排布局：两列瀑布式，避开对话栏避让带
          const col = Math.floor(index / 3)
          const row = index % 3
          const [w, h] =
            node.kind === 'storyboard'
              ? [300, 560]
              : node.kind === 'generate' || node.kind === 'product' || node.kind === 'deliver'
                ? [300, 320]
                : node.kind === 'script'
                  ? [300, 220]
                  : [260, 160]
          const meta: Record<string, unknown> = {
            ...filterOrchestrationParams(node.kind, node.params),
            orchestrated: mode,
            orchestrationId,
          }
          if (node.kind === 'brief' && typeof meta.text !== 'string') meta.text = plan.title
          const x = Math.round(bounds.minX + 40 + col * 380)
          const y = Math.round(
            initialNodeY(bounds.center.y, h, bounds.maxY, 150) - 120 + row * (h + 40)
          )
          editor.createShape({
            id: shapeId,
            type: CANVAS_NODE_SHAPE_TYPE,
            x,
            y,
            props: { w, h, kind: node.kind, meta: meta as JsonObject },
          })
          created.push(shapeId)
        })
        // 连线（plan.edges 下标对 → 箭头 shape + 两端 binding）
        plan.edges.forEach((edge) => {
          const fromShapeId = nodeShapeIds[edge.from]
          const toShapeId = nodeShapeIds[edge.to]
          if (!fromShapeId || !toShapeId) return
          const fromShape = editor.getShape(fromShapeId)
          const toShape = editor.getShape(toShapeId)
          if (!fromShape || !toShape) return
          const arrowId = `shape:orch-${orchestrationId}-${edge.from}-${edge.to}` as TLShapeId
          editor.createShape({
            id: arrowId,
            type: 'arrow',
            x: fromShape.x,
            y: fromShape.y,
            props: {
              start: { x: 0, y: 0 },
              end: { x: toShape.x - fromShape.x, y: toShape.y - fromShape.y },
            },
          })
          created.push(arrowId)
          editor.createBindings([
            {
              fromId: arrowId,
              toId: fromShapeId,
              type: 'arrow',
              props: { terminal: 'start' as const },
            },
            {
              fromId: arrowId,
              toId: toShapeId,
              type: 'arrow',
              props: { terminal: 'end' as const },
            },
          ])
        })
      })
      return created
    },
    []
  )

  /**
   * D8：应用本地 Agent 经 MCP 提交的操作批（反向驱动画布）。
   * 单一 editor.run batch（Ctrl+Z 一次回滚）；id 带导入盐隔离；已存在的 shape 幂等跳过。
   */
  const applyMcpOps = useCallback((ops: McpOp[]) => {
    const editor = editorRef.current
    if (!editor || ops.length === 0) return 0
    const salt = mcpSaltRef.current || 's0'
    const existing = new Set<string>(editor.getCurrentPageShapes().map((s) => s.id as string))
    const nodes = ops.filter((o): o is McpCreateNodeOp => o.type === 'create-node')
    const edges = ops.filter((o): o is McpCreateEdgeOp => o.type === 'create-edge')
    let applied = 0
    editor.markHistoryStoppingPoint()
    editor.run(() => {
      for (const n of nodes) {
        const shapeId = mcpNodeShapeId(n.id, salt)
        if (existing.has(shapeId)) continue
        editor.createShape({
          id: shapeId as TLShapeId,
          type: CANVAS_NODE_SHAPE_TYPE,
          x: n.x,
          y: n.y,
          props: { w: n.w, h: n.h, kind: n.kind, meta: n.meta as JsonObject },
        })
        existing.add(shapeId)
        applied++
      }
      for (const e of edges) {
        const arrowId = mcpEdgeArrowId(e.id, salt)
        const fromId = mcpNodeShapeId(e.from, salt)
        const toId = mcpNodeShapeId(e.to, salt)
        if (existing.has(arrowId)) continue
        if (!editor.getShape(fromId as TLShapeId) || !editor.getShape(toId as TLShapeId)) continue
        editor.createShape({
          id: arrowId as TLShapeId,
          type: 'arrow',
          x: 0,
          y: 0,
          props: { start: { x: 0, y: 0 }, end: { x: 120, y: 0 } },
        })
        editor.createBindings([
          { fromId: arrowId as TLShapeId, toId: fromId as TLShapeId, type: 'arrow', props: { terminal: 'start' as const } },
          { fromId: arrowId as TLShapeId, toId: toId as TLShapeId, type: 'arrow', props: { terminal: 'end' as const } },
        ])
        existing.add(arrowId)
        applied++
      }
    })
    if (applied > 0) editor.zoomToFit()
    return applied
  }, [])

  /**
   * D8 MCP 桥接循环：能力位就绪时启用。
   * ① 轮询 Agent 操作批 → 校验 → 应用（画布实时反映）；
   * ② 把本地画布拓扑镜像推送到伴生服务（供本地 Agent 读取）。
   * 能力位未就绪（未装 SDK / 无伴生服务）= 完全不启动，行为与现状零差异。
   */
  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    if (!mcpSaltRef.current) mcpSaltRef.current = `s${Math.random().toString(36).slice(2, 6)}`

    const tick = async () => {
      if (cancelled) return
      const editor = editorRef.current
      if (!editor) return
      const pulled = await pullMcpOps(mcpSeqRef.current)
      if (cancelled) return
      if (pulled.ok) {
        for (const batch of pulled.batches) {
          const check = validateMcpOps(batch.ops)
          if (!check.ok) {
            setMcpNotice(`⚠️ 本地 Agent 操作批被拒：${check.reason}`)
            continue
          }
          const applied = applyMcpOps(check.ops)
          if (applied > 0) {
            setMcpNotice(`🤖 已应用本地 Agent 的 ${applied} 项画布操作（MCP 反向驱动 · 可 Ctrl+Z 撤销）`)
          }
        }
        mcpSeqRef.current = pulled.seq
      }
      const draft = editorPageToCanvasDraft(editor, { id: 'mirror', name: docName, updatedAt: Date.now() })
      const sig = `${draft.nodes.length}:${draft.edges.length}:${draft.nodes.map((n) => n.id).join(',')}|${draft.edges.map((e) => e.id).join(',')}`
      if (sig !== mcpPushedSigRef.current) {
        const pushed = await pushTopology({ nodes: draft.nodes, edges: draft.edges })
        if (!cancelled && pushed.ok) mcpPushedSigRef.current = sig
      }
    }

    void probeMcpCapability().then((cap) => {
      if (cancelled) return
      setMcpReady(cap.ready)
      if (!cap.ready) return
      void tick()
      timer = window.setInterval(() => void tick(), 2000)
    })

    return () => {
      cancelled = true
      if (timer !== null) window.clearInterval(timer)
    }
  }, [applyMcpOps, docName])

  /** B6 编排核心（D5：抽取为入参函数，供底部对话栏与开场层共用，避免两套编排逻辑） */
  const runOrchestration = useCallback(async (rawText: string) => {
    const text = rawText.trim()
    const editor = editorRef.current
    if (!text || !editor || orchestrating) return
    setOrchestrating(true)
    setOrchestrationNotice(null)
    setOrchestrationNoticeOpen(false)
    try {
      // 两态判定（沿 B2 同源口径）：实时读 sessionStorage token
      let token: TokenConfig | null = null
      try {
        const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
        if (raw) token = JSON.parse(raw) as TokenConfig
      } catch {}
      const hasKey = Boolean(token?.apiKey?.trim())
      const scene = routeOrchestrationScene(text)

      let plan: OrchestrationPlan | null = null
      let mode: 'demo' | 'llm' = 'demo'
      let degraded = false
      // P2-1：busy 可见反馈——提示条常驻「布置中」，输入框 placeholder 同步切换
      orchestrationIdsRef.current = null
      setHasUndoable(false)
      showOrchestrationNotice(t('orch.busy'))
      if (hasKey && token) {
        // 真实 LLM 编排：结构化 JSON 拓扑建议，≤2 次重试后降级演示
        mode = 'llm'
        // D5 遗留小修：system prompt 提取为共享常量（与 Skill 市场「通过对话创建技能」同源）
        const systemPrompt = ORCHESTRATION_SYSTEM_PROMPT
        for (let attempt = 0; attempt < 2; attempt++) {
          const raw = await chatCompletionsText(token, [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ])
          const parsed = parseOrchestrationPlan(raw)
          if (parsed) {
            // 参数按各自 meta 契约白名单收窄
            plan = {
              title: parsed.title,
              nodes: parsed.nodes.map((n) => ({
                kind: n.kind,
                params: filterOrchestrationParams(n.kind, n.params),
              })),
              edges: parsed.edges,
            }
            break
          }
        }
        if (!plan) {
          mode = 'demo'
          degraded = true
        }
      }

      if (!plan) {
        plan = buildDemoOrchestrationPlan(text, scene)
      }

      // 演示路径给 ~600ms「Agent 正在布置画布…」的动效感（真实 LLM 路径已有网络等待）
      if (mode === 'demo') await new Promise((res) => setTimeout(res, 600))

      const created = applyOrchestrationPlan(plan, mode)
      orchestrationIdsRef.current = created // P1：布置时记录 shapeIds 快照，撤销按钮直接读 ref
      setHasUndoable(created.length > 0)
      editor.zoomToFit()
      const modeLabel = mode === 'llm' ? t('orch.llm') : t('orch.demo')
      showOrchestrationNotice(
        modeLabel +
          t('orch.placed', { n: plan.nodes.length, e: plan.edges.length }) +
          (degraded ? t('orch.degraded') : '')
      )
      setChatDraft('')
      chatInputRef.current?.focus()
    } catch (err) {
      showOrchestrationNotice(t('orch.failed', { msg: err instanceof Error ? err.message : 'unknown error' }))
    } finally {
      setOrchestrating(false)
    }
  }, [applyOrchestrationPlan, orchestrating, showOrchestrationNotice, t])

  /** 底部对话栏发送（读取当前输入框内容） */
  const onChatSend = useCallback(() => {
    void runOrchestration(chatDraft)
  }, [chatDraft, runOrchestration])

  /** D5 开场层发送：走同一编排链路，关闭本层并标记已读 */
  const handleOnboardingSubmit = useCallback(
    (text: string) => {
      markOnboardingSeen()
      setIsOnboardingOpen(false)
      void runOrchestration(text)
    },
    [runOrchestration]
  )

  /** D6 画廊卡片：预填对话栏（用户可改后再发送） */
  const handleScenePrefill = useCallback((text: string) => {
    setIsSceneGalleryOpen(false)
    setChatDraft(text)
    chatInputRef.current?.focus()
  }, [])

  /** D6 画廊卡片：一键编排（复用 B6 既有链路，两态诚实标注不变） */
  const handleSceneOrchestrate = useCallback(
    (text: string) => {
      setIsSceneGalleryOpen(false)
      void runOrchestration(text)
    },
    [runOrchestration]
  )

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
      // D9：文档名与项目名保持同步（重名/超长由 projectStore 拒绝并如实提示）
      const r = renameProject(undefined, activeProjectId, trimmed)
      if (!r.ok) {
        setProjectNotice(`⛔ ${r.reason}`)
        return
      }
      setProjectIndex(r.index)
      const entry = docRef.current
      if (entry) docRef.current = { projectId: entry.projectId, doc: { ...entry.doc, name: trimmed } }
      setDocName(trimmed)
      persistNow()
    },
    [persistNow, activeProjectId]
  )

  const onClear = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const ids = editor
      .getCurrentPageShapes()
      .filter((s) => s.type === CANVAS_NODE_SHAPE_TYPE || s.type === 'arrow')
      .map((s) => s.id)
    if (ids.length > 0) editor.deleteShapes(ids)
    const entry = docRef.current
    if (!entry) return
    const cleared = { ...entry.doc, nodes: [], edges: [] }
    docRef.current = { projectId: entry.projectId, doc: cleared }
    saveProjectDoc(undefined, entry.projectId, { ...cleared, updatedAt: Date.now() })
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
  }, [])

  // D9 小地图：内容矩形（wls-node 页坐标）+ 视口矩形，300ms 轮询（去重后才 setState，避免无谓重渲染）
  const [mini, setMini] = useState<{ shapes: MiniRect[]; viewport: MiniRect }>({
    shapes: [],
    viewport: { x: 0, y: 0, w: 800, h: 600 },
  })
  useEffect(() => {
    const timer = window.setInterval(() => {
      const editor = editorRef.current
      if (!editor) return
      const rects: MiniRect[] = []
      for (const s of editor.getCurrentPageShapes()) {
        if (s.type !== CANVAS_NODE_SHAPE_TYPE) continue
        const b = editor.getShapePageBounds(s)
        if (b) rects.push({ x: b.minX, y: b.minY, w: b.width, h: b.height })
      }
      const vp = editor.getViewportPageBounds()
      const next = {
        shapes: rects,
        viewport: { x: vp.minX, y: vp.minY, w: vp.width, h: vp.height },
      }
      setMini((prev) => (miniEqual(prev, next) ? prev : next))
    }, 300)
    return () => window.clearInterval(timer)
  }, [])

  /** D9 小地图导航：点击/拖动 → 世界坐标 → 平滑居中 */
  const handleMiniNavigate = useCallback((world: { x: number; y: number }) => {
    const editor = editorRef.current
    if (!editor) return
    editor.centerOnPoint(world, { animation: { duration: 120 } })
  }, [])

  // S1：导出 Skill 包（CANVAS_PLAN.md §9 S1）：框选 ≥2 个 wls-node → 提取子拓扑 → manifest JSON 浏览器下载。
  // 参数走白名单过滤（brief.text / product.title / script.scriptScene），产物 url / maskRef / imports 等设备本地引用剥离。
  const handleExportSkill = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const selectedNodeIds: string[] = []
    for (const id of editor.getSelectedShapeIds()) {
      const nodeId = shapeIdToNodeId(id)
      if (nodeId && editor.getShape(id)?.type === CANVAS_NODE_SHAPE_TYPE) {
        selectedNodeIds.push(nodeId)
      }
    }
    if (selectedNodeCount < 2 || selectedNodeIds.length < 2) {
      showSkillNotice('导出 Skill 需先框选至少 2 个画布节点')
      return
    }
    const draft = editorPageToCanvasDraft(editor, {
      id: 'skill-export',
      name: docName || '未命名画布',
      updatedAt: Date.now(),
    })
    const manifest = extractSkillManifest(draft, selectedNodeIds, docName)
    if (!manifest || !validateSkillManifest(manifest)) {
      showSkillNotice('导出失败：选中子拓扑不满足 Skill 契约（参数槽位非法或边不兼容）')
      return
    }
    try {
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${manifest.name.replace(/[\\/:*?"<>|]/g, '_')}.wls-skill.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      showSkillNotice(
        `✓ 已导出 Skill「${manifest.name}」：${manifest.nodes.length} 节点 / ${manifest.edges.length} 边（产物与大资产字段已剥离）`
      )
    } catch (err) {
      showSkillNotice(`导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    }
  }, [docName, selectedNodeCount, showSkillNotice])

  // S2：Skill 导入布置（CANVAS_PLAN.md §9 S2）：单一 editor.run batch（节点+箭头整体，
  // Ctrl+Z 一次回滚），撤销按钮复用 B6 编排的 orchestrationIdsRef 快照机制。
  const applySkillImport = useCallback(
    (manifest: SkillManifest) => {
      const editor = editorRef.current
      if (!editor) return
      const bounds = editor.getViewportPageBounds()
      const plan = skillManifestToNodes(manifest, {
        minX: bounds.minX,
        maxX: bounds.maxX,
        centerY: bounds.center.y,
        bottomY: bounds.maxY,
      })
      if (!plan || plan.nodes.length === 0) {
        showSkillNotice('导入失败：Skill 包没有任何可布置节点')
        return
      }
      const doc = {
        version: 1 as const,
        id: 'skill-import',
        name: manifest.name,
        nodes: plan.nodes,
        edges: plan.edges,
        updatedAt: Date.now(),
      }
      const shapes = docToShapePartials(doc)
      const { arrowPartials, bindingCreates } = docEdgesToArrowCreations(doc)
      const created: TLShapeId[] = []
      // 编程式 run 不会自动打 history mark（实测 tldraw v5 连续编程操作并入同一段历史），
      // 显式打点保证 Ctrl+Z 精确回滚「本次导入」而不连带撤销用户之前的操作
      editor.markHistoryStoppingPoint()
      editor.run(() => {
        if (shapes.length > 0) editor.createShapes(shapes)
        if (arrowPartials.length > 0) {
          editor.createShapes(arrowPartials)
          editor.createBindings(bindingCreates)
        }
      })
      for (const s of shapes) created.push(s.id as TLShapeId)
      for (const a of arrowPartials) created.push(a.id)
      orchestrationIdsRef.current = created
      setHasUndoable(true)
      showOrchestrationNotice(
        t('orch.imported', { name: manifest.name, n: plan.nodes.length, e: plan.edges.length })
      )
      editor.zoomToFit()
    },
    [showOrchestrationNotice, showSkillNotice, t]
  )

  // S2：文件导入（非法 JSON / 不合格 manifest 整体拒绝并给中文原因，不半渲染）
  const importInputRef = useRef<HTMLInputElement>(null)
  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const raw: unknown = JSON.parse(await file.text())
        const check = validateSkillManifestDetailed(raw)
        if (!check.ok) {
          showSkillNotice(`⛔ 导入失败：${check.reason}`)
          return
        }
        applySkillImport(check.manifest)
      } catch (err) {
        showSkillNotice(
          `⛔ 导入失败：${err instanceof Error ? err.message : '文件不是合法 JSON'}`
        )
      }
    },
    [applySkillImport, showSkillNotice]
  )

  const paletteItems = useMemo(
    () =>
      CANVAS_NODE_KINDS.map((kind) => ({
        kind,
        icon: CANVAS_NODE_META[kind].icon,
        accent: CANVAS_NODE_META[kind].accent,
        // 阶段标签改为「可用性」口径（2026-09-11 校正）：期数（1A/1B/2/3）对用户已无意义，
        // 且与节点卡片徽标口径不一致（3D 运镜台明明可用却标「3」）。
        availability: nodeAvailability(kind),
        // I1：标签/提示走 i18n（切语言后随 lang 变化重建）
        label: nodeLabel(lang, kind),
        hint: nodeHint(lang, kind),
      })),
    [lang]
  )

  return (
    <div className="wls-canvas-app" data-testid="canvas-workbench">
      {/* 顶栏：品牌 + 模式切换（对齐 WorkbenchHeader 交互） */}
      <header className="wls-canvas-topbar">
        <div className="header-brand">
          <span className="logo-badge">WLS</span>
          <div className="brand-text">
            <h1>{t('app.brand')}</h1>
            <span className="wls-canvas-phase-tag">{t('app.subtitle')}</span>
          </div>
        </div>

        <div className="mode-toggle" role="tablist" aria-label={t('mode.aria')}>
          <button type="button" role="tab" aria-selected={false} className="mode-btn" onClick={onSwitchToSell}>
            {t('mode.sell')}
          </button>
          <button type="button" role="tab" aria-selected={false} className="mode-btn" onClick={onSwitchToDrama}>
            {t('mode.drama')}
          </button>
          <button type="button" role="tab" aria-selected={true} className="mode-btn active" aria-current="page">
            {t('mode.canvas')}
          </button>
        </div>
      </header>

      <div className="wls-canvas-body">
        {/* 左侧节点面板 */}
        <aside className="wls-node-palette" aria-label={t('palette.aria')}>
          <div className="wls-palette-title">{t('palette.title')}</div>
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
              <span className="wls-palette-phase">{t(nodeAvailabilityKey(item.availability))}</span>
            </button>
          ))}
          <div className="wls-palette-tip">{t('palette.tip')}</div>
        </aside>

        {/* tldraw 画布 */}
        <main className="wls-canvas-stage">
          <div className="wls-canvas-toolbar">
            {/* D9 多画布项目：切换 / 新建 / 删除（重命名用右侧名称输入框，与项目名同步） */}
            <select
              className="wls-project-select"
              data-testid="project-select"
              aria-label={t('project.aria')}
              value={activeProjectId}
              onChange={(e) => switchProject(e.target.value)}
            >
              {projectIndex.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="wls-canvas-btn"
              data-testid="project-new"
              title={t('project.newTitle')}
              onClick={handleCreateProject}
            >
              {t('project.new')}
            </button>
            <button
              type="button"
              className="wls-canvas-btn"
              data-testid="project-delete"
              title={t('project.deleteTitle')}
              onClick={handleDeleteProject}
            >
              {t('project.delete')}
            </button>
            <input
              className="wls-canvas-name"
              value={docName}
              maxLength={120}
              aria-label={t('project.nameAria')}
              onChange={(e) => onRename(e.target.value)}
            />
            <button
              type="button"
              className="wls-canvas-btn"
              data-testid="export-skill"
              disabled={selectedNodeCount < 2}
              title={
                selectedNodeCount < 2
                  ? t('toolbar.exportSkillNeedTwo')
                  : t('toolbar.exportSkillReady', { n: selectedNodeCount })
              }
              onClick={handleExportSkill}
            >
              {t('toolbar.exportSkill')}
              {selectedNodeCount >= 2 ? `（${selectedNodeCount}）` : ''}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="选择 Skill 包文件"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleImportFile(file)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="wls-canvas-btn"
              data-testid="import-skill"
              title={t('toolbar.importSkillTitle')}
              onClick={() => importInputRef.current?.click()}
            >
              {t('toolbar.importSkill')}
            </button>
            {/* E2：官方快捷按钮——已安装但停用的 Skill 从快捷入口消失（启停语义，dev 裁量）；
                未安装的官方 Skill 仍可快捷布置（保持 S2 既有行为，与市场「获取并安装」并存不冲突） */}
            {OFFICIAL_SKILLS.filter((skill) => {
              const installed = findInstalledByName(installedSkills, skill.manifest.name)
              return !installed || installed.enabled
            }).map((skill) => (
              <button
                key={skill.id}
                type="button"
                className="wls-canvas-btn"
                data-testid={`official-skill-${skill.id}`}
                title={`${skill.description}（官方预置，导入后填新输入即可运行）`}
                onClick={() => applySkillImport(skill.manifest)}
              >
                {skill.icon} {skill.label}
              </button>
            ))}
            <button type="button" className="wls-canvas-btn" onClick={onClear}>
              {t('toolbar.clear')}
            </button>
            <button
              type="button"
              className="wls-canvas-btn"
              data-testid="open-memory-graph"
              title={t('toolbar.memoryTitle')}
              onClick={openMemoryGraph}
            >
              {t('toolbar.memory')}
            </button>
            <button
              type="button"
              className="wls-canvas-btn"
              data-testid="open-skill-market"
              title={t('toolbar.marketTitle')}
              onClick={() => {
                refreshInstalledSkills()
                setIsSkillMarketOpen(true)
              }}
            >
              {t('toolbar.market')}
            </button>
            <button
              type="button"
              className="wls-canvas-btn"
              data-testid="open-connectors"
              title={t('toolbar.connectorsTitle')}
              onClick={() => setIsConnectorPanelOpen(true)}
            >
              {t('toolbar.connectors')}
            </button>
            <button
              type="button"
              className="wls-canvas-btn"
              data-testid="open-scene-gallery"
              title={t('toolbar.scenesTitle')}
              onClick={() => setIsSceneGalleryOpen(true)}
            >
              {t('toolbar.scenes')}
            </button>
            {mcpReady && (
              <span
                className="wls-canvas-mcp-chip"
                data-testid="mcp-chip"
                title={t('toolbar.mcpReadyTitle')}
              >
                {t('toolbar.mcpReady')}
              </span>
            )}
            <button
              type="button"
              className="wls-canvas-btn"
              data-testid="toggle-language"
              title={t('toolbar.langTitle')}
              aria-label={t('toolbar.langTitle')}
              onClick={() => setLanguage(lang === 'zh' ? 'en' : 'zh')}
            >
              🌐 {lang === 'zh' ? '中文' : 'EN'}
            </button>
            <span className="wls-canvas-save-state">{t('toolbar.savedAt', { time: savedAt })}</span>
          </div>
          <div className="wls-canvas-root">
            <Tldraw shapeUtils={[WlsNodeUtil]} onMount={handleMount}>
              <CanvasEmptyHint />
            </Tldraw>

            {/* D9 小地图（右下角；Canvas2D 自绘，点击/拖动导航） */}
            <MiniMap shapes={mini.shapes} viewport={mini.viewport} onNavigate={handleMiniNavigate} />

            {/* V1：tldraw 生产许可闸门如实提示（无 license key 的生产环境 5s 后编辑器停渲染） */}
            <TldrawLicenseNotice />

            {/* D9 项目操作提示条 */}
            {projectNotice && (
              <div className="wls-edge-toast" role="status" data-testid="project-notice">
                <span>{projectNotice}</span>
                <button
                  type="button"
                  className="wls-orch-close"
                  aria-label="关闭提示"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setProjectNotice(null)}
                >
                  ✕
                </button>
              </div>
            )}

            {/* B1：非法连线拒绝提示条（画布内顶部居中，3 秒自动消失） */}
            {edgeNotice && (
              <div className="wls-edge-toast" role="alert" data-testid="edge-notice">
                ⛔ {edgeNotice}
              </div>
            )}

            {/* D8：MCP 反向驱动提示条（Agent 操作已应用 / 被拒原因） */}
            {mcpNotice && (
              <div className="wls-edge-toast" role="status" data-testid="mcp-notice">
                <span>{mcpNotice}</span>
                <button
                  type="button"
                  className="wls-orch-close"
                  aria-label="关闭提示"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setMcpNotice(null)}
                >
                  ✕
                </button>
              </div>
            )}

            {/* S1：导出 Skill 提示条（3 秒自动消失） */}
            {skillNotice && (
              <div className="wls-edge-toast" role="status" data-testid="skill-notice">
                {skillNotice}
              </div>
            )}

            {/* B6：编排提示条（busy 反馈 / 结果 + 一键撤销；✕ 手动关闭，不自动消失） */}
            {orchestrationNoticeOpen && orchestrationNotice && (
              <div className="wls-orch-toast" role="status" data-testid="orchestration-notice">
                <span>{orchestrationNotice}</span>
                {hasUndoable && !orchestrating && (
                    <button
                      type="button"
                      className="wls-orch-undo"
                      data-testid="orchestration-undo"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={handleOrchestrationUndo}
                    >
                      {t('orch.undo')}
                    </button>
                  )}
                <button
                  type="button"
                  className="wls-orch-close"
                  aria-label="关闭提示"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={closeOrchestrationNotice}
                >
                  ✕
                </button>
              </div>
            )}

            {/* 对话栏：对齐 Miora 图1 底部大输入卡 + 场景模板快捷入口。
                C0：一键收起为右下角小胶囊（折叠态完整暴露 tldraw 底部工具条），
                输入内容与模板 chips 状态保存在 state，折叠往返不丢。 */}
            <div
              className={`wls-chat-dock${chatCollapsed ? ' wls-chat-dock--collapsed' : ''}`}
              data-testid="chat-dock"
            >
              {chatCollapsed ? (
                <button
                  type="button"
                  className="wls-chat-collapse-pill"
                  data-testid="chat-expand"
                  aria-label={t('chat.expand')}
                  title={t('chat.expand')}
                  onClick={() => {
                    setChatCollapsed(false)
                    chatInputRef.current?.focus()
                  }}
                >
                  {t('chat.expand')}
                </button>
              ) : (
                <>
                  <div className="wls-chat-bar">
                    <input
                      ref={chatInputRef}
                      className="wls-chat-input"
                      value={chatDraft}
                      maxLength={500}
                      placeholder={orchestrating ? t('chat.placeholderBusy') : t('chat.placeholder')}
                      aria-label={t('chat.aria')}
                      onChange={(e) => setChatDraft(e.target.value)}
                      onKeyDown={onChatKeyDown}
                    />
                    <button
                      type="button"
                      className="wls-chat-send"
                      disabled={orchestrating}
                      onClick={() => void onChatSend()}
                    >
                      {orchestrating ? t('chat.sendBusy') : t('chat.send')}
                    </button>
                    <button
                      type="button"
                      className="wls-chat-collapse"
                      data-testid="chat-collapse"
                      aria-label={t('chat.collapse')}
                      title={t('chat.collapseTitle')}
                      onClick={() => setChatCollapsed(true)}
                    >
                      ▾
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
                        {tpl.icon} {templateLabel(lang, tpl.id)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* E1 记忆图谱全屏覆盖层（视图内部暗色主题，退出后画布浅色基调零污染） */}
      {isMemoryGraphOpen && (
        <MemoryGraphView
          onClose={() => setIsMemoryGraphOpen(false)}
          thumbs={memoryThumbs}
        />
      )}

      {/* E2 Skill 市场全屏覆盖层（图5 浅色主题；布置复用 S2 applySkillImport 链路） */}
      {isSkillMarketOpen && (
        <SkillMarketView
          onClose={() => setIsSkillMarketOpen(false)}
          onDeploy={(manifest) => {
            setIsSkillMarketOpen(false)
            applySkillImport(manifest)
          }}
          onChanged={refreshInstalledSkills}
        />
      )}

      {/* D5 开场层（图1 形态）：首次进入叠加；关闭后折叠为底部对话栏 */}
      {isOnboardingOpen && (
        <CanvasOnboardingView
          onClose={closeOnboarding}
          onSubmit={handleOnboardingSubmit}
          onOpenConnectors={() => {
            closeOnboarding()
            setIsConnectorPanelOpen(true)
          }}
          onOpenScenes={() => {
            closeOnboarding()
            setIsSceneGalleryOpen(true)
          }}
        />
      )}

      {/* D4 连接器面板全屏覆盖层（图6 浅色主题；协议层 mock，卡片如实标注未接入） */}
      {isConnectorPanelOpen && <ConnectorPanelView onClose={() => setIsConnectorPanelOpen(false)} />}

      {/* D6 创作场景画廊全屏覆盖层（图8 浅色主题；卡片预填/一键编排复用 B6 链路） */}
      {isSceneGalleryOpen && (
        <SceneGalleryView
          onClose={() => setIsSceneGalleryOpen(false)}
          onPrefill={handleScenePrefill}
          onOrchestrate={handleSceneOrchestrate}
        />
      )}

      {/* D1 3D 运镜台全屏页（图7；R3F 视口在 Studio 内 React.lazy 懒加载，主包不含 three） */}
      {stage3dTarget && (
        <Stage3DStudio
          payload={stage3dTarget.payload}
          onChange={handleStage3DChange}
          onExportFrames={handleStage3DExportFrames}
          onBack={() => setStage3dTarget(null)}
        />
      )}
    </div>
  )
}

/** D9 小地图状态比较（1px 容差去重，避免每 300ms 无谓重渲染） */
function miniEqual(
  a: { shapes: MiniRect[]; viewport: MiniRect },
  b: { shapes: MiniRect[]; viewport: MiniRect }
): boolean {
  if (a.shapes.length !== b.shapes.length) return false
  const eq = (p: MiniRect, q: MiniRect) =>
    Math.abs(p.x - q.x) < 1 && Math.abs(p.y - q.y) < 1 && Math.abs(p.w - q.w) < 1 && Math.abs(p.h - q.h) < 1
  if (!eq(a.viewport, b.viewport)) return false
  for (let i = 0; i < a.shapes.length; i++) if (!eq(a.shapes[i], b.shapes[i])) return false
  return true
}

/** 画布内诚实标注条（tldraw 左上菜单下方，单一信息位） */
function CanvasEmptyHint() {
  const t = useT()
  return (
    <div className="wls-canvas-hint" dir="ltr">
      {t('canvas.emptyHint')}
    </div>
  )
}
