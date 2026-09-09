import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildInpaintWorkflow,
  buildFluxFillWorkflow,
  buildSdInpaintWorkflow,
  buildViewUrl,
  extractImageOutput,
} from '../providers/comfyuiImage.ts'
import { demoInpaintPixels, shiftChannels } from '../providers/inpaintDemo.ts'

/* ---------------- ComfyUI 图像 inpaint 工作流装配（纯函数） ---------------- */

test('A2 flux-fill 工作流：LoadImage 源图 + LoadImageMask mask + inpaint 采样链完整', () => {
  const wf = buildFluxFillWorkflow('src.png', 'mask.png', '换成大理石台面', 'blurry', 'wls_test') as Record<
    string,
    { inputs: Record<string, unknown>; class_type: string }
  >
  assert.equal(wf['6'].class_type, 'LoadImage')
  assert.equal(wf['6'].inputs.image, 'src.png')
  assert.equal(wf['7'].class_type, 'LoadImageMask')
  assert.equal(wf['7'].inputs.image, 'mask.png')
  // 采样链：InpaintModelConditioning → KSampler → VAEDecode → SaveImage
  assert.equal(wf['8'].class_type, 'InpaintModelConditioning')
  assert.equal(wf['9'].class_type, 'KSampler')
  assert.deepEqual(wf['9'].inputs.positive, ['8', 0])
})

test('A2 flux-fill 工作流：KSampler 连线引用 InpaintModelConditioning 输出', () => {
  const wf = buildFluxFillWorkflow('s.png', 'm.png', 'p', 'n', 'wls') as Record<
    string,
    { inputs: Record<string, unknown>; class_type: string }
  >
  assert.deepEqual(wf['9'].inputs.model, ['1', 0])
  assert.deepEqual(wf['9'].inputs.positive, ['8', 0])
  assert.deepEqual(wf['9'].inputs.negative, ['8', 1])
  assert.deepEqual(wf['9'].inputs.latent_image, ['8', 2])
  assert.deepEqual(wf['10'].inputs.samples, ['9', 0])
  assert.deepEqual(wf['11'].inputs.images, ['10', 0])
  assert.equal(wf['4'].inputs.text, 'p')
})

test('A2 sd-inpaint 工作流：checkpoint 路径 + mask 通道为 red', () => {
  const wf = buildSdInpaintWorkflow('s.png', 'm.png', 'p', 'n', 'wls') as Record<
    string,
    { inputs: Record<string, unknown>; class_type: string }
  >
  assert.equal(wf['1'].class_type, 'CheckpointLoaderSimple')
  assert.equal(wf['5'].inputs.channel, 'red')
  assert.deepEqual(wf['7'].inputs.positive, ['6', 0])
  assert.deepEqual(wf['7'].inputs.latent_image, ['6', 2])
})

test('A2 buildInpaintWorkflow：preset 路由 + custom 占位符替换', () => {
  // flux-fill / sd-inpaint 路由
  const flux = buildInpaintWorkflow(
    { preset: 'flux-fill', prompt: 'p', filenamePrefix: 'x' },
    'a.png',
    'b.png'
  )
  assert.equal((flux as Record<string, { class_type: string }>)['1'].class_type, 'UNETLoader')
  const sd = buildInpaintWorkflow(
    { preset: 'sd-inpaint', prompt: 'p', filenamePrefix: 'x' },
    'a.png',
    'b.png'
  )
  assert.equal((sd as Record<string, { class_type: string }>)['1'].class_type, 'CheckpointLoaderSimple')

  // custom：占位符整值替换
  const customJson = JSON.stringify({
    '10': { inputs: { image: '{{SOURCE}}' }, class_type: 'LoadImage' },
    '11': { inputs: { image: '{{MASK}}', channel: 'red' }, class_type: 'LoadImageMask' },
    '12': { inputs: { text: '{{PROMPT}}', clip: ['1', 1] }, class_type: 'CLIPTextEncode' },
    '13': { inputs: { text: '{{NEGATIVE}}' }, class_type: 'CLIPTextEncode' },
    '14': { inputs: { seed: '{{SEED}}' }, class_type: 'KSampler' },
    '15': { inputs: { note: 'keep {{SOURCE}} literal' }, class_type: 'Note' },
  })
  const custom = buildInpaintWorkflow(
    { preset: 'custom', prompt: '大理石台面', customWorkflowJson: customJson },
    'uploaded_src.png',
    'uploaded_mask.png'
  ) as Record<string, { inputs: Record<string, unknown> }>
  assert.equal(custom['10'].inputs.image, 'uploaded_src.png')
  assert.equal(custom['11'].inputs.image, 'uploaded_mask.png')
  assert.equal(custom['12'].inputs.text, '大理石台面')
  assert.equal(typeof custom['14'].inputs.seed, 'number')
  // 非整值占位符（普通字符串内含占位符）不误伤
  assert.equal(custom['15'].inputs.note, 'keep {{SOURCE}} literal')
  // 数组引用不被破坏
  assert.deepEqual(custom['12'].inputs.clip, ['1', 1])

  // custom 缺 JSON 必须抛错（诚实失败）
  assert.throws(() => buildInpaintWorkflow({ preset: 'custom', prompt: 'p' }, 'a', 'b'))
})

