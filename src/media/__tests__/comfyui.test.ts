import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ComfyUIVideoProvider,
  buildComfyViewUrl,
  buildMiniMaxH3Workflow,
  buildWan22Ti2vWorkflow,
  comboOptionsOf,
  comfyEstimateText,
  comfyRequiredWindowMinutes,
  comfyTierBudget,
  comfyTierResolution,
  estimateShotSeconds,
  extractVideoOutput,
  isKnownComfyPreset,
  minimaxH3FramesForDuration,
  normalizeComfyPreset,
  normalizeComfyTier,
  presetRequiredModels,
  presetRequiredNodes,
  resolveCustomWorkflow,
  unknownPresetMessage,
  wan22FramesForDuration,
  withCacheBuster,
  type ComfyUIWorkflowPreset,
} from '../providers/comfyui.ts'

const REQ = {
  clientTaskId: 'k1',
  prompt: 'a paper boat on a calm lake at sunrise',
  durationSec: 5,
  ratio: '9:16' as const,
  shotId: 'story1-s1',
}

test('ComfyUI 视频 Provider：定价预估应标明自建算力 0 成本', () => {
  const provider = new ComfyUIVideoProvider()
  const cost = provider.estimateCost({
    clientTaskId: 'test-key',
    prompt: 'test prompt',
    durationSec: 5,
    ratio: '9:16',
    shotId: 's1',
  })
  assert.match(cost, /0 元/)
  assert.match(cost, /自有显卡/)
})

test('ComfyUI 视频 Provider：离线环境 testConnection 应捕获并返回连接失败提示', async () => {
  const provider = new ComfyUIVideoProvider('http://127.0.0.1:9999')
  const result = await provider.testConnection()
  assert.equal(result.ok, false)
  assert.ok(result.error && result.error.length > 0)
})

test('ComfyUI 视频 Provider：getAsset 未就绪必须抛错，绝不伪造 output_*.mp4', async () => {
  const provider = new ComfyUIVideoProvider('http://127.0.0.1:8188')
  await assert.rejects(
    async () => {
      await provider.getAsset('never-submitted-task-id')
    },
    (err: any) => {
      return err instanceof Error && err.message.includes('尚未就绪')
    },
    '任务不存在或未就绪时不得伪造输出资产 URL'
  )
})

/* ------------------------------------------------------------------ *
 * Wan 2.2 TI2V-5B（本机实测跑通的预设）
 * 断言口径：节点类名 / 权重文件名 / 参数名与 `GET /object_info` 实测结果逐一对齐，
 * 任一处改名都会让测试失败（而不是等到提交 /prompt 才 400）。
 * ------------------------------------------------------------------ */

/** 2026-09-20 在 ComfyUI 0.36.0 上 GET /object_info 实测存在的节点类名 */
const VERIFIED_NODE_TYPES = new Set([
  'UNETLoader',
  'CLIPLoader',
  'VAELoader',
  'CLIPTextEncode',
  'Wan22ImageToVideoLatent',
  'KSampler',
  'VAEDecode',
  'CreateVideo',
  'SaveVideo',
  'LoadImage',
])

test('Wan 2.2 workflow：节点类名全部落在实测白名单内，且只用原生节点（不依赖 Kijai 插件）', () => {
  const wf = buildWan22Ti2vWorkflow({
    prompt: 'p',
    width: 480,
    height: 832,
    frames: 49,
    steps: 8,
    seed: 1,
  })
  const types = Object.values(wf).map((n) => (n as { class_type: string }).class_type)
  for (const t of types) {
    assert.ok(VERIFIED_NODE_TYPES.has(t), `节点 ${t} 未在实测白名单内（提交 /prompt 会失败）`)
  }
  // 负向：绝不能混入未验证的第三方插件节点
  for (const forbidden of ['WanVideoModelLoader', 'EmptyWanLatentVideo', 'VHS_VideoCombine']) {
    assert.ok(!types.includes(forbidden), `Wan 2.2 预设不得依赖第三方节点 ${forbidden}`)
  }
  assert.equal(types.length, 10)
  assert.equal(Object.values(wf).filter((n) => (n as { class_type: string }).class_type === 'SaveVideo').length, 1)
})

