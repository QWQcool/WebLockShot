/**
 * 伴生服务探测与调用客户端（P1-3）
 *
 * 设计原则（「预留接口做好不用」）：
 * - 相对路径 fetch /healthz 探测伴生服务；不可达（纯前端模式）→ 能力位全 false，UI 不显示新按钮
 * - healthz capabilities 含 draft-zip → 显示「发送到伴生服务落盘」按钮
 * - 所有调用失败优雅降级：返回 Result 对象，不抛异常打断主流程
 */

export type CompanionCapabilities = {
  /** 伴生服务可达 */
  available: boolean
  /** 支持 POST /api/jianying/draft-zip 落盘 */
  draftZip: boolean
}

export type CompanionProbeResult = CompanionCapabilities & {
  version?: string
}

export type DraftZipSendResult =
  | { ok: true; savedPath: string; files: string[] }
  | { ok: false; error: string }

/**
 * 探测伴生服务能力（相对路径，同源部署；开发模式下走 Vite 反代同源）。
 * 任何网络异常/非 200 → 不可达，与现状（纯前端）行为一致。
 */
export async function probeCompanion(): Promise<CompanionProbeResult> {
  try {
    const res = await fetch('/healthz', { method: 'GET' })
    if (!res.ok) {
      return { available: false, draftZip: false }
    }
    const body = (await res.json()) as Record<string, unknown>
    // 伴生 server 存在即具备 draft-zip 端点（自 v0.1 起可用）
    return {
      available: true,
      draftZip: true,
      version: typeof body.version === 'string' ? body.version : undefined,
    }
  } catch {
    return { available: false, draftZip: false }
  }
}

/**
 * 把剪映草稿 zip 字节发送到伴生服务落盘。
 * 成功返回 { ok: true, savedPath, files }；失败返回 { ok: false, error }。
 */
export async function sendDraftZipToCompanion(zipBytes: Uint8Array): Promise<DraftZipSendResult> {
  try {
    const copy = new Uint8Array(zipBytes)
    const res = await fetch('/api/jianying/draft-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: copy.buffer as ArrayBuffer,
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; savedPath?: string; dir?: string; files?: string[]; error?: string } | null

    if (!res.ok || !body) {
      return { ok: false, error: body?.error || `伴生服务返回 HTTP ${res.status}` }
    }
    const savedPath = body.savedPath || body.dir
    if (!savedPath) {
      return { ok: false, error: '伴生服务响应缺少 savedPath 字段' }
    }
    return { ok: true, savedPath, files: Array.isArray(body.files) ? body.files : [] }
  } catch (err) {
    return { ok: false, error: `伴生服务不可达：${err instanceof Error ? err.message : String(err)}` }
  }
}
