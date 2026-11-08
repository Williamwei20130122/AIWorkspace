# AIWorkspace 教学系统 —— Go 后端 + Vite React 前端，单容器部署，宿主机 3100 端口
#
# 构建：docker build -t aiworkspace .
# 运行：docker run --rm -p 3100:3100 -v aiworkspace-data:/data -e AUTH_SECRET=... aiworkspace
#
# 网络说明：默认通过国内镜像拉取基础镜像；可覆盖：
#   --build-arg BASE_NODE=node:22-alpine --build-arg BASE_GO=golang:1.27-alpine --build-arg BASE_RUN=alpine:3.22
#   --build-arg NPM_REGISTRY=https://registry.npmmirror.com --build-arg GOPROXY=https://proxy.golang.org,direct

ARG BASE_NODE=docker.m.daocloud.io/library/node:22-alpine
ARG BASE_GO=docker.m.daocloud.io/library/golang:1.27-alpine
ARG BASE_RUN=docker.m.daocloud.io/library/alpine:3.22

# ---------- 前端构建 ----------
FROM ${BASE_NODE} AS web-build
WORKDIR /web
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry ${NPM_REGISTRY}
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 后端构建（go:embed 内嵌前端产物） ----------
FROM ${BASE_GO} AS go-build
WORKDIR /src
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}
ENV CGO_ENABLED=0
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web-build /web/dist ./webdist
RUN go build -trimpath -ldflags="-s -w" -o /out/aiworkspace ./cmd/server

# ---------- 运行 ----------
FROM ${BASE_RUN} AS runner
RUN addgroup -S app \
  && adduser -S app -G app \
  && mkdir -p /data \
  && chown -R app:app /data

WORKDIR /app
COPY --from=go-build /out/aiworkspace ./aiworkspace

ENV PORT=3100
ENV DATABASE_PATH=/data/app.db
ENV UPLOAD_DIR=/data/uploads

EXPOSE 3100
USER app

ENTRYPOINT ["./aiworkspace"]
