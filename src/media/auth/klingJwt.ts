/**
 * 可灵 (Kling) JWT 签名生成（M2b 契约层）。
 *
 * 官方文档头/载荷结构：
 * - header:  {"alg":"HS512","typ":"JWT"}（官方也支持 HS256，可通过参数切换）
 * - payload: {"iss": access_key, "exp": now+1800, "nbf": now-5}
 * - 签名：HMAC-SHA512(secret_key, base64url(header)+"."+base64url(payload))
 *
 * 实现说明：纯 WebCrypto（浏览器与 Node >=19 通用，零依赖），异步签名。
 * 请求头为 `Authorization: <JWT>`（无需 Bearer 前缀）。
 */

export type KlingJwtAlg = 'HS256' | 'HS512'

const KLING_DEFAULT_TTL_SEC = 1800
const KLING_NBF_BACKDATE_SEC = 5

export type KlingJwtOptions = {
  /** 过期时间戳（秒）；默认 now + 1800 */
  exp?: number
  /** 生效时间戳（秒）；默认 now - 5 */
  nbf?: number
  /** 当前时间戳（秒）；默认系统时间（测试注入用） */
  now?: number
  alg?: KlingJwtAlg
}

export type KlingJwtParts = {
  header: { alg: KlingJwtAlg; typ: 'JWT' }
  payload: { iss: string; exp: number; nbf: number }
  signature: string
  token: string
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  // eslint-disable-next-line no-restricted-globals -- btoa 在浏览器与 Node>=16 均为全局标准 API
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlEncodeString(text: string): string {
  return base64UrlEncode(new TextEncoder().encode(text))
}

async function hmacSha(alg: KlingJwtAlg, key: string, data: string): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('WebCrypto 不可用，无法生成可灵 JWT 签名')
  }
  const enc = new TextEncoder()
  const cryptoKey = await subtle.importKey(
    'raw',
    enc.encode(key) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: alg === 'HS512' ? 'SHA-512' : 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await subtle.sign('HMAC', cryptoKey, enc.encode(data) as unknown as ArrayBuffer)
  return new Uint8Array(sig)
}

/** 生成可灵官方 API 的 JWT 鉴权串（Authorization 头直接使用，无 Bearer 前缀） */
export async function signKlingJwt(
  accessKey: string,
  secretKey: string,
  opts: KlingJwtOptions = {}
): Promise<string> {
  const parts = await signKlingJwtParts(accessKey, secretKey, opts)
  return parts.token
}

/** 返回完整三段式结构与 token（契约测试用） */
export async function signKlingJwtParts(
  accessKey: string,
  secretKey: string,
  opts: KlingJwtOptions = {}
): Promise<KlingJwtParts> {
  if (!accessKey.trim() || !secretKey.trim()) {
    throw new Error('可灵 JWT 签名需要 access_key 与 secret_key')
  }

  const alg: KlingJwtAlg = opts.alg || 'HS512'
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const exp = opts.exp ?? now + KLING_DEFAULT_TTL_SEC
  const nbf = opts.nbf ?? now - KLING_NBF_BACKDATE_SEC

  const header = { alg, typ: 'JWT' } as const
  const payload = { iss: accessKey, exp, nbf }

  const headerB64 = base64UrlEncodeString(JSON.stringify(header))
  const payloadB64 = base64UrlEncodeString(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`

  const signatureBytes = await hmacSha(alg, secretKey, signingInput)
  const signature = base64UrlEncode(signatureBytes)

  return { header, payload, signature, token: `${signingInput}.${signature}` }
}
