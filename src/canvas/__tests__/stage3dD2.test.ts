import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGE3D_POSE_LABELS,
  STAGE3D_POSE_PRESETS,
  isStage3DPoseId,
  sanitizeBoneName,
} from '../stage3dPose.ts'
import {
  keyframesDuration,
  normalizeKeyframes,
  sampleCameraPose,
} from '../stage3dKeyframes.ts'
import { readStage3DMetaPayload } from '../stage3dMeta.ts'

/* ---------------- 姿势库 ---------------- */

test('姿势库：四个预置 id 齐备且标签存在', () => {
  assert.deepEqual(Object.keys(STAGE3D_POSE_PRESETS).sort(), ['sit', 'stand', 'tpose', 'walk'])
  for (const id of Object.keys(STAGE3D_POSE_PRESETS)) {
    assert.ok(STAGE3D_POSE_LABELS[id as keyof typeof STAGE3D_POSE_LABELS])
    assert.equal(isStage3DPoseId(id), true)
  }
  assert.equal(isStage3DPoseId('dance'), false)
})

test('姿势库：T-Pose 为空旋转集（= rig 复位），其余姿势只动主关节', () => {
  assert.deepEqual(STAGE3D_POSE_PRESETS.tpose, {})
  const allowedBones = /DEF-(thigh|shin|upper_arm|forearm|spine|hips)\./
  for (const [id, joints] of Object.entries(STAGE3D_POSE_PRESETS)) {
    if (id === 'tpose') continue
    const bones = Object.keys(joints)
    assert.ok(bones.length > 0 && bones.length <= 10, `${id} 关节数 1~10`)
    for (const b of bones) {
      assert.match(b, allowedBones, `${id} 只动主关节（不碰手指等细节骨）`)
      const [x, y, z] = joints[b]
      for (const v of [x, y, z]) {
        assert.ok(Number.isFinite(v) && Math.abs(v) <= Math.PI, `${id}.${b} 弧度合法`)
      }
    }
  }
})

test('姿势库：sit 对称腿折叠（thigh 前抬 ≈ -88°、shin 下垂 ≈ 84°）', () => {
  const sit = STAGE3D_POSE_PRESETS.sit
  const thighL = sit['DEF-thigh.L']
  const shinL = sit['DEF-shin.L']
  assert.ok(thighL[0] < -1.2 && thighL[0] > -1.7, 'thigh 前抬接近 -90°')
  assert.ok(shinL[0] > 1.2 && shinL[0] < 1.6, 'shin 下垂接近 +90°')
})

test('骨骼名归一：复刻 GLTFLoader sanitize 规则（点号删除/空格转下划线）', () => {
  assert.equal(sanitizeBoneName('DEF-thigh.L'), 'DEF-thighL')
  assert.equal(sanitizeBoneName('DEF-spine.001'), 'DEF-spine001')
  assert.equal(sanitizeBoneName('DEF-f index.01.L'), 'DEF-f_index01L')
  assert.equal(sanitizeBoneName('DEF-hips'), 'DEF-hips')
  // 姿势库 key 归一后应能命中运行时骨骼名（双侧同规则）
  for (const joints of Object.values(STAGE3D_POSE_PRESETS)) {
    for (const boneName of Object.keys(joints)) {
      assert.ok(sanitizeBoneName(boneName).length > 0)
    }
  }
})

/* ---------------- 关键帧 ---------------- */

const KF = (t: number, p: [number, number, number] = [1, 1, 6], fov = 45) => ({
  t,
  position: p,
  target: [0, 1, 0] as [number, number, number],
  fov,
})

test('关键帧：normalize 排序 + 同 t 去重保末值', () => {
  const n = normalizeKeyframes([KF(2000), KF(1000), KF(1000, [5, 5, 5])])
  assert.deepEqual(n.map((k) => k.t), [1000, 2000])
  assert.deepEqual(n[0].position, [5, 5, 5])
})

test('关键帧：时长 = 末帧 t，空数组为 0', () => {
  assert.equal(keyframesDuration([KF(3000), KF(1000)]), 3000)
  assert.equal(keyframesDuration([]), 0)
})

test('关键帧：插值端点钳制 + 单帧恒定', () => {
  const kfs = [KF(0, [0, 0, 5]), KF(2000, [10, 0, 5])]
  // t 超范围取端点
  assert.deepEqual(sampleCameraPose(kfs, -500)?.position, [0, 0, 5])
  assert.deepEqual(sampleCameraPose(kfs, 9999)?.position, [10, 0, 5])
  // 单帧
  assert.deepEqual(sampleCameraPose([KF(100, [1, 2, 3])], 500)?.position, [1, 2, 3])
  // 空
  assert.equal(sampleCameraPose([], 0), null)
})

test('关键帧：中点采样落在两端点之间（平滑插值）', () => {
  const kfs = [KF(0, [0, 0, 5], 40), KF(2000, [10, 4, 5], 80)]
  const mid = sampleCameraPose(kfs, 1000)
  assert.ok(mid)
  if (!mid) return
  assert.ok(mid.position[0] > 3 && mid.position[0] < 7, 'x 在两端点之间')
  assert.ok(mid.position[1] > 1 && mid.position[1] < 3, 'y 在两端点之间')
  assert.equal(mid.fov, 60, 'fov 线性中点')
})

test('关键帧：三帧 Catmull-Rom 过点（端点帧精确命中）', () => {
  const kfs = [KF(0, [0, 0, 5]), KF(1000, [4, 2, 5]), KF(2000, [8, 0, 5])]
  assert.deepEqual(sampleCameraPose(kfs, 1000)?.position, [4, 2, 5], '中帧精确过点')
})

test('契约：pose 字段入对象（合法 id 过 / 非法拒）、keyframes 入机位', () => {
  const base = {
    objects: [
      {
        id: 's3o_a',
        type: 'character',
        name: '素体',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: '#c06a38',
        pose: 'sit',
      },
    ],
    cameras: [
      {
        id: 's3c_a',
        name: '机位 1',
        position: [5, 3, 7],
        target: [0, 1, 0],
        fov: 45,
        keyframes: [KF(0, [5, 3, 7]), KF(2000, [2, 2, 4], 60)],
      },
    ],
    env: {},
  }
  const ok = readStage3DMetaPayload(base)
  assert.equal(ok.ok, true)

  const badPose = readStage3DMetaPayload({
    ...base,
    objects: [{ ...base.objects[0], pose: 'dance' }],
  })
  assert.equal(badPose.ok, false)

  const badKf = readStage3DMetaPayload({
    ...base,
    cameras: [{ ...base.cameras[0], keyframes: [{ t: -5, position: [0, 0, 0], target: [0, 0, 0], fov: 45 }] }],
  })
  assert.equal(badKf.ok, false)
})
