import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Stage3DObject } from '../../canvas/stage3dMeta.ts'
import { STAGE3D_POSE_PRESETS, sanitizeBoneName } from '../../canvas/stage3dPose.ts'
import { animClipFor } from '../../canvas/stage3dAnim.ts'
import { sampleCameraPose, type Stage3DKeyframe } from '../../canvas/stage3dKeyframes.ts'

/**
 * D1 3D 运镜台 · R3F 渲染层（本组件是唯一 import three/R3F 的文件，
 * 经 React.lazy 独立 chunk 懒加载——主包不含 three，进全屏页才拉取）。
 *
 * 职责边界（实施方案 1）：只做渲染与拾取；状态全部在 Stage3DStudio（普通 DOM UI）。
 * 双向绑定：gizmo 拖拽 → onTransform 回写；props 值 → 对象 transform 受控同步。
 */

export type Stage3DViewportProps = {
  objects: Stage3DObject[]
  /** 内置素体模型地址（public/models 懒加载） */
  builtinModelUrl: string
  /** 已水合的自定义模型 blob url（idbref → objectURL 由 Studio 层完成） */
  modelUrlByRef: Record<string, string>
  /** 已水合的全景图 url（blob/http） */
  panoramaUrl: string | null
  selectedId: string | null
  /** gizmo 模式：move = 显示 TransformControls；select = 仅拾取 */
  tool: 'move' | 'select'
  onSelect(id: string | null): void
  onTransform(id: string, t: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }): void
  /** 相机控制句柄（重置视角 / 新增机位捕捉当前导演视角参数 / D2 机位飞行 / D3 帧渲染） */
  controlsRef: React.MutableRefObject<{
    reset: () => void
    getCameraState?: () => { position: [number, number, number]; target: [number, number, number]; fov: number }
    /** D2：平滑飞行至指定机位（ease-in-out，600ms） */
    flyTo?: (camera: { position: [number, number, number]; target: [number, number, number]; fov: number }) => void
    /** D3：以指定相机姿态同步渲染一帧并返回 PNG dataURL（导出机位帧序列；渲染不可用时返回 null） */
    captureFrame?: (pose: {
      position: [number, number, number]
      target: [number, number, number]
      fov: number
    }) => string | null
  } | null>
  /** D2：关键帧播放（kfs 来自选中机位；playing=true 时 useFrame 驱动导演相机） */
  playback: { kfs: Stage3DKeyframe[]; playing: boolean; onPlayhead(t: number): void } | null
}

export const DEFAULT_CHARACTER_MODEL_URL = '/models/quaternius-universal-character.glb'

const round4 = (v: number): number => Math.round(v * 10000) / 10000

