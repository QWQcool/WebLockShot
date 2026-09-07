# WebLockShot 生产镜像（多阶段构建）
# 阶段 1：构建前端（React 19 + Vite 8）；阶段 2：伴生 server 运行层（静态托管 + /api 反代）

# ---------- 阶段 1：前端构建 ----------
FROM node:22-alpine AS build
WORKDIR /app

# 先装依赖，最大化层缓存
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

# 产物输出到 /app/dist
RUN npm run build

# ---------- 阶段 2：运行层 ----------
FROM node:22-alpine
WORKDIR /app

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
