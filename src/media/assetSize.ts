/**
 * 视频资产真实体积探测 (Asset Size Probe)
 *
 * 下载远端视频为 Blob，用真实 blob.size 替换硬编码估算值；
 * 浏览器环境下同时将 URL 换成本地 objectURL，便于播放与后续 zip 打包。
 */

export type ProbedAsset = {
  /** 浏览器环境返回 blob: 本地地址；无法下载或非浏览器环境返回原始 URL */
  url: string
  /** 真实字节体积；探测失败时为 undefined */
  sizeBytes?: number
}

export async function probeVideoBlob(url: string): Promise<ProbedAsset> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      return { url }
    }
    const blob = await resp.blob()
    if (!blob || blob.size <= 0) {
      return { url }
    }

    // 浏览器环境：换成本地 objectURL，播放与导出不再依赖远端
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try {
        return { url: URL.createObjectURL(blob), sizeBytes: blob.size }
      } catch {
        // createObjectURL 失败（如非安全上下文），保留远端 URL
      }
    }
    return { url, sizeBytes: blob.size }
  } catch {
    // 网络/环境原因下载失败：如实返回原始 URL 与 undefined 体积，不伪造数据
    return { url }
  }
}