export default function Stage3DViewport(props: Stage3DViewportProps) {
  return (
    <Canvas
      camera={{ position: [5, 3.2, 7], fov: 45, near: 0.1, far: 500 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      style={{ width: '100%', height: '100%', touchAction: 'none' }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <color attach="background" args={['#ffffff']} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[6, 10, 4]} intensity={1.6} />
      <directionalLight position={[-6, 4, -6]} intensity={0.5} />
      <Suspense fallback={null}>
        <SceneContent {...props} />
      </Suspense>
    </Canvas>
  )
}

function SceneContent(props: Stage3DViewportProps) {
  const orbitRef = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const objectRefs = useRef<Map<string, THREE.Object3D>>(new Map())

  // 全景背景（equirectangular）
  useEffect(() => {
    if (!props.panoramaUrl) {
      // oxlint-disable-next-line react/immutability -- three 场景背景必须命令式赋值
      scene.background = new THREE.Color('#ffffff')
      return
    }
    let disposed = false
    const loader = new THREE.TextureLoader()
    void loader.loadAsync(props.panoramaUrl).then((tex) => {
      if (disposed) return
      tex.mapping = THREE.EquirectangularReflectionMapping
      tex.colorSpace = THREE.SRGBColorSpace
      scene.background = tex
    }).catch(() => {
      scene.background = new THREE.Color('#ffffff')
    })
    return () => {
      disposed = true
    }
  }, [props.panoramaUrl, scene])

  // 相机控制句柄：重置视角 / 捕捉当前导演视角参数 / D2 机位平滑飞行
  useEffect(() => {
    // oxlint-disable-next-line react/immutability -- 命令式 ref 句柄：R3F OrbitControls 命令式 API 的标准桥接
    props.controlsRef.current = {
      reset: () => {
        const c = orbitRef.current
        if (!c) return
        c.object.position.set(5, 3.2, 7)
        c.target.set(0, 0.9, 0)
        c.update()
      },
      getCameraState: () => {
        const c = orbitRef.current
        const pos = c?.object.position
        const tgt = c?.target
        return {
          position: [round4(pos?.x ?? 5), round4(pos?.y ?? 3.2), round4(pos?.z ?? 7)] as [number, number, number],
          target: [round4(tgt?.x ?? 0), round4(tgt?.y ?? 0.9), round4(tgt?.z ?? 0)] as [number, number, number],
          fov: (c?.object as THREE.PerspectiveCamera | undefined)?.fov ?? 45,
        }
      },
      flyTo: (cam) => {
        const c = orbitRef.current
        if (!c) return
        const fromPos = c.object.position.clone()
        const fromTgt = c.target.clone()
        const fromFov = (c.object as THREE.PerspectiveCamera).fov
        const toPos = new THREE.Vector3(...cam.position)
        const toTgt = new THREE.Vector3(...cam.target)
        const dur = 600
        const start = performance.now()
        const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
        const step = (now: number) => {
          const u = Math.min(1, (now - start) / dur)
          const k = ease(u)
          c.object.position.lerpVectors(fromPos, toPos, k)
          c.target.lerpVectors(fromTgt, toTgt, k)
          const persp = c.object as THREE.PerspectiveCamera
          persp.fov = fromFov + (cam.fov - fromFov) * k
          persp.updateProjectionMatrix()
          c.update()
          if (u < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      },
      // D3：以指定机位姿态同步渲染一帧 → PNG dataURL（preserveDrawingBuffer 保证帧外可读）。
      // 渲染后立即恢复原导演视角，避免导出动作扰乱用户当前取景。
      captureFrame: (pose) => {
        const c = orbitRef.current
        if (!c) return null
        const cam = c.object as THREE.PerspectiveCamera
        const prevPos = cam.position.clone()
        const prevTgt = c.target.clone()
        const prevFov = cam.fov
        cam.position.set(...pose.position)
        c.target.set(...pose.target)
        cam.fov = pose.fov
        cam.updateProjectionMatrix()
        c.update()
        let url: string | null = null
        try {
          gl.render(scene, cam)
          url = gl.domElement.toDataURL('image/png')
        } catch {
          url = null
        }
        cam.position.copy(prevPos)
        c.target.copy(prevTgt)
        cam.fov = prevFov
        cam.updateProjectionMatrix()
        c.update()
        return url
      },
    }
  }, [props.controlsRef, gl, scene])

  return (
    <>
      <Grid
        infiniteGrid
        cellSize={0.5}
        sectionSize={2.5}
        fadeDistance={60}
        fadeStrength={1.5}
        cellColor="#dbe9ee"
        sectionColor="#b7ccd6"
        position={[0, 0, 0]}
      />
      {props.objects.map((o) => (
        <SceneObject
          key={o.id}
          object={o}
          builtinModelUrl={props.builtinModelUrl}
          modelUrlByRef={props.modelUrlByRef}
          selected={props.selectedId === o.id}
          refs={objectRefs}
          onSelect={props.onSelect}
        />
      ))}
      {props.selectedId && props.tool === 'move' && (
        <GizmoAttach
          objects={props.objects}
          selectedId={props.selectedId}
          refs={objectRefs}
          onTransform={props.onTransform}
        />
      )}
      <OrbitControls
        ref={orbitRef}
        makeDefault
        target={[0, 0.9, 0]}
        maxPolarAngle={Math.PI / 2 - 0.02}
        enableDamping
        dampingFactor={0.08}
      />
      {props.playback && props.playback.kfs.length > 0 && (
        <PlaybackDriver
          kfs={props.playback.kfs}
          playing={props.playback.playing}
          orbitRef={orbitRef}
          onPlayhead={props.playback.onPlayhead}
        />
      )}
    </>
  )
}

/** D2 关键帧播放驱动：useFrame 推进播放头，采样关键帧驱动导演相机（预览不落盘） */
function PlaybackDriver({
  kfs,
  playing,
  orbitRef,
  onPlayhead,
}: {
  kfs: Stage3DKeyframe[]
  playing: boolean
  orbitRef: React.MutableRefObject<React.ComponentRef<typeof OrbitControls> | null>
  onPlayhead(t: number): void
}) {
  const headRef = useRef(0)
  useEffect(() => {
    if (!playing) headRef.current = 0
  }, [playing])

  useFrame((_, delta) => {
    const c = orbitRef.current
    if (!playing || !c) return
    headRef.current += delta * 1000
    // 结束判定：sampleCameraPose 超范围钳制端点（永不返回 null），
    // 必须显式对比轨迹时长，否则播放头无限推进（实测 10s+ 不停）
    const duration = kfs.length > 0 ? kfs[kfs.length - 1].t : 0
    if (headRef.current >= duration) {
      onPlayhead(-1)
      headRef.current = 0
      return
    }
    const sample = sampleCameraPose(kfs, headRef.current)
    if (!sample) {
      // -1 = 播放结束信号（与起始 0 区分，Studio 收到后停止并归零播放头）
      onPlayhead(-1)
      headRef.current = 0
      return
    }
    c.object.position.set(...sample.position)
    c.target.set(...sample.target)
    const persp = c.object as THREE.PerspectiveCamera
    persp.fov = sample.fov
    persp.updateProjectionMatrix()
    c.update()
    onPlayhead(Math.round(headRef.current))
  })
  return null
}

function SceneObject({
  object,
  builtinModelUrl,
  modelUrlByRef,
  selected,
  refs,
  onSelect,
}: {
  object: Stage3DObject
  builtinModelUrl: string
  modelUrlByRef: Record<string, string>
  selected: boolean
  refs: React.MutableRefObject<Map<string, THREE.Object3D>>
  onSelect(id: string | null): void
}) {
  const groupRef = useRef<THREE.Group>(null)

  // 受控同步：props 值 → object3D transform（右栏改值即时生效；gizmo 拖拽回写同值无害）
  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    g.position.set(...object.position)
    g.rotation.set(...object.rotation)
    g.scale.set(...object.scale)
  }, [object.position, object.rotation, object.scale])

  return (
    <group
      ref={(r) => {
        // ⚠️ 必须同时写 groupRef：此前只写 refs 注册表，导致上面的受控同步 effect 永远拿不到
        // group（groupRef.current 恒为 null）——所有 primitive 堆在原点、F5 后位置/缩放不恢复。
        // oxlint-disable-next-line react/immutability -- ref 注册表：gizmo attach 需要 object3D 引用
        groupRef.current = r
        if (r) refs.current.set(object.id, r)
        else refs.current.delete(object.id)
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        onSelect(object.id)
      }}
    >
      {object.type === 'character' ? (
        <CharacterModel object={object} url={object.modelRef ? modelUrlByRef[object.modelRef] ?? null : builtinModelUrl} />
      ) : (
        <mesh castShadow>
          {object.type === 'box' && <boxGeometry args={[0.8, 0.8, 0.8]} />}
          {object.type === 'cylinder' && <cylinderGeometry args={[0.4, 0.4, 1, 24]} />}
          {object.type === 'sphere' && <sphereGeometry args={[0.5, 24, 24]} />}
          <meshStandardMaterial color={object.color} roughness={0.6} metalness={0.05} />
        </mesh>
      )}
      {/* 选中圈（图7 地面选中圈语义） */}
      {selected && <SelectionRing color={object.color} />}
    </group>
  )
}

/** 素体模型：GLB 懒加载 + 包围盒归一（~1.8 单位高）+ 色板覆色 + D2 预置姿势 */
function CharacterModel({ object, url }: { object: Stage3DObject; url: string | null }) {
  if (!url) {
    // 自定义模型 blob url 尚未水合：占位体如实显示
    return (
      <mesh>
        <capsuleGeometry args={[0.28, 0.9, 4, 12]} />
        <meshStandardMaterial color="#cccccc" roughness={0.8} />
      </mesh>
    )
  }
  return (
    <GLBModel
      key={url}
      url={url}
      color={object.color}
      pose={object.pose ?? 'tpose'}
      anim={object.anim ?? null}
    />
  )
}

function GLBModel({
  url,
  color,
  pose,
  anim,
}: {
  url: string
  color: string
  pose: Stage3DObject['pose']
  anim: Stage3DObject['anim'] | null
}) {
  const { scene, animations } = useGLTF(url)
  // 多实例关键：useGLTF 缓存返回的是同一个 scene 对象——多角色直接 add 会互相抢挂载
  // （Object3D 只能有一个父节点），改骨骼则全部实例串姿势。
  // SkeletonUtils.clone 深拷贝骨骼层级并重绑 SkinnedMesh，每个实例拿到独立骨骼姿态；
  // 缓存源保持 pristine，反复克隆都从绑定姿势出发。选型：drei 标准路径（useGLTF 缓存
  // + SkeletonUtils.clone），不自加载 GLTFLoader.loadAsync——chunk 零新增、geometry 复用。
  const inner = useMemo(() => {
    // 多实例关键：useGLTF 缓存返回的是同一个 scene 对象——多角色直接 add 会互相抢挂载
    // （Object3D 只能有一个父节点），改骨骼则全部实例串姿势。
    // SkeletonUtils.clone 深拷贝骨骼层级并重绑 SkinnedMesh，每个实例拿到独立骨骼姿态；
    // 缓存源保持 pristine，反复克隆都从绑定姿势出发。选型：drei 标准路径（useGLTF 缓存
    // + SkeletonUtils.clone），不自加载 GLTFLoader.loadAsync——chunk 零新增、geometry 复用。
    const clone = skeletonClone(scene)
    const root = new THREE.Group()
    root.add(clone)
    // 色板覆色：8 色板选中的颜色覆写全部 mesh（默认色 = 模型原色）
    let hasSkinnedMesh = false
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) hasSkinnedMesh = true
        mesh.material = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 })
        mesh.castShadow = false
        // 克隆后包围球与骨骼姿态不同步，禁用视锥剔除防「角色消失」
        mesh.frustumCulled = false
      }
    })
    // 包围盒归一：统一至约 1.8 单位高（数据契约 scale 只承担用户倍率）。
    // ⚠️ 蒙皮模型必须跳过：内置素体 GLB 的 inverseBindMatrices 为单位阵（非标准导出），
    // 蒙皮正确性依赖「加载时冻结的骨骼矩阵空间」——对克隆树施加任何祖先缩放都会让
    // 骨骼世界矩阵偏离绑定空间，角色缩成小点（实测归一化 k=0.052 时仅 ≈0.2 单位高）。
    // 该素体在原始尺度下渲染高度即 ≈1.78（≈1.8 契约值），无需缩放；
    // 静态网格模型（无骨骼）不受影响，仍走包围盒归一。
    if (!hasSkinnedMesh) {
      const box = new THREE.Box3().setFromObject(clone)
      const size = new THREE.Vector3()
      box.getSize(size)
      const h = Math.max(size.y, 0.001)
      const k = 1.8 / h
      root.scale.setScalar(k)
      // 落地：包围盒底边贴网格地面
      root.position.y = -box.min.y * k
    }
    return root
  }, [scene, color])

  // 绑定姿势快照：克隆树在首次渲染时即绑定姿势（早于任何姿势/动作写入），此处采集最可靠
  const restRot = useMemo(() => {
    const m = new Map<string, [number, number, number]>()
    inner.traverse((child) => {
      const b = child as THREE.Bone
      if (b.isBone) m.set(b.name, [b.rotation.x, b.rotation.y, b.rotation.z])
    })
    return m
  }, [inner])

  // D7 动作播放：AnimationMixer（three 自带，零新增依赖）驱动内置素体内嵌片段
  const clipName = animClipFor(anim)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  useEffect(() => {
    const debug = window as unknown as Record<string, unknown>
    if (!clipName) {
      const m = mixerRef.current
      if (m) {
        m.stopAllAction()
        m.uncacheRoot(inner)
        mixerRef.current = null
      }
      debug.__s3animClip = null
      return
    }
    const clip = animations.find((c) => c.name === clipName)
    if (!clip) {
      // 自定义模型无同名片段：如实不播放（UI 侧已按实际片段禁用）
      debug.__s3animClip = null
      return
    }
    const mixer = new THREE.AnimationMixer(inner)
    const action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.play()
    mixerRef.current = mixer
    debug.__s3animClip = clipName
    return () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(inner)
      if (mixerRef.current === mixer) mixerRef.current = null
    }
  }, [inner, animations, clipName])

  // 每帧推进动画（未播放时 mixerRef 为空，零开销）
  useFrame((_, delta) => {
    mixerRef.current?.update(delta)
  })

  // D2 预置姿势：骨骼旋转参数化（切姿势先复位绑定姿势再应用，蒙皮不残留）。
  // D7：**播放动作期间暂停姿势叠加**——动画关键帧为绝对姿态，与姿势叠加会互相打架；
  // 停止动作后本效应重跑，自动恢复绑定姿势 + 所选姿势（实测互斥切换无残留）。
  useEffect(() => {
    if (anim) {
      // -1 = 本帧因动作播放而跳过姿势叠加（显式哨兵，便于实机断言；非「命中 0 个关节」）
      ;(window as unknown as Record<string, unknown>).__s3poseMatched = -1
      return
    }
    const joints = (pose && STAGE3D_POSE_PRESETS[pose]) || {}
    // GLTFLoader 会 sanitize 骨骼名（点号删除）：姿势库 key 与实际骨骼名双侧归一后匹配
    const jointsBySanitized = new Map(Object.entries(joints).map(([k, v]) => [sanitizeBoneName(k), v]))
    let matchedCount = 0
    inner.traverse((child) => {
      const bone = child as THREE.Bone
      if (!bone.isBone) return
      const r = restRot.get(bone.name)
      if (r) bone.rotation.set(r[0], r[1], r[2])
      const j = jointsBySanitized.get(bone.name)
      if (j) {
        matchedCount++
        bone.rotation.x += j[0]
        bone.rotation.y += j[1]
        bone.rotation.z += j[2]
      }
    })
    ;(window as unknown as Record<string, unknown>).__s3poseMatched = matchedCount
  }, [inner, pose, anim, restRot])

  return <primitive object={inner} />
}

