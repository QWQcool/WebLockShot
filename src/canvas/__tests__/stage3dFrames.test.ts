import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGE3D_DIRECT_SHOT_ID,
  STAGE3D_SHOT_PLAN_MAX,
  buildCameraFrame,
  buildStage3DFrameSequence,
  buildStage3dDirectPlan,
  canvasShotPlanSchema,
  describeCameraMotion,
  describeShotPlanSource,
  frameSequenceToShotPlan,
  readShotPlanMetaPayload,
  readStage3DFrameSequence,
  stage3dFramesDigest,
  writeShotPlanMetaPayload,
  writeStage3DFrameSequence,
  type Stage3DCameraFrame,
} from '../stage3dFrames.ts'
import type { Stage3DCamera } from '../stage3dMeta.ts'
import type { Stage3DKeyframe } from '../stage3dKeyframes.ts'

const CAM = (id: string, name: string, over: Partial<Stage3DCamera> = {}): Stage3DCamera => ({
  id,
  name,
  position: [5, 3, 7],
  target: [0, 1, 0],
  fov: 45,
  ...over,
})

const KF = (t: number, p: [number, number, number], fov = 45): Stage3DKeyframe => ({
  t,
  position: p,
  target: [0, 1, 0],
  fov,
})

/* ---------------- 运镜文字描述 ---------------- */

test('运镜描述：无关键帧 = 固定机位（含 FOV），确定性可复现', () => {
  const cam = CAM('s3c_a', '机位 1', { fov: 50 })
  const text = describeCameraMotion(cam)
  assert.match(text, /固定机位/)
  assert.match(text, /50/)
  assert.equal(text, describeCameraMotion(cam))
})

test('运镜描述：距离收窄 = 推近、放宽 = 拉远、FOV 变化 = 变焦', () => {
  // 位置向目标靠近（距离 8.6 → 4.2 左右）
  const push = CAM('s3c_p', '推镜', { keyframes: [KF(0, [5, 3, 7]), KF(2000, [2.5, 1.6, 3.5])] })
  assert.match(describeCameraMotion(push), /推近/)
  const pull = CAM('s3c_o', '拉镜', { keyframes: [KF(0, [2.5, 1.6, 3.5]), KF(2000, [5, 3, 7])] })
  assert.match(describeCameraMotion(pull), /拉远/)
  // 位置不变仅 FOV 变：既非推拉，也带变焦段
  const zoom = CAM('s3c_z', '变焦', { keyframes: [KF(0, [5, 3, 7], 45), KF(2000, [5, 3, 7], 70)] })
  const text = describeCameraMotion(zoom)
  assert.match(text, /变焦放宽/)
  assert.match(text, /时长 2000ms/)
})

test('运镜描述：横移（距离不变但位移明显）', () => {
  const pan = CAM('s3c_m', '横移', { keyframes: [KF(0, [0, 1, 6]), KF(2000, [8, 1, 6])] })
  assert.match(describeCameraMotion(pan), /横移/)
})

/* ---------------- 帧记录 / 帧序列 ---------------- */

test('buildCameraFrame：无关键帧时省略 keyframes 且首尾帧同引用', () => {
  const frame = buildCameraFrame(CAM('s3c_a', '机位 1'), 'idbref://f', 'idbref://l')
  assert.equal(frame.cameraId, 's3c_a')
  assert.equal(frame.firstFrameRef, 'idbref://f')
  assert.equal(frame.lastFrameRef, 'idbref://l')
  assert.equal(frame.keyframes, undefined)
  assert.match(frame.motionText, /固定机位/)
})

test('buildCameraFrame：有轨迹时归一化入库（排序去重保末值）', () => {
  const cam = CAM('s3c_a', '机位 1', { keyframes: [KF(2000, [2, 2, 4]), KF(1000, [1, 1, 5]), KF(1000, [9, 9, 9])] })
  const frame = buildCameraFrame(cam, 'idbref://f', 'idbref://l')
  assert.ok(frame.keyframes)
  assert.deepEqual(frame.keyframes?.map((k) => k.t), [1000, 2000])
  assert.deepEqual(frame.keyframes?.[0].position, [9, 9, 9], '同 t 去重保末值')
})

