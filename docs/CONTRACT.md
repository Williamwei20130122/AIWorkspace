# 开发契约 v2 · AIWorkspace 教学系统（Go 后端 + TS 前端）

> v1（Next.js 全栈）已归档在 `feat/project-base` 分支；本文件描述当前主线架构。
> **改接口或数据模型必须同步更新本文件。**

## 1. 技术栈

| 层 | 选型 |
| --- | --- |
| 后端 | Go 1.27（标准库 `net/http` 路由）+ 纯 Go SQLite 驱动 `modernc.org/sqlite`（CGO_ENABLED=0） |
| 前端 | React 19 + Vite + TypeScript strict + Tailwind CSS v4 + React Router 7 |
| 认证 | scrypt 口令哈希 + HMAC-SHA256 签名 HttpOnly Cookie（`aw_session`） |
| 数据库 | SQLite 文件（本地 `server/data/app.db`；容器 `/data/app.db`），启动时自动建表 |
| 部署 | Docker 多阶段：Vite 构建 → Go 构建（`go:embed` 内嵌前端）→ alpine 运行，宿主机 **3100** |

## 2. 目录

```
server/                     Go 后端（module aiworkspace/server）
  go.mod  go.sum
  cmd/server/main.go        入口：读环境 → 建库 → 种子 → 启动 HTTP
  internal/db/              schema.sql、打开库、迁移、种子
  internal/auth/            scrypt、会话签名/验签、中间件
  internal/handlers/        auth.go / teacher.go / student.go / health.go
  internal/models/          结构体 + JSON 标签
  web/                      `go:embed all:webdist`（构建时由 web/dist 复制进来）
web/                        Vite + React 前端
  package.json  vite.config.ts  tsconfig.json  index.html
  src/
    main.tsx  App.tsx       Router + 路由守卫
    lib/api.ts              fetch 封装（401 跳登录）
    lib/types.ts            与后端 JSON 对应的类型
    lib/format.ts           cn / 日期 / 分数 / 截止文案
    lib/roles.ts            角色常量
    components/ui/*         Card/Badge/Button/Field/StatCard/PageHeader/EmptyState/Avatar/icons
    components/shell/AppShell.tsx
    components/auth/LoginForm.tsx
    components/teacher/*    教师端交互组件
    components/student/*    学生端交互组件
    pages/Login.tsx
    pages/teacher/*         工作台/班级/班级详情/作业/作业详情
    pages/student/*         工作台/班级/作业/作业详情/成绩
    styles/globals.css      设计令牌 + aw-* 基础类（与 v1 相同）
docs/                       需求/架构/设计系统/契约/截图
docker/entrypoint.sh        容器入口（建库+种子由程序完成，入口只做启动与健康提示）
Dockerfile
docker-compose.yml
```

## 3. 数据模型（SQLite DDL）

