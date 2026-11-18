# syntax=docker/dockerfile:1
# ============================================================
# 三阶段构建 —— TS 编译、Go 编译全部在容器内完成，
# 构建电脑无需安装 Node / Go / Bun（仅需 Docker）。
#   阶段1 builder  ：Bun 安装依赖并编译前端 TypeScript -> web/dist
#   阶段2 builder2 ：Go 静态编译（CGO_ENABLED=0），embed 前端 dist 进二进制
#   阶段3 运行时   ：仅含二进制与运行必需库，无源码 / 编译器 / Node 环境
# ============================================================

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS builder

# 构建期可覆盖：国内网络默认使用 npmmirror 镜像源
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV BUN_CONFIG_REGISTRY=${NPM_REGISTRY}

WORKDIR /build/web
# 依赖清单单独成层：仅当 package.json / bun.lock 变化时才重装依赖
COPY web/package.json web/bun.lock ./
# 构建缓存挂载：重复构建时跳过已下载的依赖包（需要 BuildKit，Docker 20.10+）
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY ./web ./
COPY ./VERSION /build/VERSION
# 编译前端；VITE_REACT_APP_VERSION 经 rsbuild source.define 注入页面构建版本号
# （tr 去除 Windows 编辑器可能带入的 BOM/CRLF，防止污染版本字符串）
RUN DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(tr -d '\r\357\273\277' < /build/VERSION) bun run build

FROM golang:1.26.10-alpine@sha256:87c65a688975c0b1d4585d204874c45ca78354670e3a5f11368c5a492303d696 AS builder2

# 国内 Go 模块代理
ARG GOPROXY=https://goproxy.cn,direct
ENV GO111MODULE=on CGO_ENABLED=0 GOWORK=off GOPROXY=${GOPROXY} GOSUMDB=sum.golang.google.cn

# BuildKit 按 --platform 注入 TARGETOS/TARGETARCH；未注入时回退 linux/amd64，
# 保证 GOARCH 与基础镜像平台一致（防止在 ARM 构建机上产出 exec format error 镜像）
ARG TARGETOS=linux
ARG TARGETARCH=amd64
ENV GOOS=${TARGETOS} GOARCH=${TARGETARCH}
ENV GOEXPERIMENT=greenteagc

WORKDIR /build

# 依赖清单单独成层：go.mod / go.sum 不变时复用模块下载结果
COPY go.mod go.sum ./
# relaykit、tokenkit 是本仓库 replace 引用的本地子模块，须先放入 go.mod 才能解析模块图
COPY relaykit/go.mod ./relaykit/go.mod
COPY tokenkit/go.mod ./tokenkit/go.mod
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY . .
# 前端产物覆盖到 web/dist，供 main.go 的 //go:embed web/dist 嵌入
COPY --from=builder /build/web/dist ./web/dist
# -pgo 使用 moejs 模板做 profile-guided optimization；
# 版本号注入不加引号（单引号会被 linker 计入符号名导致静默失效）；
# tr 去除 VERSION 中可能存在的 BOM/CRLF（已在本地用 go1.26.10 实测注入成功）
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build \
      -pgo="$(go list -m -f '{{.Dir}}' github.com/Calcium-Ion/moejs)/default.pgo" \
      -ldflags "-s -w -X github.com/QuantumNous/new-api/common.Version=$(tr -d '\r\357\273\277' < VERSION)" \
      -o new-api

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc

# 运行必需组件：ca-certificates（HTTPS 证书）、tzdata（时区）、libasan8（保守保留）、
# wget（健康检查）、sqlite3（backup.sh 在容器内做数据库在线备份）
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates tzdata libasan8 wget sqlite3 \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

# 静态二进制（已内嵌前端 dist、i18n 语言包、lua 脚本、插件任务）
COPY --from=builder2 /build/new-api /
COPY LICENSE NOTICE THIRD-PARTY-LICENSES.md /licenses/

ENV TZ=Asia/Shanghai
EXPOSE 3002
# 约定：SQLite 数据库、生成文件缓存、应用日志全部落在 /data（运行时挂载宿主机目录）
WORKDIR /data

# 与 docker-compose.prod.yml 一致的健康检查（镜像内自带 wget）
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -q -O - http://localhost:3002/api/status | grep -o '"success":\s*true' || exit 1

ENTRYPOINT ["/new-api"]
