# AIWorkspace 教学系统 —— 多阶段构建，产物为 Next.js standalone，容器内监听 3100
# 构建：docker build -t aiworkspace .
# 运行：docker run --rm -p 3100:3100 -v aiworkspace-data:/data -e AUTH_SECRET=... aiworkspace
#
# 说明：默认通过国内镜像（docker.m.daocloud.io）拉取 node 基础镜像；
# 能直连 Docker Hub 时可加 --build-arg BASE_IMAGE=node:22-alpine 覆盖。

ARG BASE_IMAGE=docker.m.daocloud.io/library/node:22-alpine

FROM ${BASE_IMAGE} AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
# Prisma 引擎下载走国内镜像（直连 binaries.prisma.sh 在部分网络下会超时）
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma

# ---------- 依赖 ----------
FROM base AS deps
# 国内网络可加 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry ${NPM_REGISTRY}
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---------- 构建 ----------
FROM base AS builder
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry ${NPM_REGISTRY}
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .
# 构建期不需要真实数据库，给 Prisma 一个占位 URL
ENV DATABASE_URL="file:/tmp/build.db"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ---------- 迁移工具（Prisma CLI 单独装一份，避免把 devDependencies 带进运行镜像） ----------
FROM base AS prisma-cli
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry ${NPM_REGISTRY} \
  && mkdir -p /prisma-cli \
  && cd /prisma-cli \
  && npm init -y >/dev/null \
  && npm install prisma@6.19.3 --no-audit --no-fund

# ---------- 运行 ----------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /data \
  && chown -R nextjs:nodejs /data

# Next standalone 产物
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma：生成的客户端 + 查询引擎（运行时），以及独立的迁移 CLI
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=prisma-cli --chown=nextjs:nodejs /prisma-cli/node_modules ./prisma-cli/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

COPY --chmod=755 docker/entrypoint.sh ./docker/entrypoint.sh

USER nextjs
EXPOSE 3100

ENTRYPOINT ["./docker/entrypoint.sh"]
