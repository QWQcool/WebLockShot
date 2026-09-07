/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
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
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.ui.test.tsx', 'src/**/*.ui.test.ts'],
  },
})
