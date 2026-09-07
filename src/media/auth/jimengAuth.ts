/**
 * 即梦 (Jimeng) / 火山引擎 V4 HMAC-SHA256 请求签名（M2b 契约层）。
 *
 * 官方文档结构：
 * - X-Date: %Y%m%dT%H%M%SZ（UTC）
 * - X-Content-Sha256: sha256hex(请求体)；GET 请求为空体 hash
 * - CredentialScope: {shortDate}/{region}/{service}/request（默认 cn-north-1/cv）
 * - CanonicalRequest = Method \n URI \n Query \n CanonicalHeaders \n SignedHeaders \n HashedPayload
 * - StringToSign = "HMAC-SHA256" \n X-Date \n CredentialScope \n hex(sha256(CanonicalRequest))
 * - 派生密钥：HMAC(sk, date) → region → service → "request"
 * - Authorization: HMAC-SHA256 Credential={ak}/{scope}, SignedHeaders=..., Signature={hex}
 *
 * 实现说明：纯 WebCrypto（浏览器与 Node >=19 通用，零依赖），异步签名。
 */

export type JimengSignInput = {
  accessKey: string
  secretKey: string
  /** HTTP 方法，如 GET / POST */
  method: string
  /** 完整 host（含端口，如 api.jimeng.bytedance.com） */
  host: string
  /** 请求路径，以 / 开头（如 /v1/videos/text2video） */
  path: string
  /** 原始查询串（不含 '?'，可选；应为已编码的 k=v&k=v 形态） */
  query?: string
  /** 请求体原文（可选，GET 传 undefined） */
  body?: string
  /** 区域，默认 cn-north-1 */
  region?: string
  /** 服务名，默认 cv */
  service?: string
  /** X-Date（UTC，%Y%m%dT%H%M%SZ）；默认系统时间（测试注入用） */
  xDate?: string
  contentType?: string
}

export type JimengSignedHeaders = {
  'X-Date': string
  'X-Content-Sha256': string
  Authorization: string
}

const SIGNED_HEADER_KEYS = ['content-type', 'host', 'x-content-sha256', 'x-date']

async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('WebCrypto 不可用，无法生成即梦请求签名')
  const digest = await subtle.digest('SHA-256', data as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacSha256Hex(key: Uint8Array, data: string): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('WebCrypto 不可用，无法生成即梦请求签名')
  const enc = new TextEncoder()
  const cryptoKey = await subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await subtle.sign('HMAC', cryptoKey, enc.encode(data) as unknown as ArrayBuffer)
  return new Uint8Array(sig)
}

async function hmacHex(key: Uint8Array, data: string): Promise<string> {
  const bytes = await hmacSha256Hex(key, data)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function utcXDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  )
}

/** 构造即梦官方 API 的 V4 签名请求头（X-Date / X-Content-Sha256 / Authorization） */
export async function buildJimengSignedHeaders(input: JimengSignInput): Promise<JimengSignedHeaders> {
  const {
    accessKey,
    secretKey,
    method,
    host,
    path,
    query = '',
    body = '',
    region = 'cn-north-1',
    service = 'cv',
    contentType = 'application/json',
  } = input

  if (!accessKey.trim() || !secretKey.trim()) {
    throw new Error('即梦 V4 签名需要 access_key 与 secret_key')
  }

  const xDate = input.xDate || utcXDate(new Date())
  const shortDate = xDate.slice(0, 8)
  const hashedPayload = await sha256Hex(new TextEncoder().encode(body))

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host.toLowerCase()}\n` +
    `x-content-sha256:${hashedPayload}\n` +
    `x-date:${xDate}\n`
  const signedHeaders = SIGNED_HEADER_KEYS.join(';')

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n')

  const credentialScope = `${shortDate}/${region}/${service}/request`
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join('\n')

  const kDate = await hmacSha256Hex(new TextEncoder().encode(secretKey), shortDate)
  const kRegion = await hmacSha256Hex(kDate, region)
  const kService = await hmacSha256Hex(kRegion, service)
  const kSigning = await hmacSha256Hex(kService, 'request')
  const signature = await hmacHex(kSigning, stringToSign)

  return {
    'X-Date': xDate,
    'X-Content-Sha256': hashedPayload,
    Authorization: `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}