test('Wan 2.2 workflow：权重文件名与 /object_info 枚举一致（typo 会 400）', () => {
  const wf = buildWan22Ti2vWorkflow({ prompt: 'p', width: 704, height: 1280, frames: 121, steps: 20, seed: 7 })
  const inputs = Object.values(wf).map((n) => (n as { inputs: Record<string, unknown> }).inputs)
  assert.ok(inputs.some((i) => i.unet_name === 'wan2.2_ti2v_5B_fp16.safetensors'))
  assert.ok(inputs.some((i) => i.clip_name === 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'))
  assert.ok(inputs.some((i) => i.vae_name === 'wan2.2_vae.safetensors'))
  // CLIPLoader 的 type 必须是 wan（枚举里存在该值）
  assert.ok(inputs.some((i) => i.type === 'wan'))
  // SaveVideo 的 format 取 'mp4'（COMFY_DYNAMICCOMBO_V3 接受字符串）
  assert.ok(inputs.some((i) => i.format === 'mp4'))
})

test('Wan 2.2 workflow：文生视频不挂 start_image，图生视频才挂 LoadImage', () => {
  const t2v = buildWan22Ti2vWorkflow({ prompt: 'p', width: 480, height: 832, frames: 13, steps: 4, seed: 1 })
  const latent = t2v['6'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(latent.class_type, 'Wan22ImageToVideoLatent')
  assert.equal('start_image' in latent.inputs, false)
  assert.equal('11' in t2v, false)

  const i2v = buildWan22Ti2vWorkflow({
    prompt: 'p',
    width: 480,
    height: 832,
    frames: 13,
    steps: 4,
    seed: 1,
    startImageName: 'ref_1.png',
  })
  assert.deepEqual((i2v['6'] as { inputs: Record<string, unknown> }).inputs.start_image, ['11', 0])
  assert.deepEqual((i2v['11'] as { inputs: Record<string, unknown> }).inputs, { image: 'ref_1.png' })
})

test('Wan 2.2 帧数：始终落在 4n+1 网格上并夹在 [13, 档位上限]', () => {
  for (const [sec, max] of [
    [5, 121],
    [2, 49],
    [1, 61],
    [9, 121],
    [0.1, 121],
    [3, 49],
  ] as const) {
    const f = wan22FramesForDuration(sec, 24, max)
    assert.equal((f - 1) % 4, 0, `${sec}s → ${f} 不在 4n+1 网格上`)
    assert.ok(f >= 13 && f <= max, `${sec}s → ${f} 越界 (max=${max})`)
  }
  assert.equal(wan22FramesForDuration(5, 24, 121), 121)
  assert.equal(wan22FramesForDuration(2, 24, 49), 49)
  // 负向：超长时长必须被夹住而不是无限放大（10GB 显存护栏）
  assert.equal(wan22FramesForDuration(600, 24, 121), 121)
  // 非有限值不得产出 NaN
  assert.equal(wan22FramesForDuration(Number.NaN, 24, 121), 121)
})

test('质量档：分辨率是 32 的倍数（Wan22 VAE 16x 压缩 + 2x2 patchify 的硬约束）', () => {
  for (const tier of ['fast', 'standard', 'high'] as const) {
    const { width, height } = comfyTierResolution(tier)
    assert.equal(width % 32, 0, `${tier} 宽 ${width} 不是 32 的倍数`)
    assert.equal(height % 32, 0, `${tier} 高 ${height} 不是 32 的倍数`)
    const budget = comfyTierBudget(tier)
    assert.equal((budget.maxFrames - 1) % 4, 0, `${tier} maxFrames 不在 4n+1 网格上`)
    assert.ok(budget.steps > 0)
  }
  assert.deepEqual(comfyTierResolution('fast'), { width: 480, height: 832 })
  assert.deepEqual(comfyTierResolution('high'), { width: 704, height: 1280 })
  // 档位越高越贵：步数与帧数上限都不能倒退
  assert.ok(comfyTierBudget('fast').steps < comfyTierBudget('standard').steps)
  assert.ok(comfyTierBudget('standard').steps <= comfyTierBudget('high').steps)
  assert.ok(comfyTierBudget('fast').maxFrames < comfyTierBudget('high').maxFrames)
})

test('未知预设必须显式报错，绝不静默改用别的模型（负向验收）', () => {
  // 旧版本遗留值：UI 下拉框归一成默认（可渲染），但出片路径必须拒绝
  assert.equal(normalizeComfyPreset('cogvideox-5b'), 'wan2.2-ti2v-5b')
  assert.equal(normalizeComfyPreset('svd-xt'), 'wan2.2-ti2v-5b')
  assert.equal(normalizeComfyPreset('wan2.1-i2v'), 'wan2.1-i2v')
  assert.equal(isKnownComfyPreset('cogvideox-5b'), false)
  assert.equal(isKnownComfyPreset('wan2.2-ti2v-5b'), true)

  const stale = new ComfyUIVideoProvider('http://127.0.0.1:8188', { preset: 'cogvideox-5b' })
  assert.throws(
    () => stale.buildWorkflow(REQ),
    (err: unknown) => err instanceof Error && err.message.includes('cogvideox-5b'),
    '未知预设必须抛出含预设名的错误，而不是回落到 Wan 2.2'
  )
  assert.match(unknownPresetMessage('svd-xt'), /svd-xt/)
  assert.match(unknownPresetMessage('svd-xt'), /不会静默改用其它模型/)
})

test('预设归一：空值与脏值回落到已验证的默认预设，合法值原样保留', () => {
  assert.equal(normalizeComfyPreset(undefined), 'wan2.2-ti2v-5b')
  assert.equal(normalizeComfyPreset(null), 'wan2.2-ti2v-5b')
  assert.equal(normalizeComfyPreset(42), 'wan2.2-ti2v-5b')
  for (const p of ['wan2.2-ti2v-5b', 'minimax-h3', 'wan2.1-i2v', 'custom'] as ComfyUIWorkflowPreset[]) {
    assert.equal(normalizeComfyPreset(p), p)
  }
  assert.equal(normalizeComfyTier('fast'), 'fast')
  assert.equal(normalizeComfyTier('high'), 'high')
  assert.equal(normalizeComfyTier('ultra'), 'standard')
  assert.equal(normalizeComfyTier(undefined), 'standard')
})

test('缓存破坏参数：http 直链（自带 query）用 & 追加，绝不污染最后一个查询参数', () => {
  const view = buildComfyViewUrl('http://127.0.0.1:8188', { filename: 'a.mp4', subfolder: '', type: 'output' })
  assert.equal(view, 'http://127.0.0.1:8188/view?filename=a.mp4&subfolder=&type=output')
  const stamped = withCacheBuster(view, 123)
  assert.equal(stamped, 'http://127.0.0.1:8188/view?filename=a.mp4&subfolder=&type=output&v=123')
  // 负向：这正是修复前的 bug —— `...type=output?v=123` 会让 ComfyUI 找不到文件
  assert.ok(!stamped.includes('output?v='), '不得把 v 拼进最后一个查询参数')
  // 无 query 的引用仍用 ?
  assert.equal(withCacheBuster('idbref://canvas-asset-x', 7), 'idbref://canvas-asset-x?v=7')
})

test('/history 产物提取：videos/gifs/images 三类桶都认，无产物返回 null（继续轮询）', () => {
  assert.deepEqual(
    extractVideoOutput({ p1: { outputs: { '10': { videos: [{ filename: 'a.mp4', type: 'output' }] } } } }, 'p1'),
    { filename: 'a.mp4', subfolder: undefined, type: 'output' }
  )
  assert.deepEqual(
    extractVideoOutput({ p1: { outputs: { '10': { gifs: [{ filename: 'b.mp4', subfolder: 'x' }] } } } }, 'p1'),
    { filename: 'b.mp4', subfolder: 'x', type: undefined }
  )
  assert.deepEqual(
    extractVideoOutput({ p1: { outputs: { '10': { images: [{ filename: 'c.png' }] } } } }, 'p1'),
    { filename: 'c.png', subfolder: undefined, type: undefined }
  )
  // 负向：空桶 / 无 outputs / prompt_id 不匹配 → null（不能误判为完成）
  assert.equal(extractVideoOutput({ p1: { outputs: { '10': { videos: [] } } } }, 'p1'), null)
  assert.equal(extractVideoOutput({ p1: {} }, 'p1'), null)
  assert.equal(extractVideoOutput({ p1: { outputs: { '10': { videos: [{ filename: 'a.mp4' }] } } } }, 'p2'), null)
})

test('/object_info 解析：combo 输入取枚举，非 combo / 缺失返回 null', () => {
  const info = {
    UNETLoader: {
      input: {
        required: {
          unet_name: [['wan2.2_ti2v_5B_fp16.safetensors'], {}],
          weight_dtype: [['default', 'fp8_e4m3fn'], {}],
        },
      },
    },
    KSampler: { input: { required: { seed: ['INT', { default: 0 }] } } },
  }
  assert.deepEqual(comboOptionsOf(info, 'UNETLoader', 'unet_name'), ['wan2.2_ti2v_5B_fp16.safetensors'])
  assert.deepEqual(comboOptionsOf(info, 'UNETLoader', 'weight_dtype'), ['default', 'fp8_e4m3fn'])
  assert.equal(comboOptionsOf(info, 'KSampler', 'seed'), null)
  assert.equal(comboOptionsOf(info, 'NoSuchNode', 'x'), null)
})

test('依赖清单：wan2.2 预设的必需节点/权重与 workflow 实际用到的对得上', () => {
  const nodes = presetRequiredNodes('wan2.2-ti2v-5b')
  const wfTypes = new Set(
    Object.values(
      buildWan22Ti2vWorkflow({ prompt: 'p', width: 480, height: 832, frames: 13, steps: 4, seed: 1 })
    ).map((n) => (n as { class_type: string }).class_type)
  )
  for (const t of wfTypes) {
    assert.ok(nodes.includes(t), `依赖清单漏了 workflow 里用到的节点 ${t}（自检会漏报）`)
  }
  const models = presetRequiredModels('wan2.2-ti2v-5b')
  assert.equal(models.length, 3)
  for (const m of models) assert.match(m.value, /\.safetensors$/)
})

test('MiniMax H3【预留接口】：workflow 形状按内置模板对齐，含音画同步双 VAE/双解码', () => {
  const wf = buildMiniMaxH3Workflow({ prompt: 'p', width: 768, height: 1344, frames: 124, seed: 1 })
  const types = Object.values(wf).map((n) => (n as { class_type: string }).class_type)
  for (const t of ['MiniMaxH3ImageToVideo', 'VAEDecodeAudio', 'BasicGuider', 'SamplerCustomAdvanced', 'CreateVideo']) {
    assert.ok(types.includes(t), `MiniMax H3 预设缺少 ${t}`)
  }
  // 两个 VAELoader：视频 + 音频
  assert.equal(types.filter((t) => t === 'VAELoader').length, 2)
  // CreateVideo 必须同时接 images 与 audio
  const create = Object.values(wf).find((n) => (n as { class_type: string }).class_type === 'CreateVideo') as {
    inputs: Record<string, unknown>
  }
  assert.ok(Array.isArray(create.inputs.images) && Array.isArray(create.inputs.audio))
  // 未下载权重时也不得静默降级成别的模型：节点清单里必须是 minimax 权重名
  const unet = Object.values(wf).find((n) => (n as { class_type: string }).class_type === 'UNETLoader') as {
    inputs: Record<string, unknown>
  }
  assert.match(String(unet.inputs.unet_name), /minimax_h3/)
  // 帧数网格 17k+5
  assert.equal(minimaxH3FramesForDuration(5, 24), 124)
  assert.equal((minimaxH3FramesForDuration(2, 24) - 5) % 17, 0)
  assert.ok(presetRequiredNodes('minimax-h3').includes('VAEDecodeAudio'))
})

test('custom 预设：整值占位符替换（含嵌套数组/对象），未替换的占位符不得残留', () => {
  const json = JSON.stringify({
    '1': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{PROMPT}}', clip: ['2', 0], nested: { neg: '{{NEGATIVE}}', n: '{{FRAMES}}' } },
    },
    '2': { class_type: 'KSampler', inputs: { seed: '{{SEED}}', w: '{{WIDTH}}', list: ['{{FPS}}'] } },
  })
  const out = resolveCustomWorkflow(json, {
    prompt: 'hello',
    negative: 'bad',
    width: 480,
    height: 832,
    frames: 49,
    fps: 24,
    seed: 99,
  })
  const flat = JSON.stringify(out)
  assert.ok(!flat.includes('{{'), `占位符未全部替换: ${flat}`)
  assert.match(flat, /hello/)
  assert.match(flat, /"n":49/)
  assert.match(flat, /"seed":99/)
  assert.match(flat, /"list":\[24\]/)
  // 非占位符字符串原样保留
  assert.equal((out['1'] as { class_type: string }).class_type, 'CLIPTextEncode')
})

test('custom 预设：未提供工作流 JSON 时必须报错，而不是偷偷跑默认模型', () => {
  const provider = new ComfyUIVideoProvider('http://127.0.0.1:8188', { preset: 'custom', customWorkflowJson: '' })
  assert.throws(() => provider.buildWorkflow(REQ), (err: unknown) => err instanceof Error && /custom/.test(err.message))
  // 非法 JSON 也必须抛错（不能返回半成品）
  const bad = new ComfyUIVideoProvider('http://127.0.0.1:8188', {
    preset: 'custom',
    customWorkflowJson: '{ not json',
  })
  assert.throws(() => bad.buildWorkflow(REQ))
})

test('轮询窗口需求：high 档必须超过默认 10 分钟（否则 11 分钟镜头会被误判失败）', () => {
  // 默认轮询窗口 10 分钟（pollingConfig.DEFAULT_POLL_WINDOW_MINUTES）
  const DEFAULT_WINDOW_MINUTES = 10
  assert.equal(comfyRequiredWindowMinutes('fast'), 3)
  assert.equal(comfyRequiredWindowMinutes('standard'), 6)
  assert.equal(comfyRequiredWindowMinutes('high'), 12)

  // 核心回归：high 档需求必须严格大于默认窗口，否则「超时退款但上游还在跑」的假失败会复现
  assert.ok(
    comfyRequiredWindowMinutes('high') > DEFAULT_WINDOW_MINUTES,
    'high 档需求必须超过默认窗口（实测 655s > 600s）'
  )
  // 负向：低档位不该无谓抬窗口
  assert.ok(comfyRequiredWindowMinutes('fast') <= DEFAULT_WINDOW_MINUTES)
  assert.ok(comfyRequiredWindowMinutes('standard') <= DEFAULT_WINDOW_MINUTES)
  // 每个档位的窗口都必须覆盖自己的实测/估算耗时
  for (const tier of ['fast', 'standard', 'high'] as const) {
    assert.ok(
      comfyRequiredWindowMinutes(tier) * 60 > estimateShotSeconds(tier),
      `${tier} 档窗口不足以覆盖单镜耗时`
    )
  }
})

test('出片耗时估算：随档位单调递增，文案如实标注标定基准', () => {
  assert.ok(estimateShotSeconds('fast') < estimateShotSeconds('standard'))
  assert.ok(estimateShotSeconds('standard') < estimateShotSeconds('high'))
  const text = comfyEstimateText('high', 6)
  assert.match(text, /预计约/)
  assert.match(text, /RTX 3080/)
  assert.match(text, /6 镜/, '文案必须体现镜数（否则 6 镜等待时长会被低估）')
  // 0 镜按 1 镜兜底：不得产出 "0 分钟" 之类无意义结论
  assert.match(comfyEstimateText('fast', 0), /1 镜/)
  assert.match(comfyEstimateText('fast', -3), /1 镜/)
})

test('Provider 全链路（fetch 打桩）：submit → poll → getAsset，体积取 Content-Length 不写死', async () => {
  const calls: string[] = []
  const origFetch = globalThis.fetch
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method || 'GET'} ${url}`)
    if (url.endsWith('/prompt')) return json({ prompt_id: 'p1' })
    if (url.includes('/history/p1')) {
      return json({
        p1: {
          status: { status_str: 'success' },
          outputs: { '10': { videos: [{ filename: 'wls_00001_.mp4', subfolder: '', type: 'output' }] } },
        },
      })
    }
    if (url.includes('/view?')) return new Response(null, { status: 200, headers: { 'content-length': '123456' } })
    if (url.endsWith('/queue')) return json({ queue_running: [], queue_pending: [] })
    return json({})
  }) as typeof fetch

  try {
    const provider = new ComfyUIVideoProvider('http://127.0.0.1:8188', { preset: 'wan2.2-ti2v-5b', tier: 'fast' })
    const { taskId } = await provider.submit(REQ)
    assert.equal(taskId, 'p1')

    const polled = await provider.poll(taskId)
    assert.equal(polled.status, 'succeeded')

    const asset = await provider.getAsset(taskId)
    assert.equal(asset.shotId, 'story1-s1')
    assert.equal(asset.durationSec, 5)
    assert.match(asset.url, /\/view\?filename=wls_00001_\.mp4/)
    // 负向：旧实现写死 4MB（4194304）——真实体积必须来自响应头
    assert.notEqual(asset.sizeBytes, 1024 * 1024 * 4)
    assert.equal(asset.sizeBytes, 123456)
    // HEAD 探体积（不下载整个 mp4）
    assert.ok(calls.some((c) => c.startsWith('HEAD ')), calls.join(' | '))
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Provider 轮询：ComfyUI 报 error 状态 → failed（不得当成运行中或成功）', async () => {
  const origFetch = globalThis.fetch
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/prompt')) return json({ prompt_id: 'p2' })
    if (url.includes('/history/p2')) {
      return json({ p2: { status: { status_str: 'error', messages: [['execution_error', { node: '1' }]] } } })
    }
    if (url.endsWith('/queue')) return json({ queue_running: [], queue_pending: [] })
    return json({})
  }) as typeof fetch
  try {
    const provider = new ComfyUIVideoProvider('http://127.0.0.1:8188', { preset: 'wan2.2-ti2v-5b' })
    const { taskId } = await provider.submit(REQ)
    const polled = await provider.poll(taskId)
    assert.equal(polled.status, 'failed')
    assert.ok(polled.error && polled.error.length > 0)
    // 失败任务不得给出产物
    await assert.rejects(async () => provider.getAsset(taskId))
  } finally {
    globalThis.fetch = origFetch
  }
})

test('Provider 轮询：WS 无进度时如实不给数字（不编造递增假进度）', async () => {
  const origFetch = globalThis.fetch
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/prompt')) return json({ prompt_id: 'p3' })
    if (url.includes('/history/p3')) return json({})
    if (url.endsWith('/queue')) return json({ queue_running: [['0', 'p3', {}, {}, []]], queue_pending: [] })
    return json({})
  }) as typeof fetch
  try {
    const provider = new ComfyUIVideoProvider('http://127.0.0.1:8188', { preset: 'wan2.2-ti2v-5b' })
    const { taskId } = await provider.submit(REQ)
    for (let i = 0; i < 3; i++) {
      const r = await provider.poll(taskId)
      assert.equal(r.status, 'running')
      assert.equal(r.progress, undefined, '拿不到真实步进时不得给进度数字')
    }
  } finally {
    globalThis.fetch = origFetch
  }
})