test('buildStage3DFrameSequence：空序列诚实拒绝；合法序列通过', () => {
  assert.equal(buildStage3DFrameSequence([]).ok, false)
  const f = buildCameraFrame(CAM('s3c_a', '机位 1'), 'idbref://f', 'idbref://l')
  const check = buildStage3DFrameSequence([f], 123456)
  assert.equal(check.ok, true)
  if (check.ok) {
    assert.equal(check.sequence.frames.length, 1)
    assert.equal(check.sequence.exportedAt, 123456)
  }
})

test('buildStage3DFrameSequence：blob: 帧引用整体拒绝（不半渲染）', () => {
  const f = buildCameraFrame(CAM('s3c_a', '机位 1'), 'blob:http://x/y', 'idbref://l')
  const check = buildStage3DFrameSequence([f])
  assert.equal(check.ok, false)
  if (!check.ok) assert.match(check.reason, /帧图引用|不合法/)
})

test('帧序列读写：round trip + 缺失/非法返回 null + 其余 meta 键保留', () => {
  const f = buildCameraFrame(CAM('s3c_a', '机位 1'), 'idbref://f', 'idbref://l')
  const seq = buildStage3DFrameSequence([f], 1000)
  assert.equal(seq.ok, true)
  if (!seq.ok) return
  const written = writeStage3DFrameSequence({ stage3d: { x: 1 } }, seq.sequence)
  assert.ok(written)
  assert.ok(written.stage3d)
  const back = readStage3DFrameSequence(written)
  assert.ok(back)
  assert.equal(back.frames[0].cameraId, 's3c_a')

  assert.equal(readStage3DFrameSequence(null), null)
  assert.equal(readStage3DFrameSequence({}), null)
  assert.equal(readStage3DFrameSequence({ stage3dFrames: { version: 1, frames: [] } }), null)
})

/* ---------------- D 口：自由分镜 ---------------- */

test('frameSequenceToShotPlan：镜数严格 = 机位数（不截断不伪造）', () => {
  const frames = [1, 2, 3].map((i) =>
    buildCameraFrame(CAM(`s3c_${i}`, `机位 ${i}`), `idbref://f${i}`, `idbref://l${i}`)
  )
  const seq = buildStage3DFrameSequence(frames, 1)
  assert.equal(seq.ok, true)
  if (!seq.ok) return
  const plan = frameSequenceToShotPlan(seq.sequence)
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.plan.shots.length, 3)
  for (const shot of plan.plan.shots) {
    assert.ok(shot.frameRef.startsWith('idbref://'))
    assert.ok(shot.motionText.length > 0)
    assert.ok(shot.camera.fov >= 20)
  }
  assert.equal(describeShotPlanSource(seq.sequence), '3D 台自由分镜 · 3 机位（镜数=机位数）')
})

test('frameSequenceToShotPlan：超过 12 机位诚实拒绝（不截断）', () => {
  const frames = Array.from({ length: STAGE3D_SHOT_PLAN_MAX + 1 }, (_, i) =>
    buildCameraFrame(CAM(`s3c_${i}`, `机位 ${i}`), `idbref://f${i}`, `idbref://l${i}`)
  )
  const seq = buildStage3DFrameSequence(frames, 1)
  assert.equal(seq.ok, true)
  if (!seq.ok) return
  const plan = frameSequenceToShotPlan(seq.sequence)
  assert.equal(plan.ok, false)
  if (!plan.ok) assert.match(plan.reason, /超过自由分镜上限/)
})

