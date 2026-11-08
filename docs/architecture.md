# 架构说明 · AIWorkspace 教学系统（Go + React 版）

> v1（Next.js 全栈）架构见 `feat/project-base` 分支的 `docs/architecture.md`；本文件描述当前主线。

## 1. 总体架构

```
┌────────────────────── 浏览器（教师 / 学生） ──────────────────────┐
│  http://<host>:3100                                               │
│  React SPA（Vite 打包，React Router 路由）                        │
└──────────────────────────────┬────────────────────────────────────┘
                               │ 同源 HTTP（/api/* + 静态资源）
┌──────────────────────────────▼────────────────────────────────────┐
│ Docker 容器 aiworkspace-web（alpine，端口 3100）                   │
│                                                                   │
│  Go 1.27 单二进制（net/http）                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ /api/auth/*        登录 / 登出 / 当前用户                     │  │
│  │ /api/teacher/*     教师 API（鉴权 + 按教师过滤）              │  │
│  │ /api/student/*     学生 API（鉴权 + 按学生过滤）              │  │
│  │ /api/health        健康检查（DB ping）                       │  │
│  │ 其他路径           内嵌前端（go:embed webdist）+ SPA 回退     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                               │                                   │
│                    ┌──────────▼──────────┐                        │
│                    │ SQLite /data/app.db │（命名卷持久化）          │
│                    └─────────────────────┘                        │
└───────────────────────────────────────────────────────────────────┘
```

- **单容器、单进程**：Go 服务同时提供 API 与前端静态资源；前端构建产物通过 `go:embed` 编进二进制。
- **无外部依赖**：SQLite 文件随卷持久化，适合校内单机部署。
- **前后端分离开发**：本地 `vite dev`（5173）把 `/api` 代理到 Go（3100），生产由 Go 统一服务。

## 2. 请求流程

### 页面

1. 浏览器请求 `/teacher/classes`。
2. Go 服务找不到对应静态文件 → 回退 `index.html`（SPA）。
3. React Router 渲染 `TeacherClasses`，`ProtectedRoute` 校验登录态与角色。
4. 页面 `useEffect` 调 `GET /api/teacher/classes`。
5. Go 中间件验签 Cookie → 查用户 → 处理函数按 `teacherId` 过滤查询 SQLite → 返回 JSON。

### 表单

1. 组件提交 `POST /api/...`（JSON body）。
2. 中间件鉴权/角色校验 → 参数校验 → 事务写入 → 返回 200/201。
3. 前端刷新数据或跳转。

### 认证

- 登录：`POST /api/auth/login` 校验 scrypt 哈希 → 签发 `aw_session` Cookie（HMAC-SHA256，7 天）。
- 读取：中间件解析 token、验签、查库得到当前用户；`requireUser` 失败 401，`requireRole` 失败 403。
- 登出：清除 Cookie。

## 3. 数据模型

```
User 1 ──< Class（teacherId）         教师带多个班
User 1 ──< Enrollment >── 1 Class     学生凭 joinCode 入班（唯一约束防重复）
Class 1 ──< Course                    班级下多门课程
Course 1 ──< Assignment               课程下多份作业
Assignment 1 ──< Submission >── 1 User 每生每作业最多一份（重交覆盖并清空分数）
Class 1 ──< Announcement              班级公告
```

完整 DDL 与字段见 [`docs/CONTRACT.md`](CONTRACT.md) 第 3 节与 `server/internal/db/schema.sql`。

## 4. 目录职责

| 路径 | 职责 |
| --- | --- |
| `server/cmd/server/main.go` | 启动：环境变量、建库/迁移、种子、路由、静态资源 |
| `server/internal/db` | schema、Open、种子数据 |
| `server/internal/auth` | scrypt、会话、鉴权中间件 |
| `server/internal/handlers` | 各 API 处理函数 |
| `server/internal/models` | JSON 结构体 |
| `web/src/pages` | 页面（Login、teacher/*、student/*） |
| `web/src/components` | UI 基础组件、布局、表单 |
| `web/src/lib` | api 封装、类型、格式化 |
| `scripts/` | 本地启动、截图等开发脚本 |

## 5. Docker 镜像

多阶段（`Dockerfile`）：

| 阶段 | 内容 |
| --- | --- |
| `web-build` | `node:22-alpine`，`npm ci && npm run build` → `/web/dist` |
| `go-build` | `golang:1.27-alpine`，复制 server 与 dist 到 `webdist/`，`CGO_ENABLED=0 go build` |
| `runner` | `alpine`，只带二进制与 `/data`，非 root 用户运行 |

数据卷 `aiworkspace-data:/data`；`DATABASE_PATH=/data/app.db`。

## 6. 关键决策

| 决策 | 理由 | 代价 |
| --- | --- | --- |
| Go 标准库 HTTP | 依赖少、部署单二进制；教学系统路由简单 | 没有框架的便利（中间件需手写） |
| modernc.org/sqlite | 纯 Go 驱动，CGO_ENABLED=0 交叉编译/容器构建最省事 | 二进制较大 |
| 前端 SPA（Vite） | 前后端彻底分离，可独立部署/换后端 | 需要处理 SPA 回退与首屏 |
| `go:embed` 内嵌前端 | 单容器单端口，部署最简 | 前端更新需重新构建镜像 |
| HMAC Cookie 会话 | 无状态验签 + 可服务端登出 | 每次请求查库一次 |

## 7. 扩展点

- 换 PostgreSQL：替换 db 驱动与 DDL，handlers 的 SQL 基本不动。
- 附件：`submissions.attachment_url` 已预留；加对象存储与上传接口。
- 通知：新增 notification 表 + 轮询/SSE。
- 多学校：加 school_id 并在中间件统一注入过滤。
- CI：GitHub Actions 跑 `go vet/build` + `npm build` + Playwright。
