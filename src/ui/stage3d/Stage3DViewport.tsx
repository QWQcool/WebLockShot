import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Stage3DObject } from '../../canvas/stage3dMeta.ts'

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
  /** 相机控制句柄（重置视角 / 新增机位捕捉当前导演视角参数） */
  controlsRef: React.MutableRefObject<{
    reset: () => void
    getCameraState?: () => { position: [number, number, number]; target: [number, number, number]; fov: number }
  } | null>
}

export const DEFAULT_CHARACTER_MODEL_URL = '/models/quaternius-universal-character.glb'

const round4 = (v: number): number => Math.round(v * 10000) / 10000

export default function Stage3DViewport(props: Stage3DViewportProps) {
  return (
    <Canvas
      camera={{ position: [5, 3.2, 7], fov: 45, near: 0.1, far: 500 }}
      gl={{ antialias: true }}
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

  // 相机控制句柄：重置视角 / 捕捉当前导演视角参数（新增机位用）
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
    }
  }, [props.controlsRef])

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
    </>
  )
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
        // oxlint-disable-next-line react/immutability -- ref 注册表：gizmo attach 需要 object3D 引用
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

/** 素体模型：GLB 懒加载 + 包围盒归一（~1.8 单位高）+ 色板覆色 */
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
  return <GLBModel key={url} url={url} color={object.color} />
}

function GLBModel({ url, color }: { url: string; color: string }) {
  const { scene } = useGLTF(url)
  const inner = useMemo(() => {
    const clone = scene.clone(true)
    const root = new THREE.Group()
    root.add(clone)
    // 包围盒归一：统一至约 1.8 单位高（数据契约 scale 只承担用户倍率）
    const box = new THREE.Box3().setFromObject(clone)
    const size = new THREE.Vector3()
    box.getSize(size)
    const h = Math.max(size.y, 0.001)
    const k = 1.8 / h
    root.scale.setScalar(k)
    // 落地：包围盒底边贴网格地面
    root.position.y = -box.min.y * k
    // 色板覆色：8 色板选中的颜色覆写全部 mesh（默认色 = 模型原色）
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 })
        mesh.material = mat
        mesh.castShadow = false
      }
    })
    return root
  }, [scene, color])
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