test('canvasShotPlanSchema：1~12 合法，0 / 13 拒绝', () => {
  const shot = {
    frameRef: 'idbref://f',
    camera: { position: [0, 0, 0], target: [0, 0, 0], fov: 45 },
    motionText: '固定机位',
  }
  assert.equal(canvasShotPlanSchema.safeParse({ shots: [shot] }).success, true)
  assert.equal(canvasShotPlanSchema.safeParse({ shots: [] }).success, false)
  assert.equal(
    canvasShotPlanSchema.safeParse({ shots: Array.from({ length: 13 }, () => shot) }).success,
    false
  )
})

test('自由分镜 meta 载荷：写入剔除 script 6 镜痕迹键（来源互斥）+ 读取 round trip', () => {
  const f = buildCameraFrame(CAM('s3c_a', '机位 1'), 'idbref://f', 'idbref://l')
  const seq = buildStage3DFrameSequence([f], 1)
  assert.equal(seq.ok, true)
  if (!seq.ok) return
  const plan = frameSequenceToShotPlan(seq.sequence)
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  const written = writeShotPlanMetaPayload(
    { story: { id: 'x' }, scriptDigest: 'd', scriptLogline: 'l', other: 1 },
    { shotPlan: plan.plan, stage3dDigest: 'abc', stage3dSource: '3D 台自由分镜 · 1 机位（镜数=机位数）' }
  )
  assert.ok(written)
  assert.equal(written.story, undefined, '来源互斥：story 痕迹被剔除')
  assert.equal(written.scriptDigest, undefined)
  assert.equal(written.scriptLogline, undefined)
  assert.equal(written.other, 1, '无关 meta 键保留')
  const back = readShotPlanMetaPayload(written)
  assert.ok(back)
  assert.equal(back.shotPlan.shots.length, 1)
  assert.equal(back.stage3dDigest, 'abc')

  assert.equal(readShotPlanMetaPayload({}), null)
})

/* ---------------- B 口：单镜直出计划 ---------------- */

test('buildStage3dDirectPlan：有参考底图 → image2video；缺省 → text2video', () => {
  const frame = buildCameraFrame(CAM('s3c_a', '机位 1'), 'idbref://f', 'idbref://l')
  const withRef = buildStage3dDirectPlan(frame, 'blob:http://x/ref')
  assert.equal(withRef.shotId, STAGE3D_DIRECT_SHOT_ID)
  assert.equal(withRef.kind, 'image2video')
  assert.equal(withRef.referenceImage, 'blob:http://x/ref')
  assert.equal(withRef.order, 1)
  assert.match(withRef.positive, /机位 1/)

  const noRef = buildStage3dDirectPlan(frame)
  assert.equal(noRef.kind, 'text2video')
  assert.equal(noRef.referenceImage, undefined)
})

/* ---------------- 摘要指纹 ---------------- */

test('帧序列摘要指纹：确定性 + 机位参数变化即变化', () => {
  const a = buildStage3DFrameSequence([buildCameraFrame(CAM('s3c_a', '机位 1'), 'idbref://f', 'idbref://l')], 1)
  const b = buildStage3DFrameSequence([buildCameraFrame(CAM('s3c_a', '机位 1'), 'idbref://f', 'idbref://l')], 1)
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  if (!a.ok || !b.ok) return
  assert.equal(stage3dFramesDigest(a.sequence), stage3dFramesDigest(b.sequence))

  const moved = buildStage3DFrameSequence(
    [buildCameraFrame(CAM('s3c_a', '机位 1', { fov: 60 }), 'idbref://f', 'idbref://l')],
    1
  )
  assert.equal(moved.ok, true)
  if (!moved.ok) return
  assert.notEqual(stage3dFramesDigest(a.sequence), stage3dFramesDigest(moved.sequence))
})

/* ---------------- 类型守卫 ---------------- */

test('Stage3DCameraFrame 形状与契约一致（引用只允许 idbref/http）', () => {
  const frame: Stage3DCameraFrame = buildCameraFrame(CAM('s3c_a', '机位 1'), 'https://cdn/x.png', 'idbref://l')
  assert.ok(frame.firstFrameRef.startsWith('https://'))
})
