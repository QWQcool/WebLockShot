# WebLockShot 生产镜像（多阶段构建）
# 阶段 1：构建前端（React 19 + Vite 8）；阶段 2：伴生 server 运行层（静态托管 + /api 反代）

# ---------- 阶段 1：前端构建 ----------
# 用 glibc 基础镜像：better-sqlite3（devDependency，仅测试用，前端构建并不需要它）
# 在 alpine/musl 下无预编译二进制，会触发 node-gyp 源码编译且缺 Python 而失败；
# glibc 下优先下载预编译产物，工具链仅作源码编译兜底，保证 npm ci 永不因原生模块失败
FROM node:22-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# 先装依赖，最大化层缓存
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
# src/presets/load.ts 以相对路径引用仓库根 presets/ 下的剧情 JSON，构建必需
COPY presets ./presets
# src/ai/prompts.ts 以 ?raw 引用 .cursor/skills/shot-stage/SKILL.md，构建必需
COPY .cursor ./.cursor

# 产物输出到 /app/dist
RUN npm run build

# ---------- 阶段 2：运行层 ----------
FROM node:22-alpine
WORKDIR /app

# ffmpeg：/api/render 服务端成片合成依赖（WLS_FFMPEG=auto 默认启用，探测到即 on）
RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production \
    PORT=5174

# 运行时依赖：pino（dependencies）；better-sqlite3 为 devDependency 不会进入镜像，
# WLS_STORAGE=sqlite 在容器内经 node:sqlite（>=22.5）或额外安装 better-sqlite3 生效
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY --from=build /app/dist ./dist

# 可选挂载：WLS_STORAGE=sqlite 时持久化 /app/data；剪映草稿落盘 /app/jianying-drafts
VOLUME ["/app/data", "/app/jianying-drafts"]

EXPOSE 5174

CMD ["node", "server/weblockshot-server.mjs"]
