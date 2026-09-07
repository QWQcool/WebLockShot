import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { signKlingJwt, signKlingJwtParts } from '../auth/klingJwt.ts'
import { buildJimengSignedHeaders } from '../auth/jimengAuth.ts'

/**
 * 契约向量测试（M2b）。
 *
 * 期望值由独立参考实现（Node 内置 node:crypto HMAC）预先计算，
 * 与被测实现（WebCrypto HMAC，浏览器/Node 通用路径）完全解耦：
 * 断言既锁定完整字符串向量，也用 node:crypto 独立重算签名做交叉验证。
 */

const AK = 'AKTEST'
const SK = 'SKTEST'
const EXP = 1700000000
const NBF = 1699998195

// 由 node:crypto 参考实现预计算的完整向量（锁定回归）
const KLING_HS512_VECTOR =
  'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJBS1RFU1QiLCJleHAiOjE3MDAwMDAwMDAsIm5iZiI6MTY5OTk5ODE5NX0.T4g46J2riYmiDuyYSJuE_fKu2A1c2sYHkIvsFoqsHozDWssIJ5qrddp8j_KntJ3GdBlGzhQeDyWmZ3a-WAeGzg'
const KLING_HS256_VECTOR =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJBS1RFU1QiLCJleHAiOjE3MDAwMDAwMDAsIm5iZiI6MTY5OTk5ODE5NX0.A2bYaaDeOQzPM2b6OXaoKkUYylpBeRpRCNTSitmv3DI'

const JIMENG_EXPECTED_AUTH =
  'HMAC-SHA256 Credential=AKTEST/20260907/cn-north-1/cv/request, ' +
  'SignedHeaders=content-type;host;x-content-sha256;x-date, ' +
  'Signature=b1bc52019a142a96e927944c71f9e8dc104b8e700d6ce9c56bc860fa132c0580'

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

test('可灵 JWT：HS512 完整向量锁定（官方文档头/载荷结构）', async () => {
  const token = await signKlingJwt(AK, SK, { exp: EXP, nbf: NBF })
  assert.equal(token, KLING_HS512_VECTOR)
})

test('可灵 JWT：HS256 变体向量锁定', async () => {
  const token = await signKlingJwt(AK, SK, { exp: EXP, nbf: NBF, alg: 'HS256' })
  assert.equal(token, KLING_HS256_VECTOR)
})

test('可灵 JWT：三段结构解析 + node:crypto 独立交叉验证签名', async () => {
  const parts = await signKlingJwtParts(AK, SK, { exp: EXP, nbf: NBF })
  assert.deepEqual(parts.header, { alg: 'HS512', typ: 'JWT' })
  assert.deepEqual(parts.payload, { iss: AK, exp: EXP, nbf: NBF })

  const [h, p, s] = parts.token.split('.')
  assert.equal(parts.signature, s)

  // 独立参考实现重算 HMAC-SHA512
  const expected = b64url(createHmac('sha512', SK).update(`${h}.${p}`).digest())
  assert.equal(s, expected)
})

test('可灵 JWT：默认 exp=now+1800 / nbf=now-5（官方文档 TTL 语义）', async () => {
  const now = 1757280000
  const parts = await signKlingJwtParts(AK, SK, { now })
  assert.equal(parts.payload.exp, now + 1800)
  assert.equal(parts.payload.nbf, now - 5)
})

test('可灵 JWT：空凭证拒绝签名', async () => {
  await assert.rejects(() => signKlingJwt('', SK), /access_key/)
  await assert.rejects(() => signKlingJwt(AK, '  '), /secret_key/)
})

test('即梦 V4 签名：完整向量锁定（GET + 空请求体）', async () => {
  const headers = await buildJimengSignedHeaders({
    accessKey: AK,
    secretKey: SK,
    method: 'GET',
    host: 'api.jimeng.bytedance.com',
    path: '/v1/videos/tasks/probe-task',
    query: 'page=1',
    xDate: '20260907T000000Z',
  })

  assert.equal(headers['X-Date'], '20260907T000000Z')
  // 空请求体 sha256 = e3b0c442...（SHA-256 空串标准向量）
  assert.equal(
    headers['X-Content-Sha256'],
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  )
  assert.equal(headers.Authorization, JIMENG_EXPECTED_AUTH)
})

test('即梦 V4 签名：POST 带请求体的 X-Content-Sha256 为 body 摘要', async () => {
  const body = JSON.stringify({ prompt: 'hello' })
  const headers = await buildJimengSignedHeaders({
    accessKey: AK,
    secretKey: SK,
    method: 'POST',
    host: 'api.jimeng.bytedance.com',
    path: '/v1/videos/text2video',
    xDate: '20260907T000000Z',
    body,
  })

  const digest = createHash('sha256').update(body).digest('hex')
  assert.equal(headers['X-Content-Sha256'], digest)
  assert.match(headers.Authorization, /^HMAC-SHA256 Credential=AKTEST\/20260907\/cn-north-1\/cv\/request, /)
})

test('即梦 V4 签名：Authorization 结构符合火山引擎 V4 规范', async () => {
  const headers = await buildJimengSignedHeaders({
    accessKey: AK,
    secretKey: SK,
    method: 'GET',
    host: 'api.jimeng.bytedance.com',
    path: '/v1/videos/tasks/t1',
    xDate: '20260907T000000Z',
  })
  assert.match(headers.Authorization, /^HMAC-SHA256 Credential=AKTEST\/\d{8}\/cn-north-1\/cv\/request, /)
  assert.match(headers.Authorization, /SignedHeaders=content-type;host;x-content-sha256;x-date, /)
  assert.match(headers.Authorization, /Signature=[0-9a-f]{64}$/)
})

test('即梦 V4 签名：空凭证拒绝签名', async () => {
  await assert.rejects(
    () =>
      buildJimengSignedHeaders({
        accessKey: '',
        secretKey: SK,
        method: 'GET',
        host: 'api.jimeng.bytedance.com',
        path: '/v1/videos/tasks/t1',
      }),
    /access_key/
  )
})
