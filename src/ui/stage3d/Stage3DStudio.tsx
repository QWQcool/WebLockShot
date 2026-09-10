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
import { getAssetObjectUrl, putBlobAsset } from '../../persist/assetStore.ts'
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

export const Stage3DStudio: React.FC<Props> = ({ payload, onChange, onBack }) => {
  const [objects, setObjects] = useState<Stage3DObject[]>(payload.objects)
  const [cameras, setCameras] = useState<Stage3DCamera[]>(payload.cameras)
  const [env, setEnv] = useState<Stage3DMetaPayload['env']>(payload.env)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<ToolKey>('move')
  const [tab, setTab] = useState<'basic' | 'pose'>('basic')
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [sceneSearch, setSceneSearch] = useState('')
  const [scaleLock, setScaleLock] = useState(true)
  const [modelUrlByRef, setModelUrlByRef] = useState<Record<string, string>>({})
  const [panoramaUrl, setPanoramaUrl] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [webglOk] = useState(detectWebGL)
  const objectUrlRef = useRef<string[]>([])
  const controlsRef = useRef<{ reset: () => void; getCameraState?: () => { position: [number, number, number]; target: [number, number, number]; fov: number } } | null>(null)
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
    }
    commit({ cameras: [...cameras, cam] })
    setNotice({ kind: 'ok', text: `✓ 已新增「${cam.name}」（导演视角参数已捕捉）· 视角切换 D2 开放` })
  }, [cameras, commit])

  const updateObject = useCallback(
    (id: string, patch: Partial<Stage3DObject>) => {
      commit({ objects: objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
    },
    [objects, commit]
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
                    <div key={c.id} className="s3-tree-item static" title={`${c.name} · FOV ${c.fov}°`}>
                      <span className="s3-tree-dot" style={{ background: '#7ec8e3' }} aria-hidden />
                      {c.name} · FOV {c.fov}°
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
                builtinModelUrl="/models/quaternius-universal-character.glb"
                modelUrlByRef={modelUrlByRef}
                panoramaUrl={panoramaUrl}
                selectedId={selectedId}
                tool={tool}
                onSelect={setSelectedId}
                onTransform={(id, t) => updateObject(id, t)}
                controlsRef={controlsRef}
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
        <div className="s3-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'basic'} className={`s3-tab${tab === 'basic' ? ' active' : ''}`} onClick={() => setTab('basic')}>
            基础
          </button>
          <button type="button" role="tab" aria-selected={tab === 'pose'} className={`s3-tab${tab === 'pose' ? ' active' : ''}`} onClick={() => setTab('pose')}>
            姿势
          </button>
        </div>

        {tab === 'pose' ? (
          <div className="s3-pose-locked" data-testid="s3-pose-locked">
            <span aria-hidden>🧍</span>
            <p>预置姿势切换将在 D2 开放</p>
            <small>当前版本为摆台基座：素体以默认站姿渲染；骨骼数据已就绪（53 骨）。</small>
          </div>
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
