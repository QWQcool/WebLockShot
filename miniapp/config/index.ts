import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import path from 'node:path'

/**
 * 小程序构建配置（M3）。
 *
 * 关键点：
 * - @domain 别名直接指向主仓 ../src/domain（零依赖 domain 模块：钱包/FSM/幂等/轮询配置），
 *   src 层面不做任何改动，miniapp 内只做 adapter；
 * - TARO_APP_API_BASE 经 defineConstants 注入（构建期确定），
 *   指向伴生 server / 云端网关的 /api 反代基地址。
 */

// https://taro-docs.jd.com/docs/next/config#defineconfig-辅助函数
export default defineConfig(async () => {
  const baseConfig: UserConfigExport = {
    projectName: 'weblockshot-miniapp',
    date: '2026-9-7',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: [],
    defineConstants: {
      'process.env.TARO_APP_API_BASE': JSON.stringify(process.env.TARO_APP_API_BASE || ''),
    },
    framework: 'react',
    compiler: 'webpack5',
    mini: {
      // 别名指向 sourceRoot 之外的 TS 源码，必须纳入 babel 编译规则（Taro 官方 compile.include）
      compile: {
        include: [path.resolve(__dirname, '..', '..', 'src', 'domain')],
      },
      webpackChain(chain) {
        // miniapp/config → 主仓根 → src/domain（零依赖领域模块直接复用）
        const domainDir = path.resolve(__dirname, '..', '..', 'src', 'domain')
        chain.resolve.alias.set('@domain', domainDir)
        chain.resolve.alias.set('@api', path.resolve(__dirname, '..', 'src', 'api'))
      },
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
        },
      },
    },
    h5: {},
  }

  return baseConfig
})
