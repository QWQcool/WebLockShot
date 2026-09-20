/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// vitest 运行时不加载 PWA 插件（virtual module 与 jsdom 测试环境不兼容）
const pwaPlugins =
  process.env.VITEST
    ? []
    : [
        VitePWA({
          registerType: 'prompt',
          includeAssets: ['favicon.svg', 'icons.svg'],
          manifest: {
            name: 'WEB锁镜 WebLockShot',
            short_name: 'WEB锁镜',
            description: '多 Agent 电商带货视频工作台：六镜锁定爆款结构，直连可灵/即梦/ComfyUI 出片',
            lang: 'zh-CN',
            theme_color: '#22d3ee',
            background_color: '#0b0f14',
            display: 'standalone',
            start_url: '.',
            icons: [
              { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
              { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: {
            navigateFallback: 'index.html',
            globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff2}'],
            // 引擎反代与会话 API 不走 SW 缓存，永远直连
            navigateFallbackDenylist: [/^\/api\//],
            runtimeCaching: [],
          },
        }),
      ]

export default defineConfig({
  plugins: [react(), ...pwaPlugins],
  base: process.env.GITHUB_PAGES ? '/WebLockShot/' : '/',
  server: {
    proxy: {
      '/api/kling': {
        target: 'https://api.klingai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kling/, ''),
      },
      '/api/jimeng': {
        target: 'https://api.jimeng.bytedance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/jimeng/, ''),
      },
      '/api/comfyui': {
        target: 'http://127.0.0.1:8188',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/comfyui/, ''),
        // ComfyUI 新版会对「回环 Host + Origin」做一致性校验：只要两个头都在且域名不一致就 403
        // （防任意网页 POST 到 127.0.0.1 排队任务）。dev 代理必须与伴生服务同口径地把
        // origin/referer 摘掉，否则本地开发一样会被自家 ComfyUI 拒绝。
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
          })
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.ui.test.tsx', 'src/**/*.ui.test.ts'],
  },
})
