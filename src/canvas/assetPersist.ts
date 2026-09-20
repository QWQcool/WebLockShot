import { IDB_REF_PREFIX, putBlobAsset } from '../persist/assetStore.ts'

/**
 * P0 产物持久化：把**上游 http(s) 直链**产物（本地 ComfyUI 的 `/view`）转存到本地 IndexedDB。
 *
 * 为什么必须做：出片产物原本只存 `/view` URL，一旦 ComfyUI 清了 output 目录、换机器、或服务没开，
 * 画布产物卡与「打包剪映草稿」立刻变死链 —— 而一个 6 镜项目是**约 1 小时算力**换来的。
 * 转存后 url 变成 `idbref://`（与 Mock 产物同一条通路），离线可播、可打包。
 *
 * 设计要点：
 * - **绝不因转存失败而判任务失败**：拿不到本地副本时保留原直链，并用 `persistedLocally: false`
 *   把「这个产物依赖上游在线」如实告诉 UI（宁可标清楚，也不假装已持久化）。
 * - 依赖全部可注入（fetch / putBlobAsset），以便在 node --test 里覆盖各条失败分支。
 * - 上限兜底：超过 `ASSET_PERSIST_MAX_BYTES` 不下载（避免把几百 MB 拖进内存与 IndexedDB 配额）。
 */

/** 本地转存体积上限（单条产物）。5s / 704×1280 实测仅 1.29 MB，256 MB 是安全余量 */
export const ASSET_PERSIST_MAX_BYTES = 256 * 1024 * 1024

/** 只有外部 http(s) 直链需要转存（idbref 已是本地副本；blob: 由调用方的既有分支处理） */
export function shouldPersistUpstreamUrl(url: string): boolean {
  return /^https?:\/\//.test(url)
}

/** 体积是否在转存上限内（纯函数；非有限值一律拒绝，不拿 NaN 当通过） */
export function withinPersistSizeLimit(bytes: number, max: number = ASSET_PERSIST_MAX_BYTES): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= max
}

export type PersistOutcome = {
  /** 最终用于落档的引用：转存成功 = `idbref://<key>`；否则原 url 原样保留 */
  ref: string
  /** true = ref 指向本地 IndexedDB 副本；false = 未转存（依赖上游服务在线） */
  persistedLocally: boolean
  /** 未转存时的人话原因（日志与 UI 如实呈现，绝不静默跳过） */
  reason?: string
}

export type PersistDeps = {
  fetchImpl?: typeof fetch
  putBlobAsset?: (id: string, blob: Blob) => Promise<string | null>
  maxBytes?: number
}

/**
 * 把上游直链产物转存为本地 `idbref://` 引用。
 * 任何失败都**不抛错**，而是回退到原直链 + `persistedLocally: false` + `reason`。
 */
export async function persistUpstreamArtifact(
  url: string,
  key: string,
  options: { declaredSizeBytes?: number; deps?: PersistDeps } = {}
): Promise<PersistOutcome> {
  const { declaredSizeBytes, deps = {} } = options
  const maxBytes = deps.maxBytes ?? ASSET_PERSIST_MAX_BYTES

  // 已是本地引用：直接判为已持久化（重复出片时不必再拉一遍）。
  // 刻意用 startsWith 而非 `isIdbRef` 类型谓词：后者在 else 分支会把 string 收窄成 never。
  if (url.startsWith(IDB_REF_PREFIX)) return { ref: url, persistedLocally: true }

  if (!shouldPersistUpstreamUrl(url)) {
    return {
      ref: url,
      persistedLocally: false,
      reason: `产物引用不是 http(s) 直链（${url.slice(0, 12)}…），无法转存本地`,
    }
  }

  // 上游已声明的体积（provider 的 HEAD content-length）先拦一道，避免白下载大文件
  if (declaredSizeBytes !== undefined && !withinPersistSizeLimit(declaredSizeBytes, maxBytes)) {
    return {
      ref: url,
      persistedLocally: false,
      reason: `产物约 ${(declaredSizeBytes / 1024 / 1024).toFixed(1)}MB 超过本地转存上限 ${(
        maxBytes /
        1024 /
        1024
      ).toFixed(0)}MB，保留直链`,
    }
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const put = deps.putBlobAsset ?? putBlobAsset

  let blob: Blob
  try {
    const resp = await fetchImpl(url)
    if (!resp.ok) {
      return { ref: url, persistedLocally: false, reason: `拉取上游产物失败（HTTP ${resp.status}），保留直链` }
    }
    blob = await resp.blob()
  } catch (err) {
    return {
      ref: url,
      persistedLocally: false,
      reason: `拉取上游产物失败（${err instanceof Error ? err.message : '网络错误'}），保留直链`,
    }
  }

  if (!withinPersistSizeLimit(blob.size, maxBytes)) {
    return {
      ref: url,
      persistedLocally: false,
      reason: `产物 ${(blob.size / 1024 / 1024).toFixed(1)}MB 超过本地转存上限，保留直链`,
    }
  }

  const stored = await put(key, blob)
  if (!stored) {
    return {
      ref: url,
      persistedLocally: false,
      reason: '本地存储写入失败（可能是隐私模式或配额不足），保留直链',
    }
  }
  return { ref: stored, persistedLocally: true }
}
