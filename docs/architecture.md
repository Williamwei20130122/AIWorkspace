# 架构说明 · AIWorkspace 教学系统（v3：课题 · 提交 · 评价）

## 1. 总体架构

```
┌────────────────── 浏览器（教师 / 学生） ──────────────────┐
│  http://<host>:3100                                       │
│  React SPA（Vite 打包，React Router 路由）                │
└──────────────────────────┬────────────────────────────────┘
                           │ 同源 HTTP（/api/* + 静态资源）
┌──────────────────────────▼────────────────────────────────┐
│ Docker 容器 aiworkspace-web（alpine，端口 3100）           │
│                                                           │
│  Go 1.27 单二进制（net/http）                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ /api/auth/*       注册 / 登录 / 登出 / 当前用户       │  │
│  │ /api/teacher/*    课题、成员、助教、学生、提交、评价   │  │
│  │ /api/student/*    课题、提交（文件上传）、评价、附件   │  │
│  │ /api/health       健康检查（DB ping）                 │  │
│  │ 其他路径          内嵌前端（go:embed）+ SPA 回退       │  │
│  └─────────────────────────────────────────────────────┘  │
│              │                          │                 │
│     ┌────────▼────────┐        ┌────────▼────────┐         │
│     │ SQLite /data/   │        │ 附件 /data/     │         │
│     │ app.db          │        │ uploads/        │         │
│     └─────────────────┘        └─────────────────┘         │
└───────────────────────────────────────────────────────────┘
```

- 单容器、单进程：Go 同时提供 API、附件下载与前端静态资源；Vite 产物 `go:embed` 进二进制。
- SQLite 与附件都在 `/data` 命名卷，重启不丢。
- 本地开发：`vite dev`（5173）把 `/api` 代理到 Go（3100）。

## 2. 请求流程

### 页面

1. 浏览器请求 `/teacher/topics`。
2. Go 找不到静态文件 → 回退 `index.html`（SPA）。
3. React Router 渲染页面，`ProtectedRoute` 校验登录态与角色。
4. 页面 `useEffect` 调 `GET /api/teacher/topics`。
5. 中间件验签 Cookie → 查用户 → handler 按用户过滤查询 → JSON。

### 提交（multipart）

1. 学生端 `fetch` + `FormData`（textContent + files）POST `/api/student/topics/{id}/submission`。
2. Go 校验登录、课题成员与状态、是否已评价 → 解析 multipart → 保存文件到 `UPLOAD_DIR/<submissionId>/` → 更新/创建提交记录。
3. 前端刷新详情。

### 评价

教师端动态维度表单 POST `/api/teacher/submissions/{id}/evaluations`（comment + scores），保存 evaluation 与 evaluation_scores；学生端读取 `myEvaluations`。

### 认证

- 登录：`POST /api/auth/login {loginId, password?}`；教师用邮箱/手机号（`password_hash` 必有），学生可无密码（`password_hash` 为 NULL 时直接登录）。
- 注册：`POST /api/auth/register`（教师，邮箱/手机号）。
- 会话：`aw_session` = `base64url(payload).HMAC-SHA256`，HttpOnly、SameSite=Lax、7 天。
- 学生密码：学生自助 `POST /api/me/password`；老师可 `POST/DELETE /api/teacher/students/{id}/password`（重置/关闭），任何接口都不返回哈希。

## 3. 数据模型

```
User ──< teacher_students >── User(学生)      一个学生可被多个老师管理
User(教师) ──< topics(owner_id)              创建者
Topic ──< topic_assistants >── User(教师)     助教 ≤ 3，可移交创建者
Topic ──< topic_members >── User(学生)        被动加入，removed_at 保留历史
Topic ──< submissions >── User(学生)          每个学生每课题一份提交（可覆盖）
Submission ──< submission_files              任意类型附件，磁盘 /data/uploads
Topic ──< evaluation_dimensions              课题自定义评分维度
Submission ──< evaluations >── User(教师)     一个提交可多次评价
Evaluation ──< evaluation_scores >── Dimension
```

关键约束：

- `users.login_id` 唯一（教师=邮箱/手机号，学生=默认用户名）。
- `topic_members` 唯一（topic_id, student_id）；`removed_at` 非空 = 历史成员。
- `submissions` 唯一（topic_id, student_id）；已评价后禁止重新提交（应用层校验）。
- `evaluation_scores` 唯一（evaluation_id, dimension_id）。
- 删除策略：课题/用户删除级联清理关联数据（本期无删除入口）。

完整 DDL 见 [`docs/CONTRACT.md`](CONTRACT.md) 第 3 节。

## 4. 目录职责

| 路径 | 职责 |
| --- | --- |
| `server/cmd/server/main.go` | 启动：环境变量、建库/迁移、种子、路由、内嵌前端 |
| `server/internal/db` | schema.sql、Open/Migrate、种子数据 |
| `server/internal/auth` | scrypt、会话、鉴权/角色中间件 |
| `server/internal/handlers` | auth / teacher / student / files / health |
| `server/internal/models` | JSON 结构体 |
| `web/src/pages` | 页面（Login/Register、teacher/*、student/*） |
| `web/src/components` | ui、shell、auth、teacher、student |
| `web/src/lib` | api 封装、类型、格式化 |
| `scripts/` | 本地启动、全流程联调（verify-v3.mjs）、截图 |

## 5. Docker 镜像

多阶段（`Dockerfile`）：

| 阶段 | 内容 |
| --- | --- |
| `web-build` | `node:22-alpine`，`npm ci && npm run build` → `/web/dist` |
| `go-build` | `golang:1.27-alpine`，复制 server 与 dist 到 `webdist/`，`CGO_ENABLED=0 go build` |
| `runner` | `alpine`，只带二进制与 `/data`，非 root 用户运行 |

## 6. 关键决策

| 决策 | 理由 | 代价 |
| --- | --- | --- |
| Go 标准库 HTTP | 依赖少、单二进制、部署简单 | 中间件/路由需手写 |
| modernc.org/sqlite | 纯 Go，无 CGO，容器构建最省事 | 二进制较大 |
| 前端 SPA（Vite） | 前后端彻底分离 | 需 SPA 回退；首屏需加载 JS |
| `go:embed` 内嵌前端 | 单容器单端口 | 前端更新需重建镜像 |
| 附件本地磁盘 + DB 记录 | 简单可靠、可持久化到卷 | 多实例部署需对象存储 |
| HMAC Cookie 会话 | 无状态验签 + 可服务端登出 | 每次请求查库一次 |

## 7. 扩展点

- 附件预览：按 mime 提供缩略图/PDF.js 预览。
- 阶段性评价：evaluations 已支持多次，可加 stage 字段。
- 开放课题：topics.join_mode 预留 `OPEN`，加学生自助加入接口。
- 换 PostgreSQL：替换驱动与 DDL，handlers 的 SQL 基本不动。
- 多学校：加 school_id 并在中间件统一注入过滤。
- CI：GitHub Actions 跑 `go vet/build` + `npm build` + 全流程 verify 脚本。