test('A2 history 提取与 /view URL 拼接（纯函数）', () => {
  const history = {
    'pid-1': {
      outputs: {
        11: { images: [{ filename: 'out_00001.png', subfolder: '', type: 'output' }] },
      },
    },
  }
  const out = extractImageOutput(history, 'pid-1')
  assert.ok(out)
  assert.equal(out.filename, 'out_00001.png')
  assert.equal(
    buildViewUrl('http://127.0.0.1:8188/', out),
    'http://127.0.0.1:8188/view?filename=out_00001.png&subfolder=&type=output'
  )
  // 无输出 / 无该 promptId → null 继续轮询
  assert.equal(extractImageOutput({}, 'pid-1'), null)
  assert.equal(extractImageOutput({ 'pid-1': { outputs: {} } }, 'pid-1'), null)
})

/* ---------------- 演示重绘纯函数 ---------------- */

test('A2 演示重绘：mask 区域通道轮换 + 马赛克，未涂区域逐像素不变', () => {
  // 4x4 源图，mask 覆盖右半（x>=2）
  const w = 4
  const h = 4
  const rgba = new Uint8ClampedArray(w * h * 4)
  const mask = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const x = i % w
    rgba[i * 4] = 10 + x
    rgba[i * 4 + 1] = 20 + x
    rgba[i * 4 + 2] = 30 + x
    rgba[i * 4 + 3] = 255
    if (x >= 2) mask[i * 4 + 3] = 255
  }
  const before = new Uint8ClampedArray(rgba)
  demoInpaintPixels(rgba, mask, w, h, 2)

  // 未涂区域（x<2）逐像素不变
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 2; x++) {
      const p = (y * w + x) * 4
      assert.deepEqual([rgba[p], rgba[p + 1], rgba[p + 2]], [before[p], before[p + 1], before[p + 2]])
    }
  }
  // 涂抹区域：块内统一为平均色通道轮换（块 x∈[2,4) 平均 r=12.5, g=22.5, b=32.5）
  const [tr, tg, tb] = shiftChannels(Math.round(12.5), Math.round(22.5), Math.round(32.5))
  for (let y = 0; y < h; y++) {
    const p = (y * w + 2) * 4
    assert.deepEqual([rgba[p], rgba[p + 1], rgba[p + 2]], [tr, tg, tb])
  }
  // 马赛克：同一块内所有像素颜色一致（行 0 列 2 与 行 1 列 3 同属块 x∈[2,4), y∈[0,2)）
  const p0 = 2 * 4 // 行 0 列 2
  const p1 = (w + 3) * 4 // 行 1 列 3
  assert.deepEqual([rgba[p0], rgba[p0 + 1], rgba[p0 + 2]], [rgba[p1], rgba[p1 + 1], rgba[p1 + 2]])
})

test('A2 演示重绘：确定性（同输入同输出）+ 空 mask 不处理', () => {
  const w = 8
  const h = 8
  const make = () => {
    const rgba = new Uint8ClampedArray(w * h * 4)
    const mask = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = (i * 7) % 256
      rgba[i * 4 + 1] = (i * 11) % 256
      rgba[i * 4 + 2] = (i * 13) % 256
      rgba[i * 4 + 3] = 255
      if (i % 3 === 0) mask[i * 4 + 3] = 255
    }
    return { rgba, mask }
  }
  const a = make()
  const b = make()
  demoInpaintPixels(a.rgba, a.mask, w, h, 4)
  demoInpaintPixels(b.rgba, b.mask, w, h, 4)
  assert.deepEqual(Buffer.from(a.rgba).equals(Buffer.from(b.rgba)), true)

  // mask 全空 / mask 为 null：原地不动
  const c = make()
  const emptyMask = new Uint8ClampedArray(w * h * 4)
  const cBefore = new Uint8ClampedArray(c.rgba)
  demoInpaintPixels(c.rgba, emptyMask, w, h, 4)
  assert.deepEqual(Buffer.from(c.rgba).equals(Buffer.from(cBefore)), true)
  demoInpaintPixels(c.rgba, null, w, h, 4)
  assert.deepEqual(Buffer.from(c.rgba).equals(Buffer.from(cBefore)), true)
})
