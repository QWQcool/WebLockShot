# WEB锁镜 小程序轻端（miniapp）

Taro 4 + React 18 的微信小程序（weapp）轻端。与主仓共享 `src/domain` 零依赖领域模块（轮询配置等），通过 `@domain` 别名引用，**主仓 src 层面零改动**。

## 能力边界（诚实标注）

小程序端**不做**以下能力（对应主仓桌面/纯前端专属）：

| 能力 | 原因 |
|---|---|
| 剪映草稿导出 / 工程包下载 | 需要桌面文件系统与剪映目录访问能力，小程序沙箱不可达 |
| Mock 实验画布引擎 | Mock 依赖浏览器录制与 IndexedDB 资产体系，小程序端不复制该体系 |
| GSAP / 桌面动效体系 | 轻端保持原生渲染，无 web 动画栈 |
| 虚拟钱包 / 回流看板 | 桌面端模拟经营玩法，轻端聚焦「录入 → 出片 → 看片」主链路 |

## 三页功能

1. **index 商品录入**：表单（商品名称 + 卖点）+ `Taro.chooseMedia` 首帧图（本地转 dataURL，图生视频）
2. **progress 任务进度**：复用主仓 `domain/pollingConfig`（轮询窗口 + pollSleep；小程序无 document 自动退化为普通 sleep）轮询 `/api/kling` 反代
3. **result 看片交付**：`Taro Video` 播放 + 复制视频链接（引导回桌面端做剪映交付）

## 后端依赖（部署前必读）

- 所有任务请求走 `TARO_APP_API_BASE` 指向的后端 `/api` 反代（伴生 server 或云端网关）；
- **小程序端不持有任何 API Key**——服务端通过 `WLS_KEYS` 注入真实密钥；未配置 `WLS_KEYS` 时为透传模式，远端将显式返回 401；
- 密钥管理、任务编排、计费等完整后端能力属预留层（见主仓 `src/services/backend/` 与 server `WLS_*` 配置）。

构建时注入：`TARO_APP_API_BASE=https://your-backend.example.com npm run build:weapp`

## 部署要求（微信小程序平台）

- **企业主体小程序账号**：`request` 合法域名要求 HTTPS + ICP 备案域名；`touristappid`（游客模式）仅限本地开发工具预览
- **request 合法域名**：在小程序后台将 `TARO_APP_API_BASE` 的域名加入 request 合法域名列表
- **web-view 说明**：如需跳转 H5 版工作台，需配置业务域名并使用 `web-view` 组件（企业主体才可用）；本轻端未使用 web-view，三页均为原生页面
- 个人主体账号无法使用 web-view 与部分高级接口

## 构建

```bash
cd miniapp
npm install          # 依赖完全独立，不污染主仓 package.json
npm run build:weapp  # 产物输出 miniapp/dist/（不依赖微信开发者工具即可完成编译）
npm run dev:weapp    # watch 模式
```

构建产物结构校验：`dist/app.json`、`dist/pages/{index,progress,result}/`、`project.config.json`（`miniprogramRoot: "dist/"`）。

用微信开发者工具打开 `miniapp/` 目录即可预览（游客模式可本地预览，真机预览需真实 appid）。
