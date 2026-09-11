import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STAGE3D_OBJECT_MAX,
  STAGE3D_PALETTE,
  createDefaultCharacterPayload,
  createPrimitivePayload,
  createStage3DCameraId,
  type Stage3DCamera,
  type Stage3DMetaPayload,
  type Stage3DObject,
} from '../../canvas/stage3dMeta.ts'
import {
  STAGE3D_POSE_LABELS,
  type Stage3DPoseId,
} from '../../canvas/stage3dPose.ts'
import { BUILTIN_CHARACTER_MODEL_URL } from '../../canvas/stage3dAssets.ts'
import { STAGE3D_ANIM_PRESETS } from '../../canvas/stage3dAnim.ts'
import {
  STAGE3D_SCENE_PRESETS,
  applyScenePreset,
  type Stage3DScenePresetId,
} from '../../canvas/stage3dScenes.ts'
import {
  keyframesDuration,
  normalizeKeyframes,
  sampleCameraPose,
  type Stage3DKeyframe,
} from '../../canvas/stage3dKeyframes.ts'
import {
  STAGE3D_SHOT_PLAN_MAX,
  buildCameraFrame,
  buildStage3DFrameSequence,
  type Stage3DCameraFrame,
  type Stage3DFrameSequence,
} from '../../canvas/stage3dFrames.ts'
import { getAssetObjectUrl, putBlobAsset, putDataUrlAsset } from '../../persist/assetStore.ts'
import './stage3d.css'

/**
 * D1 3D 运镜台全屏页（CANVAS_PLAN.md §9 D1，图7 1:1）。
 *
 * - UI 层全部普通 DOM（React 状态驱动），R3F 视口经 React.lazy 懒加载
 *   （Stage3DViewport 独立 chunk，主包不含 three）；
 * - 交互双向绑定：gizmo 拖拽 → 右栏数值实时回写；右栏改值 → 视口实时变化；
 * - 诚实标注：「摆台不耗积分 · 0 灵感币 · 全程本地渲染」；自定义模型常驻标注
 *   「模型文件由用户自行获取，许可随用户自负」；
 * - 无 WebGL 环境整体灰态诚实降级（不白屏）。
 */

type Props = {
  payload: Stage3DMetaPayload
  /** 摆台数据变更（Studio 内 300ms debounce，返回画布时 flush） */
  onChange(payload: Stage3DMetaPayload): void
  /**
   * D3：导出机位帧序列（渲染帧入 IndexedDB → idbref）→ 写回节点 meta.stage3dFrames。
   * 随序列一并回传当前摆台数据，调用方一次 updateShape 原子写入（避免 debounce 竞态）。
   */
  onExportFrames(sequence: Stage3DFrameSequence, payload: Stage3DMetaPayload): void
  onBack(): void
}

type ToolKey = 'move' | 'select'

