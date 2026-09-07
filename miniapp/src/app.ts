import { PropsWithChildren } from 'react'
import './app.scss'

/**
 * WEB锁镜 小程序轻端（M3）。
 *
 * 能力边界（诚实标注，详见 miniapp/README.md）：
 * - 只做「录入商品 → 提交任务 → 轮询进度 → 看片」四步轻流程；
 * - 不做剪映草稿导出、不做 Mock 引擎、不引入 GSAP/桌面动画体系；
 * - 任务经后端 /api 反代提交（密钥由服务端 WLS_KEYS 注入），小程序端不持有密钥。
 */
function App({ children }: PropsWithChildren<any>) {
  return children
}

export default App