与 v1 逻辑一致；`role` 为字符串 `TEACHER|STUDENT|ADMIN`，所有主键为 `TEXT`（cuid 风格随机 id 或 uuid，由后端生成）。

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'STUDENT',
  avatar_color TEXT NOT NULL DEFAULT '#0D9488',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, grade TEXT, join_code TEXT NOT NULL UNIQUE,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, UNIQUE(class_id, student_id)
);
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, color TEXT NOT NULL DEFAULT '#0D9488',
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, due_at TEXT,
  points INTEGER NOT NULL DEFAULT 100,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_by_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL, attachment_url TEXT,
  submitted_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  score INTEGER, feedback TEXT, graded_at TEXT,
  UNIQUE(assignment_id, student_id)
);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
```

时间统一用 **RFC3339（UTC）字符串** 存取，例如 `2026-11-08T03:25:36Z`；前端 `new Date(s)` 展示。

## 4. 认证

- `POST /api/auth/login` body `{ "email", "password" }` → 200 `{ "user": User }`，并 `Set-Cookie: aw_session=<payload>.<sig>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`（生产加 `Secure`）。
- `POST /api/auth/logout` → 204，清除 Cookie。
- `GET /api/me` → 200 `{ "user": User }`；未登录 401 `{ "error": "未登录" }`。
- 会话 token：`base64url(JSON{sub,iat}) + "." + HMAC-SHA256(payload, AUTH_SECRET)`。
- 中间件：`requireUser`（失败 401）、`requireRole("TEACHER"|"STUDENT")`（失败 403）。
- `User` JSON：`{id, name, email, role, avatarColor}`。
- 未配置 `AUTH_SECRET` 时生产拒绝启动；开发用固定 dev 值并打印警告。

所有 API 错误统一：`{ "error": "中文错误信息" }`。参数校验失败 400，无权限 403，未找到 404。

## 5. API 契约

### 通用

- `GET /api/health` → 200 `{"ok":true,"service":"aiworkspace","time":"..."}`（DB ping 失败 503）

### 教师（需 TEACHER）

- `GET /api/teacher/overview`
  → `{ classCount, courseCount, studentCount, pendingGrading,
       recentSubmissions: [{ id, submittedAt, score,
         student: {id,name,avatarColor},
         assignment: { id, title, points, course: { title, class: { name } } } }],
       upcomingAssignments: [{ id, title, dueAt, points,
         course: { title, class: { name } }, submittedCount }] }`
- `GET /api/teacher/classes`
  → `[{ id, name, grade, joinCode, createdAt, enrollmentCount, courseCount,
        courses: [{ id, title, color }] }]`
- `POST /api/teacher/classes` body `{name, grade?}` → 201 `{ id, name, joinCode, ... }`
- `GET /api/teacher/classes/{id}`
  → `{ id, name, grade, joinCode, teacher: {name,email},
       students: [{id,name,email,avatarColor,createdAt}],
       courses: [{ id, title, description, color, assignmentCount,
                   recentAssignments: [{id,title,dueAt}] }],
       announcements: [{id,title,content,createdAt}] }`
- `POST /api/teacher/classes/{id}/courses` body `{title, description?}` → 201
- `POST /api/teacher/classes/{id}/announcements` body `{title, content}` → 201
- `POST /api/teacher/assignments` body `{courseId, title, description?, points, dueAt?}` → 201 `{id}`
- `GET /api/teacher/assignments`
  → `[{ id, title, points, dueAt, createdAt,
        course: {id,title,class:{id,name}}, submittedCount, gradedCount }]`
- `GET /api/teacher/assignments/{id}`
  → `{ id, title, description, points, dueAt, createdAt,
       course: { title, class: {id,name} }, submissionCount, gradedCount,
       submissions: [{ id, student:{id,name,email,avatarColor}, content,
                       submittedAt, score, feedback, gradedAt }],
       missingStudents: [{id,name,email,avatarColor}] }`
- `POST /api/teacher/submissions/{id}/grade` body `{score, feedback?}` → 200 `{ok:true}`

### 学生（需 STUDENT）

- `GET /api/student/overview`
  → `{ classCount, courseCount, pendingCount, submittedCount, averagePercent,
       dueSoon: [{id,title,dueAt,points,course:{title,class:{name}}}],
       recentAnnouncements: [{id,title,content,createdAt,class:{name}}] }`
- `GET /api/student/classes`
  → `[{ id, name, teacher:{name,email}, studentCount,
        courses: [{id,title,assignmentCount}] }]`
- `POST /api/student/classes/join` body `{joinCode}` → 200 `{ok:true, className}`（已加入则幂等）
- `GET /api/student/assignments`
  → `[{ id, title, points, dueAt, course:{title,class:{id,name}},
        mySubmission: {id,submittedAt,score,feedback}|null }]`
- `GET /api/student/assignments/{id}`
  → `{ id, title, description, points, dueAt,
       course: {title, class:{id,name,teacher:{name}}}, mySubmission|null }`
- `POST /api/student/assignments/{id}/submit` body `{content}` → 200 `{ok:true}`（重交清空分数/评语）
- `GET /api/student/grades`
  → `[{ id, score, feedback, submittedAt,
        assignment: {id,title,points,dueAt,course:{title,class:{name}}} }]`

### 静态资源

- 非 `/api/*` 请求由 Go 返回内嵌前端：静态文件直出，未知路径回退 `index.html`（SPA 路由）。

## 6. 前端约定

- 路由（React Router）：
  - `/login`
  - `/teacher` `/teacher/classes` `/teacher/classes/:id` `/teacher/assignments` `/teacher/assignments/:id`
  - `/student` `/student/classes` `/student/assignments` `/student/assignments/:id` `/student/grades`
  - `/` 按登录角色重定向；未登录访问受保护页 → `/login`
- `lib/api.ts`：`api.get<T>(url)` / `api.post<T>(url, body)`，统一处理 401（跳 `/login`）、错误抛 `ApiError`（`error` 文案）。
- 页面数据用 `useEffect` + `useState` 拉取，展示加载/空/错误状态；不要引入 React Query 等额外依赖。
- 表单：受控输入 + 提交中禁用 + 成功/失败提示（复用 `FormMessage`）。
- 视觉：沿用 `docs/design-system.md`（Flat、teal `#0D9488`、amber CTA、无渐变/阴影）；`styles/globals.css` 的 `aw-*` 基础类与 v1 相同。
- 类型：`lib/types.ts` 与第 5 节 JSON 一一对应。

## 7. 种子数据（SEED_ON_START=1 且 users 表为空时）

与 v1 一致：王老师（teacher@demo.edu）、李小明（student@demo.edu）、张小红/陈小军/刘小美；两个班级（邀请码 MATH01、MATH02）；数学/物理/数学思维拓展三门课；三份作业（含一份已截止）；两份已批改、两份待批改；三条公告。密码统一 `demo1234`（scrypt 格式 `scrypt$salt$hash`，与 v1 相同，便于迁移）。

## 8. 本地开发

```bash
# 后端（:3100）
cd server && go run ./cmd/server

# 前端（:5173，代理 /api 到 :3100）
cd web && npm install && npm run dev

# 生产构建
cd web && npm run build            # 产物 web/dist
cp -r web/dist/* server/webdist/   # 供 go:embed
cd server && go build -o ../aiworkspace ./cmd/server
```

## 9. Docker

多阶段：

1. `web-build`：`node:22-alpine`，`npm ci && npm run build` → `/web/dist`
2. `go-build`：`golang:1.27-alpine`，复制 `server/` 与 `dist` 到 `server/webdist/`，`CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"` → `aiworkspace`
3. `runtime`：`alpine:3.20`，复制二进制与 `/data` 目录；`EXPOSE 3100`；`ENTRYPOINT ["./aiworkspace"]`

数据卷：`aiworkspace-data:/data`；`DATABASE_PATH=/data/app.db`；`AUTH_SECRET` 必填（compose 从 `.env` 读取，缺省给出开发默认并在日志警告）。