/** R3F 视口懒加载（模块级创建，避免渲染期建组件；three 系依赖独立 chunk 不进主包） */
const LazyViewport = React.lazy(() => import('./Stage3DViewport.tsx'))

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export const Stage3DStudio: React.FC<Props> = ({ payload, onChange, onExportFrames, onBack }) => {
  const [objects, setObjects] = useState<Stage3DObject[]>(payload.objects)
  const [cameras, setCameras] = useState<Stage3DCamera[]>(payload.cameras)
  const [env, setEnv] = useState<Stage3DMetaPayload['env']>(payload.env)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [tool, setTool] = useState<ToolKey>('move')
  const [tab, setTab] = useState<'basic' | 'pose'>('basic')
  // D2 关键帧播放（预览态：playhead 由视口 useFrame 回写；结束信号 -1）
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [sceneSearch, setSceneSearch] = useState('')
  const [scaleLock, setScaleLock] = useState(true)
  const [modelUrlByRef, setModelUrlByRef] = useState<Record<string, string>>({})
  const [panoramaUrl, setPanoramaUrl] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  // D3：机位帧渲染导出进行中（渲染 + IndexedDB 存档期间禁用按钮）
  const [busyExport, setBusyExport] = useState(false)
  const [webglOk] = useState(detectWebGL)
  const objectUrlRef = useRef<string[]>([])
  const controlsRef = useRef<{ reset: () => void; getCameraState?: () => { position: [number, number, number]; target: [number, number, number]; fov: number }; flyTo?: (camera: { position: [number, number, number]; target: [number, number, number]; fov: number }) => void; captureFrame?: (pose: { position: [number, number, number]; target: [number, number, number]; fov: number }) => string | null } | null>(null)
  const modelInputRef = useRef<HTMLInputElement>(null)
  const panoramaInputRef = useRef<HTMLInputElement>(null)

  const flush = useCallback(
    (next: { objects: Stage3DObject[]; cameras: Stage3DCamera[]; env: Stage3DMetaPayload['env'] }) => {
      onChange({ objects: next.objects, cameras: next.cameras, env: next.env })
    },
    [onChange]
  )

  // 变更 debounce 落盘（打字/拖拽不逐帧写 shape，返回画布前 flush）
  const pendingRef = useRef<Stage3DMetaPayload | null>(null)
  const timerRef = useRef<number | null>(null)
  const scheduleFlush = useCallback(
    (next: Stage3DMetaPayload) => {
      pendingRef.current = next
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (pendingRef.current) {
          flush(pendingRef.current)
          pendingRef.current = null
        }
      }, 300)
    },
    [flush]
  )

  // 返回画布前 flush（保证 F5 恢复一致）
  const handleBack = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    if (pendingRef.current) {
      flush(pendingRef.current)
      pendingRef.current = null
    }
    onBack()
  }, [flush, onBack])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      for (const url of objectUrlRef.current) URL.revokeObjectURL(url)
      objectUrlRef.current = []
    }
  }, [])

  // idbref 水合（自定义模型 / 全景图 → objectURL）
  useEffect(() => {
    let cancelled = false
    const next: Record<string, string> = {}
    const tasks: Array<Promise<void>> = []
    for (const o of payload.objects) {
      if (!o.modelRef || modelUrlByRef[o.modelRef]) continue
      const ref = o.modelRef
      tasks.push(
        getAssetObjectUrl(ref.replace('idbref://', '')).then((url) => {
          if (url) {
            next[ref] = url
            objectUrlRef.current.push(url)
          }
        })
      )
    }
    void Promise.all(tasks).then(() => {
      if (!cancelled && Object.keys(next).length > 0) {
        setModelUrlByRef((prev) => ({ ...prev, ...next }))
      }
    })
    if (payload.env.panoramaRef && !panoramaUrl) {
      const ref = payload.env.panoramaRef
      const direct = ref.startsWith('http')
      if (direct) {
        // oxlint-disable-next-line set-state-in-effect -- http 直链无异步水合，同步赋值即终值
        setPanoramaUrl(ref)
      } else {
        void getAssetObjectUrl(ref.replace('idbref://', '')).then((url) => {
          if (!cancelled && url) {
            objectUrlRef.current.push(url)
            setPanoramaUrl(url)
          }
        })
      }
    }
    return () => {
      cancelled = true
    }
  }, [payload, modelUrlByRef, panoramaUrl])

  const commit = useCallback(
    (next: { objects?: Stage3DObject[]; cameras?: Stage3DCamera[]; env?: Stage3DMetaPayload['env'] }) => {
      const merged = {
        objects: next.objects ?? objects,
        cameras: next.cameras ?? cameras,
        env: next.env ?? env,
      }
      setObjects(merged.objects)
      setCameras(merged.cameras)
      setEnv(merged.env)
      scheduleFlush(merged)
    },
    [objects, cameras, env, scheduleFlush]
  )

  const selected = useMemo(() => objects.find((o) => o.id === selectedId) ?? null, [objects, selectedId])

  const addObject = useCallback(
    (make: () => Stage3DObject) => {
      if (objects.length >= STAGE3D_OBJECT_MAX) {
        setNotice({ kind: 'err', text: `摆台对象已达上限（${STAGE3D_OBJECT_MAX} 个）` })
        return
      }
      const obj = make()
      commit({ objects: [...objects, obj] })
      setSelectedId(obj.id)
      setTool('move')
    },
    [objects, commit]
  )

  const handleAddCharacter = useCallback(() => {
    addObject(() => {
      const base = createDefaultCharacterPayload(`素体角色 ${objects.length + 1}`)
      // 多个角色横向排开，避免重叠遮挡点击
      return { ...base, position: [objects.length * 1.6, 0, 0] as [number, number, number] }
    })
  }, [addObject, objects.length])

  const handleAddPrimitive = useCallback(
    (type: 'box' | 'cylinder' | 'sphere') => {
      addObject(() => {
        const label = type === 'box' ? '方块' : type === 'cylinder' ? '圆柱' : '球体'
        return createPrimitivePayload(type, `${label} ${objects.filter((o) => o.type !== 'character').length + 1}`, [
          1.5 + objects.length * 1.2,
          type === 'sphere' ? 0.5 : 0.4,
          0,
        ])
      })
    },
    [addObject, objects]
  )

  const handleAddCamera = useCallback(() => {
    const captured = controlsRef.current?.getCameraState?.()
    const cam: Stage3DCamera = {
      id: createStage3DCameraId(),
      name: `机位 ${cameras.length + 1}`,
      position: captured?.position ?? [5, 3.2, 7],
      target: captured?.target ?? [0, 0.9, 0],
      fov: Math.round(captured?.fov ?? 45),
      keyframes: [],
    }
    commit({ cameras: [...cameras, cam] })
    setNotice({ kind: 'ok', text: `✓ 已新增「${cam.name}」（导演视角参数已捕捉）· 点击左栏机位可飞至该视角` })
  }, [cameras, commit])

  /** D2：飞至机位视角（平滑飞行），并选中该机位进入编辑态 */
  const selectedCamera = useMemo(
    () => cameras.find((c) => c.id === selectedCameraId) ?? null,
    [cameras, selectedCameraId]
  )
  const handleFlyToCamera = useCallback(
    (cam: Stage3DCamera) => {
      setSelectedId(null)
      setSelectedCameraId(cam.id)
      controlsRef.current?.flyTo?.({ position: cam.position, target: cam.target, fov: cam.fov })
    },
    [controlsRef]
  )
  const updateCamera = useCallback(
    (id: string, patch: Partial<Stage3DCamera>) => {
      commit({ cameras: cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
    },
    [cameras, commit]
  )
  const handleDeleteCamera = useCallback(
    (id: string) => {
      commit({ cameras: cameras.filter((c) => c.id !== id) })
      if (selectedCameraId === id) setSelectedCameraId(null)
      setNotice({ kind: 'ok', text: '✓ 机位已删除（含其关键帧轨迹）' })
    },
    [cameras, commit, selectedCameraId]
  )

  /** D2 关键帧：在播放头位置（或末帧 +1000ms）插入当前导演视角快照 */
  const handleRecordKeyframe = useCallback(() => {
    if (!selectedCamera) return
    const captured = controlsRef.current?.getCameraState?.()
    if (!captured) return
    const kfs = normalizeKeyframes(selectedCamera.keyframes ?? [])
    const lastT = kfs.length > 0 ? kfs[kfs.length - 1].t : 0
    const t = playhead > 0 && playhead > lastT ? Math.round(playhead) : lastT + 1000
    if (kfs.length >= 60) {
      setNotice({ kind: 'err', text: '关键帧已达上限（60 帧）' })
      return
    }
    const next: Stage3DKeyframe = {
      t,
      position: captured.position,
      target: captured.target,
      fov: Math.round(captured.fov),
    }
    updateCamera(selectedCamera.id, { keyframes: normalizeKeyframes([...kfs, next]) })
    setPlayhead(t)
    setNotice({ kind: 'ok', text: `✓ 已在 ${t}ms 记录关键帧（当前导演视角快照 · 结构化轨迹入库）` })
  }, [selectedCamera, playhead, updateCamera])

  const handleClearKeyframes = useCallback(() => {
    if (!selectedCamera) return
    updateCamera(selectedCamera.id, { keyframes: [] })
    setPlayhead(0)
    setNotice({ kind: 'ok', text: '✓ 关键帧轨迹已清空' })
  }, [selectedCamera, updateCamera])

  const handleTogglePlay = useCallback(() => {
    if (!selectedCamera) return
    const kfs = selectedCamera.keyframes ?? []
    if (kfs.length < 2) {
      setNotice({ kind: 'err', text: '播放需要至少 2 个关键帧（用「+ 录制关键帧」添加）' })
      return
    }
    setPlaying((v) => !v)
  }, [selectedCamera])

  const updateObject = useCallback(
    (id: string, patch: Partial<Stage3DObject>) => {
      commit({
        objects: objects.map((o) => {
          if (o.id !== id) return o
          // D7：patch 中显式 undefined = 删除该键（tldraw T.jsonValue 不接受 undefined 值，
          // 写 meta 时会抛 ValidationError 崩 shape 渲染——必须整键删除而非置 undefined）
          const next: Record<string, unknown> = { ...o }
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete next[k]
            else next[k] = v
          }
          return next as Stage3DObject
        }),
      })
    },
    [objects, commit]
  )

  /** D7：应用场景预设（替换几何体，保留素体角色；写 env.scenePreset 供 UI 高亮） */
  const handleApplyScene = useCallback(
    (presetId: Stage3DScenePresetId) => {
      const r = applyScenePreset(objects, presetId)
      if (!r.ok) {
        setNotice({ kind: 'err', text: `⛔ ${r.reason}` })
        return
      }
      commit({ objects: r.objects, env: { ...env, scenePreset: presetId } })
      setSelectedId(null)
      const label = STAGE3D_SCENE_PRESETS.find((p) => p.id === presetId)?.label ?? presetId
      setNotice({
        kind: 'ok',
        text: `✓ 已应用场景「${label}」：${r.added} 个 primitive 布景（角色已保留 · 预演布景非成片）`,
      })
    },
    [objects, env, commit]
  )

  /** D7：动作预设播放/停止（undefined = 删除键，停止播放并恢复姿势叠加） */
  const handleToggleAnim = useCallback(
    (objectId: string, animId: Stage3DObject['anim']) => {
      updateObject(objectId, { anim: animId })
      const label = STAGE3D_ANIM_PRESETS.find((a) => a.id === animId)?.label
      setNotice(
        animId
          ? { kind: 'ok', text: `▶ 正在播放「${label}」（预演动作 · 非成片；播放期间姿势叠加暂停）` }
          : { kind: 'ok', text: '⏹ 已停止动作，恢复所选姿势' }
      )
    },
    [updateObject]
  )

  // 缩放锁联动：锁定时改任一轴，其余两轴等比（比例 = new/old，old≈0 时按 1 处理）
  const handleScaleChange = useCallback(
    (axis: 0 | 1 | 2, value: number) => {
      if (!selected) return
      const next = [...selected.scale] as [number, number, number]
      const old = selected.scale[axis] || 1
      next[axis] = value
      if (scaleLock && old !== 0) {
        const k = value / old
        for (let i = 0; i < 3; i++) {
          if (i !== axis) next[i] = Math.round(selected.scale[i] * k * 100) / 100
        }
      }
      updateObject(selected.id, { scale: next })
    },
    [selected, scaleLock, updateObject]
  )

  const handleImportModel = useCallback(
    async (file: File) => {
      try {
        if (!/\.(glb|gltf)$/i.test(file.name)) {
          setNotice({ kind: 'err', text: '仅支持 .glb / .gltf 模型文件' })
          return
        }
        if (objects.length >= STAGE3D_OBJECT_MAX) {
          setNotice({ kind: 'err', text: `摆台对象已达上限（${STAGE3D_OBJECT_MAX} 个）` })
          return
        }
        const buf = await file.arrayBuffer()
        const ref = await putBlobAsset(`stage3d_model_${Date.now().toString(36)}`, new Blob([buf], { type: 'model/gltf-binary' }))
        if (!ref) {
          setNotice({ kind: 'err', text: '模型存档失败（IndexedDB 不可用）' })
          return
        }
        addObject(() => {
          const base = createDefaultCharacterPayload(file.name.replace(/\.(glb|gltf)$/i, '').slice(0, 60))
          return { ...base, modelRef: ref, position: [objects.length * 1.6, 0, 0] as [number, number, number] }
        })
        setNotice({ kind: 'ok', text: '✓ 自定义模型已加载（本地解析，不上传不落第三方；许可随用户自负）' })
      } catch (err) {
        setNotice({
          kind: 'err',
          text: `模型解析失败：${err instanceof Error ? err.message : '文件不是合法的 glTF 模型'}`,
        })
      }
    },
    [addObject, objects.length]
  )

  const handleImportPanorama = useCallback(
    async (file: File) => {
      try {
        if (!file.type.startsWith('image/')) {
          setNotice({ kind: 'err', text: '全景背景仅支持图片文件（建议 2:1 equirectangular 全景图）' })
          return
        }
        const ref = await putBlobAsset(`stage3d_pano_${Date.now().toString(36)}`, file)
        if (!ref) {
          setNotice({ kind: 'err', text: '全景图存档失败（IndexedDB 不可用）' })
          return
        }
        commit({ env: { ...env, panoramaRef: ref } })
        setNotice({ kind: 'ok', text: '✓ 全景背景已应用（本地渲染 · 非真实环境光照）' })
      } catch (err) {
        setNotice({
          kind: 'err',
          text: `全景图解析失败：${err instanceof Error ? err.message : '未知错误'}`,
        })
      }
    },
    [commit, env]
  )

  /**
   * D3：渲染机位首/尾帧（轨迹端点）并存入 IndexedDB（idbref）→ 组装帧记录。
   * 返回 null 表示失败（已 setNotice 如实说明）。无 WebGL / 视口未就绪时拒绝。
   */
  const renderCameraFrames = useCallback(
    async (cams: Stage3DCamera[]): Promise<Stage3DCameraFrame[] | null> => {
      const capture = controlsRef.current?.captureFrame
      if (!capture) {
        setNotice({ kind: 'err', text: '3D 视口尚未就绪或当前环境无 WebGL，无法渲染机位帧' })
        return null
      }
      const frames: Stage3DCameraFrame[] = []
      for (const cam of cams) {
        const kfs = normalizeKeyframes(cam.keyframes ?? [])
        const fallback = { position: cam.position, target: cam.target, fov: cam.fov }
        const firstPose = kfs.length > 0 ? sampleCameraPose(kfs, 0) ?? fallback : fallback
        const lastPose = kfs.length > 0 ? sampleCameraPose(kfs, keyframesDuration(kfs)) ?? firstPose : firstPose
        const firstData = capture(firstPose)
        const lastData = capture(lastPose)
        if (!firstData || !lastData) {
          setNotice({ kind: 'err', text: `「${cam.name}」帧渲染失败（WebGL 上下文不可用）` })
          return null
        }
        const firstRef = await putDataUrlAsset(`stage3d_frame_${cam.id}_f`, firstData)
        const lastRef = await putDataUrlAsset(`stage3d_frame_${cam.id}_l`, lastData)
        if (!firstRef || !lastRef) {
          setNotice({ kind: 'err', text: '帧图存档失败（IndexedDB 不可用），未写入节点' })
          return null
        }
        frames.push(buildCameraFrame(cam, firstRef, lastRef))
      }
      return frames
    },
    [controlsRef]
  )

  /** D3：导出机位帧序列（direct = 单机位执导帧 → generate；plan = 全部机位 → storyboard） */
  const exportFrames = useCallback(
    async (cams: Stage3DCamera[], mode: 'direct' | 'plan') => {
      if (cams.length === 0) {
        setNotice({ kind: 'err', text: '没有可导出的机位：请先在「＋ 新增机位」添加机位' })
        return
      }
      if (cams.length > STAGE3D_SHOT_PLAN_MAX) {
        setNotice({
          kind: 'err',
          text: `机位数 ${cams.length} 超过自由分镜上限 ${STAGE3D_SHOT_PLAN_MAX}：请精简机位后重试（不截断不伪造）`,
        })
        return
      }
      setBusyExport(true)
      try {
        const frames = await renderCameraFrames(cams)
        if (!frames) return
        const check = buildStage3DFrameSequence(frames)
        if (!check.ok) {
          setNotice({ kind: 'err', text: check.reason })
          return
        }
        // 随序列回传当前摆台数据：调用方一次 updateShape 原子写入（规避 debounce 竞态）
        onExportFrames(check.sequence, { objects, cameras, env })
        setNotice({
          kind: 'ok',
          text:
            mode === 'direct'
              ? `✓ 已导出执导帧「${cams[0].name}」：首/尾帧入 IndexedDB（idbref）· 连到「视频生成」节点即可 3D 单镜直出`
              : `✓ 已导出分镜：${frames.length} 机位首/尾帧入 IndexedDB · 连到「分镜预演」节点即可生成自由分镜（镜数=机位数）`,
        })
      } finally {
        setBusyExport(false)
      }
    },
    [renderCameraFrames, onExportFrames, objects, cameras, env]
  )

  const handleExportDirectFrames = useCallback(() => {
    const target = selectedCamera ?? cameras[0]
    if (!target) {
      setNotice({ kind: 'err', text: '请先添加机位（顶中「＋ 新增机位」）' })
      return
    }
    void exportFrames([target], 'direct')
  }, [selectedCamera, cameras, exportFrames])

  const handleExportShotPlan = useCallback(() => {
    void exportFrames(cameras, 'plan')
  }, [cameras, exportFrames])

  const filteredObjects = useMemo(() => {
    const q = sceneSearch.trim().toLowerCase()
    return q ? objects.filter((o) => o.name.toLowerCase().includes(q)) : objects
  }, [objects, sceneSearch])

  return (
    <div className="s3-root" data-testid="stage3d-studio" role="dialog" aria-label="3D 运镜台">
      {/* 左栏（可折叠） */}
      <aside className={`s3-left${leftCollapsed ? ' collapsed' : ''}`} data-testid="s3-left">
        <div className="s3-left-head">
          <button type="button" className="s3-back" data-testid="s3-back" onClick={handleBack}>
            ← 3D 运镜台
          </button>
          <button
            type="button"
            className="s3-collapse"
            aria-label={leftCollapsed ? '展开左栏' : '折叠左栏'}
            data-testid="s3-left-toggle"
            onClick={() => setLeftCollapsed((v) => !v)}
          >
            {leftCollapsed ? '»' : '«'}
          </button>
        </div>
        {!leftCollapsed && (
          <>
            <div className="s3-left-section">
              <input
                type="text"
                className="s3-search"
                placeholder="搜索场景对象…"
                aria-label="搜索场景对象"
                value={sceneSearch}
                onChange={(e) => setSceneSearch(e.target.value)}
              />
              <div className="s3-left-title">场景</div>
              <div className="s3-left-static">默认场景</div>
              <div className="s3-left-title">角色树 / 对象</div>
              <div className="s3-object-tree" data-testid="s3-object-tree">
                {filteredObjects.length === 0 ? (
                  <div className="s3-tree-empty">暂无对象（底部工具条添加）</div>
                ) : (
                  filteredObjects.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`s3-tree-item${o.id === selectedId ? ' active' : ''}`}
                      data-testid="s3-tree-item"
                      onClick={() => {
                        setSelectedId(o.id)
                        setSelectedCameraId(null)
                        setTool('move')
                      }}
                    >
                      <span className="s3-tree-dot" style={{ background: o.color }} aria-hidden />
                      {o.name}
                    </button>
                  ))
                )}
              </div>
              <div className="s3-left-title">模型</div>
              <div className="s3-model-actions">
                <button type="button" className="s3-model-btn" data-testid="s3-add-character" onClick={handleAddCharacter}>
                  👤 加人物
                </button>
                <button type="button" className="s3-model-btn" data-testid="s3-import-model" onClick={() => modelInputRef.current?.click()}>
                  📁 导入自定义模型
                </button>
                <input
                  ref={modelInputRef}
                  type="file"
                  accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                  hidden
                  aria-label="选择自定义模型文件（.glb / .gltf）"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void handleImportModel(f)
                    e.target.value = ''
                  }}
                />
                <small className="s3-model-notice" data-testid="s3-model-notice">
                  模型文件由用户自行获取，许可随用户自负（本地解析，不上传）
                </small>
              </div>
              <div className="s3-left-title">相机机位</div>
              <div className="s3-camera-list" data-testid="s3-camera-list">
                {cameras.length === 0 ? (
                  <div className="s3-tree-empty">无机位（顶中「＋ 新增机位」）</div>
                ) : (
                  cameras.map((c) => (
                    <div key={c.id} className="s3-camera-row">
                      <button
                        type="button"
                        className={`s3-tree-item${c.id === selectedCameraId ? ' active' : ''}`}
                        data-testid="s3-camera-item"
                        title={`点击飞至「${c.name}」视角（平滑飞行）`}
                        onClick={() => handleFlyToCamera(c)}
                      >
                        <span className="s3-tree-dot" style={{ background: '#7ec8e3' }} aria-hidden />
                        {c.name} · FOV {c.fov}°
                      </button>
                      <button
                        type="button"
                        className="s3-camera-del"
                        aria-label={`删除 ${c.name}`}
                        title={`删除「${c.name}」`}
                        onClick={() => handleDeleteCamera(c.id)}
                      >
                        🗑
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="s3-left-title">环境</div>
              <button type="button" className="s3-model-btn" data-testid="s3-import-panorama" onClick={() => panoramaInputRef.current?.click()}>
                🌅 导入全景背景
              </button>
              <input
                ref={panoramaInputRef}
                type="file"
                accept="image/*"
                hidden
                aria-label="选择全景背景图（equirectangular）"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleImportPanorama(f)
                  e.target.value = ''
                }}
              />
              {/* D7 场景预设：六套程序化 primitive 布景（代码生成零外部资产） */}
              <div className="s3-left-title">场景预设</div>
              <div className="s3-scenes" data-testid="s3-scenes">
                {STAGE3D_SCENE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`s3-scene-btn${env.scenePreset === p.id ? ' active' : ''}`}
                    data-testid={`s3-scene-${p.id}`}
                    title={`${p.hint}（替换几何体，保留素体角色）`}
                    onClick={() => handleApplyScene(p.id)}
                  >
                    🏗️ {p.label}
                  </button>
                ))}
                <small className="s3-model-notice" data-testid="s3-scene-notice">
                  程序化 primitive 布景（零外部资产）· 应用替换几何体、保留角色 · 预演布景非成片
                </small>
              </div>

              {/* D3 出片衔接：机位帧序列导出（B 口 → generate / D 口 → storyboard） */}
              <div className="s3-left-title">出片衔接</div>
              <div className="s3-export">
                <button
                  type="button"
                  className="s3-model-btn"
                  data-testid="s3-export-frames"
                  title="渲染选中机位（未选中则取第一个）首/尾帧，导出到「视频生成」节点做 3D 单镜直出"
                  disabled={busyExport || !webglOk || cameras.length === 0}
                  onClick={handleExportDirectFrames}
                >
                  📤 导出执导帧（单机位 → 视频生成）
                </button>
                <button
                  type="button"
                  className="s3-model-btn"
                  data-testid="s3-export-shotplan"
                  title="渲染全部机位首/尾帧，导出到「分镜预演」节点生成自由镜数分镜（镜数=机位数）"
                  disabled={busyExport || !webglOk || cameras.length === 0}
                  onClick={handleExportShotPlan}
                >
                  🎞️ 导出分镜（全部机位 → 分镜预演）
                </button>
                <small className="s3-model-notice" data-testid="s3-export-notice">
                  {busyExport
                    ? '渲染机位帧中…'
                    : `渲染帧落 IndexedDB（idbref）· 运镜轨迹结构化随帧入库 · 自由分镜镜数=机位数（≤${STAGE3D_SHOT_PLAN_MAX}）`}
                </small>
              </div>
            </div>
          </>
        )}
      </aside>

      {/* 主区 */}
      <div className="s3-main">
        {/* 顶中：导演视角 + 新增机位 */}
        <div className="s3-top-center">
          <span className="s3-view-pill" data-testid="s3-current-view">
            🎬 导演视角
          </span>
          <button type="button" className="s3-btn" data-testid="s3-add-camera" onClick={handleAddCamera}>
            ＋ 新增机位
          </button>
        </div>
        {/* 右上：重置视角 */}
        <div className="s3-top-right">
          <button type="button" className="s3-btn" data-testid="s3-reset-view" onClick={() => controlsRef.current?.reset()}>
            重置视角
          </button>
        </div>

        {/* 视口 */}
        <div className="s3-viewport" data-testid="s3-viewport">
          {webglOk ? (
            <Suspense
              fallback={
                <div className="s3-viewport-loading" data-testid="s3-viewport-loading">
                  正在加载 3D 引擎…
                </div>
              }
            >
              <LazyViewport
                objects={objects}
                builtinModelUrl={BUILTIN_CHARACTER_MODEL_URL}
                modelUrlByRef={modelUrlByRef}
                panoramaUrl={panoramaUrl}
                selectedId={selectedId}
                tool={tool}
                onAssetError={(msg) => setNotice({ kind: 'err', text: msg })}
                onSelect={(id) => {
                  setSelectedId(id)
                  if (id) setSelectedCameraId(null)
                }}
                onTransform={(id, t) => updateObject(id, t)}
                controlsRef={controlsRef}
                playback={
                  selectedCamera
                    ? {
                        kfs: selectedCamera.keyframes ?? [],
                        playing,
                        onPlayhead: (t) => {
                          if (t < 0) {
                            setPlaying(false)
                            setPlayhead(0)
                          } else {
                            setPlayhead(t)
                          }
                        },
                      }
                    : null
                }
              />
            </Suspense>
          ) : (
            <div className="s3-viewport-fallback" data-testid="s3-webgl-fallback">
              <span aria-hidden>🚫</span>
              <p>当前浏览器不支持 WebGL，3D 运镜台无法渲染</p>
              <small>摆台数据已保留；请更换支持 WebGL 的浏览器后重试（诚实降级，不白屏）</small>
            </div>
          )}
        </div>

        {/* 底部中央工具条（图7：移动默认选中态） */}
        <div className="s3-toolbar" data-testid="s3-toolbar">
          <button
            type="button"
            className={`s3-tool${tool === 'move' ? ' active' : ''}`}
            data-testid="s3-tool-move"
            title="移动 / 编辑选中对象"
            onClick={() => setTool('move')}
          >
            ✥ 移动
          </button>
          <button type="button" className="s3-tool" data-testid="s3-tool-character" title="添加素体人物" onClick={handleAddCharacter}>
            👤 加人物
          </button>
          <button type="button" className="s3-tool" data-testid="s3-tool-box" title="添加方块占位" onClick={() => handleAddPrimitive('box')}>
            ⬛ 方块
          </button>
          <button type="button" className="s3-tool" data-testid="s3-tool-cylinder" title="添加圆柱占位" onClick={() => handleAddPrimitive('cylinder')}>
            ⬤ 圆柱
          </button>
          <button type="button" className="s3-tool" data-testid="s3-tool-sphere" title="添加球体占位" onClick={() => handleAddPrimitive('sphere')}>
            ● 球体
          </button>
          <button
            type="button"
            className={`s3-tool${tool === 'select' ? ' active' : ''}`}
            data-testid="s3-tool-select"
            title="框选 / 仅拾取模式"
            onClick={() => setTool('select')}
          >
            ▣ 框选
          </button>
        </div>

        {/* 诚实标注 */}
        <div className="s3-honest-tag" data-testid="s3-honest-tag">
          摆台不耗积分 · 0 灵感币 · 全程本地渲染
        </div>
      </div>

      {/* 右属性面板 */}
      <aside className="s3-right" data-testid="s3-right">
        {selectedCamera ? (
          <div className="s3-prop-body" data-testid="s3-camera-panel">
            <div className="s3-prop-row">
              <label htmlFor="s3-cam-name">机位名称</label>
              <input
                id="s3-cam-name"
                type="text"
                className="s3-input"
                value={selectedCamera.name}
                maxLength={60}
                onChange={(e) => updateCamera(selectedCamera.id, { name: e.target.value })}
              />
            </div>
            <div className="s3-prop-row">
              <label htmlFor="s3-cam-fov">视场角 FOV（度）</label>
              <input
                id="s3-cam-fov"
                type="number"
                min={20}
                max={120}
                className="s3-input"
                value={selectedCamera.fov}
                onChange={(e) => updateCamera(selectedCamera.id, { fov: Math.max(20, Math.min(120, Number(e.target.value) || 45)) })}
              />
            </div>
            {/* D5 遗留小修：FOV/位置编辑只写入机位数据，需飞行到该机位才在视口生效 */}
            <small className="s3-prop-hint">
              编辑后需点击左栏机位「飞行」生效；当前取景可用「📌 设为当前导演视角」反向写入
            </small>
            <button
              type="button"
              className="s3-model-btn"
              data-testid="s3-cam-capture"
              title="把当前导演视角写入该机位（位置/朝向/FOV）"
              onClick={() => {
                const s = controlsRef.current?.getCameraState?.()
                if (s) {
                  updateCamera(selectedCamera.id, { position: s.position, target: s.target, fov: Math.round(s.fov) })
                  setNotice({ kind: 'ok', text: '✓ 机位参数已更新为当前导演视角' })
                }
              }}
            >
              📌 设为当前导演视角
            </button>

            {/* D2 关键帧时间轴（结构化轨迹从第一天入库——D3 C 升级口） */}
            <div className="s3-timeline" data-testid="s3-timeline">
              <div className="s3-left-title">运镜关键帧（{normalizeKeyframes(selectedCamera.keyframes ?? []).length}/60）</div>
              <div className="s3-track" data-testid="s3-track">
                <div
                  className="s3-track-progress"
                  style={{ width: `${Math.min(100, (playhead / Math.max(1, keyframesDuration(selectedCamera.keyframes ?? []))) * 100)}%` }}
                />
                {normalizeKeyframes(selectedCamera.keyframes ?? []).map((k) => (
                  <span
                    key={k.t}
                    className="s3-kf-mark"
                    title={`关键帧 ${k.t}ms`}
                    style={{ left: `${Math.min(100, (k.t / Math.max(1, keyframesDuration(selectedCamera.keyframes ?? []))) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="s3-timeline-meta">
                时长 {keyframesDuration(selectedCamera.keyframes ?? [])}ms · 播放头 {Math.max(0, playhead)}ms
              </div>
              <div className="s3-timeline-actions">
                <button type="button" className="s3-card-btn sm-primary-like" data-testid="s3-kf-record" onClick={handleRecordKeyframe}>
                  ＋ 录制关键帧
                </button>
                <button type="button" className="s3-card-btn" data-testid="s3-kf-play" onClick={handleTogglePlay}>
                  {playing ? '⏹ 停止' : '▶ 播放轨迹'}
                </button>
                <button type="button" className="s3-card-btn" data-testid="s3-kf-clear" onClick={handleClearKeyframes}>
                  🗑 清空
                </button>
              </div>
              <small className="s3-prop-hint">
                「＋ 录制关键帧」= 把当前导演视角作为快照插入时间轴；播放 = 关键帧 Catmull-Rom 平滑插值（预览不落盘）。
                轨迹为结构化数据（D3 出片衔接的升级口）。
              </small>
            </div>
          </div>
        ) : (
          <>
        <div className="s3-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'basic'} className={`s3-tab${tab === 'basic' ? ' active' : ''}`} onClick={() => setTab('basic')}>
            基础
          </button>
          <button type="button" role="tab" aria-selected={tab === 'pose'} className={`s3-tab${tab === 'pose' ? ' active' : ''}`} onClick={() => setTab('pose')}>
            姿势
          </button>
        </div>

        {tab === 'pose' ? (
          selected && selected.type === 'character' ? (
            <div className="s3-pose-body" data-testid="s3-pose-body">
              <div className="s3-pose-hint">预置姿势 = 骨骼旋转参数集（一次性应用，非动画编辑）</div>
              {(Object.keys(STAGE3D_POSE_LABELS) as Stage3DPoseId[]).map((pid) => (
                <button
                  key={pid}
                  type="button"
                  className={`s3-pose-btn${(selected.pose ?? 'tpose') === pid ? ' active' : ''}`}
                  data-testid={`s3-pose-${pid}`}
                  onClick={() => updateObject(selected.id, { pose: pid })}
                >
                  🧍 {STAGE3D_POSE_LABELS[pid]}
                </button>
              ))}
              {selected.modelRef ? (
                <small className="s3-prop-hint">
                  自定义模型：骨骼名与预置库不匹配时姿势不生效（如实跳过，不报错）
                </small>
              ) : (
                <small className="s3-prop-hint">内置素体 rig：DEF- 前缀 53 骨（Blender metarig）</small>
              )}

              {/* D7 动作预设：内置素体内嵌动画片段（three AnimationMixer，零新增依赖） */}
              <div className="s3-anim" data-testid="s3-anim">
                <div className="s3-left-title">动作预设（预演 · 非成片）</div>
                <div className="s3-anim-grid">
                  {STAGE3D_ANIM_PRESETS.map((a) => {
                    const active = selected.anim === a.id
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`s3-anim-btn${active ? ' active' : ''}`}
                        data-testid={`s3-anim-${a.id}`}
                        title={`${a.hint} · 片段 ${a.clip}`}
                        onClick={() => handleToggleAnim(selected.id, active ? undefined : a.id)}
                      >
                        {active ? '⏹' : '▶'} {a.label}
                      </button>
                    )
                  })}
                </div>
                <small className="s3-prop-hint">
                  播放内置素体内嵌动画片段（three 自带 AnimationMixer，零新增依赖）· 播放期间姿势叠加暂停
                  （动画为绝对姿态，叠加会打架）· 参考稿提到的「挥手 / 转身」在 CC0 库中无对应片段，
                  此处如实以库内真实动作替代，不伪造
                </small>
              </div>
            </div>
          ) : (
            <div className="s3-pose-locked" data-testid="s3-pose-locked">
              <span aria-hidden>🧍</span>
              <p>先选中一个素体角色</p>
              <small>姿势仅对 character 类型对象可用（几何体占位无骨骼）。</small>
            </div>
          )
        ) : selected ? (
          <div className="s3-prop-body" data-testid="s3-prop-body">
            <div className="s3-prop-row">
              <label htmlFor="s3-obj-name">名称</label>
              <input
                id="s3-obj-name"
                type="text"
                className="s3-input"
                value={selected.name}
                maxLength={60}
                onChange={(e) => updateObject(selected.id, { name: e.target.value })}
              />
            </div>

            {(
              [
                ['位置', 'position', 0.1],
                ['旋转', 'rotation', 0.05],
                ['缩放', 'scale', 0.1],
              ] as ['位置' | '旋转' | '缩放', 'position' | 'rotation' | 'scale', number][]
            ).map(([label, key, step]) => (
              <div className="s3-prop-row" key={key}>
                <label>{label}</label>
                <div className="s3-vec3">
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <label key={axis} className="s3-axis">
                      {axis}
                      <input
                        type="number"
                        step={step}
                        className="s3-input s3-input-num"
                        data-testid={`s3-${key}-${axis.toLowerCase()}`}
                        aria-label={`${label} ${axis}`}
                        value={
                          key === 'rotation'
                            ? Math.round((selected.rotation[i] * 180) / Math.PI * 10) / 10
                            : Math.round(selected[key][i] * 100) / 100
                        }
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0
                          if (key === 'position') {
                            const next = [...selected.position] as [number, number, number]
                            next[i] = v
                            updateObject(selected.id, { position: next })
                          } else if (key === 'rotation') {
                            const next = [...selected.rotation] as [number, number, number]
                            next[i] = (v * Math.PI) / 180
                            updateObject(selected.id, { rotation: next })
                          } else {
                            handleScaleChange(i as 0 | 1 | 2, v)
                          }
                        }}
                      />
                    </label>
                  ))}
                  {key === 'scale' && (
                    <button
                      type="button"
                      className={`s3-lock${scaleLock ? ' on' : ''}`}
                      data-testid="s3-scale-lock"
                      aria-pressed={scaleLock}
                      title={scaleLock ? '缩放联动已锁定（等比）' : '缩放联动已解锁'}
                      onClick={() => setScaleLock((v) => !v)}
                    >
                      {scaleLock ? '🔒' : '🔓'}
                    </button>
                  )}
                </div>
              </div>
            ))}

            <div className="s3-prop-row">
              <label>颜色</label>
              <div className="s3-palette" role="radiogroup" aria-label="对象颜色（8 色板）">
                {STAGE3D_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={selected.color === c}
                    className={`s3-swatch${selected.color === c ? ' active' : ''}`}
                    style={{ background: c }}
                    data-testid={`s3-swatch-${c.replace('#', '')}`}
                    aria-label={`颜色 ${c}`}
                    onClick={() => updateObject(selected.id, { color: c })}
                  />
                ))}
              </div>
            </div>

            {selected.type === 'character' && !selected.modelRef && (
              <small className="s3-prop-hint">内置素体：Quaternius 通用动画库角色（CC0）</small>
            )}
            {selected.type === 'character' && selected.modelRef && (
              <small className="s3-prop-hint">自定义模型（用户自备文件 · 本地加载）</small>
            )}
          </div>
        ) : (
          <div className="s3-pose-locked" data-testid="s3-prop-empty">
            <p>未选中对象</p>
            <small>点击视口对象 / 左栏对象树，或从底部工具条添加</small>
          </div>
        )}
          </>
        )}

        {notice && (
          <div className={`s3-notice ${notice.kind}`} role="status" data-testid="s3-notice">
            {notice.text}
            <button type="button" className="s3-notice-close" aria-label="关闭提示" onClick={() => setNotice(null)}>
              ✕
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
