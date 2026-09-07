/// <reference types="@tarojs/taro" />

declare module '*.png'
declare module '*.gif'
declare module '*.jpg'
declare module '*.jpeg'
declare module '*.svg'
declare module '*.css'
declare module '*.scss'

declare namespace NodeJS {
  interface ProcessEnv {
    /** 后端 /api 反代基地址（伴生 server 或云端网关）；未配置时回退本地开发地址 */
    TARO_APP_API_BASE?: string
  }
}