function SelectionRing({ color }: { color: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
      <ringGeometry args={[0.55, 0.65, 40]} />
      <meshBasicMaterial color={color} transparent opacity={0.85} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** TransformControls 动态 attach 到选中对象（object prop 模式，避免 children 包裹的结构变化） */
function GizmoAttach({
  objects,
  selectedId,
  refs,
  onTransform,
}: {
  objects: Stage3DObject[]
  selectedId: string
  refs: React.MutableRefObject<Map<string, THREE.Object3D>>
  onTransform: Stage3DViewportProps['onTransform']
}) {
  const [target, setTarget] = useState<THREE.Object3D | null>(null)
  useEffect(() => {
    // 等渲染周期后 attach（refs 在 commit 后才可用）
    const t = window.setTimeout(() => {
      setTarget(refs.current.get(selectedId) ?? null)
    }, 0)
    return () => window.clearTimeout(t)
  }, [selectedId, objects, refs])

  if (!target) return null
  return (
    <TransformControls
      object={target}
      mode="translate"
      size={0.8}
      onObjectChange={() => {
        const o = objects.find((x) => x.id === selectedId)
        if (!o) return
        onTransform(selectedId, {
          position: [round4(target.position.x), round4(target.position.y), round4(target.position.z)],
          rotation: [round4(target.rotation.x), round4(target.rotation.y), round4(target.rotation.z)],
          scale: [round4(target.scale.x), round4(target.scale.y), round4(target.scale.z)],
        })
      }}
    />
  )
}

useGLTF.preload(DEFAULT_CHARACTER_MODEL_URL)
