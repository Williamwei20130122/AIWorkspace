# 架构说明 · AIWorkspace 教学系统

## 1. 总体架构

```
┌──────────────────────────── 浏览器（教师 / 学生） ────────────────────────────┐
│  http://<host>:3100                                                           │
└───────────────────────────────────┬───────────────────────────────────────────┘
                                    │ HTTP
┌───────────────────────────────────▼───────────────────────────────────────────┐
│ Docker 容器 aiworkspace-web（node:22-alpine，端口 3100）                       │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ Next.js 15（standalone server.js）                                      │  │
│  │                                                                         │  │
│  │  Server Components（页面）  ──调用──▶  src/lib/data.ts ──▶ Prisma Client │  │
│  │  Server Actions（表单）     ──调用──▶  src/lib/data.ts / prisma         │  │
│  │  Route Handler /api/health  ──调用──▶  prisma.$queryRaw                │  │
│  │  Client Components（表单/抽屉）──submit──▶ Server Actions               │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                    │                                          │
│                           ┌────────▼────────┐                                 │
│                           │ SQLite 文件      │  /data/app.db（命名卷挂载）      │
│                           └─────────────────┘                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **单容器**：Next.js 同时承担页面渲染与接口（Server Actions），无需单独后端。
- **无外部依赖**：SQLite 随容器卷持久化，适合校内单机部署。
- **无状态应用进程**：所有状态在 SQLite 与会话 Cookie 中，重启容器不丢数据（卷在）。

## 2. 请求流程

### 页面请求（RSC）

1. 浏览器请求 `/teacher/classes`。
2. `src/app/teacher/layout.tsx` 调 `requireRole(ROLES.TEACHER)` 校验会话，失败跳转。
3. 页面 Server Component 调 `listTeacherClasses(teacherId)`。
4. `data.ts` 用 Prisma 查询 SQLite（已带 `teacherId` 过滤）。
5. React Server Component 流式返回 HTML。

### 表单提交（Server Action）

1. 客户端组件（如 `create-class-form.tsx`）用 `useActionState(action, initialState)` 绑定 `<form action={formAction}>`。
2. React 把 FormData POST 到同源 action 端点。
3. Action 内 `requireRole` 鉴权 → zod 校验 → Prisma 写入 → `revalidatePath` → 必要时 `redirect`。
4. 返回 `{ error }` 或 `{ success }` 驱动 UI；`redirect` 会切换路由。

### 认证

- 登录：`loginAction` 校验邮箱/密码（scrypt）→ `setSessionCookie(userId)`。
- Cookie：`aw_session` = `base64url(payload).HMAC-SHA256(payload, AUTH_SECRET)`；HttpOnly、SameSite=Lax、生产环境 Secure、7 天。
- 读取：`getSessionUser()` 验签后查库取用户；`requireUser` / `requireRole` 用于页面与 Action。

## 3. 数据模型

```
User 1 ──< Class（teacherId）        教师带多个班
User 1 ──< Enrollment >── 1 Class     学生多对多加入班级（joinCode 入班）
Class 1 ──< Course                    班级下多门课程
Course 1 ──< Assignment               课程下多份作业
Assignment 1 ──< Submission >── 1 User  每个学生每份作业最多一份提交（可重交覆盖）
Class 1 ──< Announcement              班级公告
```

关键约束：

- `User.email` 唯一；`Class.joinCode` 唯一。
- `@@unique([classId, studentId])` 防止重复入班。
- `@@unique([assignmentId, studentId])`：提交用 upsert，重交更新内容并清空分数。
- 级联删除：删班级/课程/作业/用户时关联数据 `onDelete: Cascade`。

字段细节见 `prisma/schema.prisma`；接口细节见 `docs/CONTRACT.md`。

## 4. 目录职责

| 路径 | 职责 |
| --- | --- |
| `src/app/**/page.tsx` | 路由页面（Server Component，取数 + 组合 UI） |
| `src/app/actions/*` | Server Actions（鉴权 → 校验 → 写入 → 刷新/跳转） |
| `src/lib/data.ts` | 唯一查询入口，含权限过滤 |
| `src/lib/auth.ts` | 会话、口令哈希、`requireUser/requireRole` |
| `src/lib/prisma.ts` | Prisma 客户端单例 |
| `src/components/ui/*` | 无业务通用组件 |
| `src/components/{teacher,student}/*` | 端专属交互组件（client） |
| `prisma/migrations/*` | 数据库迁移，随代码提交 |
| `docker/entrypoint.sh` | 迁移 → 可选种子 → 启动 |

## 5. Docker 镜像

多阶段构建（`Dockerfile`）：

| 阶段 | 内容 |
| --- | --- |
| `deps` | `npm ci`（含 `postinstall: prisma generate`） |
| `builder` | `prisma generate` + `next build`（standalone 产物） |
| `runner` | 只带 standalone、`.next/static`、`public`、Prisma 引擎/CLI、`prisma/` |

运行阶段入口 `docker/entrypoint.sh`：

1. `prisma migrate deploy`（幂等，应用 `prisma/migrations`）。
2. `SEED_ON_START=1` 且空库时运行 `prisma/ensure-seed.mjs`（有数据则跳过）。
3. `exec node server.js`，监听 `PORT=3100`，`HOSTNAME=0.0.0.0`。

镜像内以非 root 用户 `nextjs`（uid 1001）运行；`/data` 由该用户可写。

## 6. 关键决策

| 决策 | 理由 | 代价 |
| --- | --- | --- |
| Next.js 全栈单体 | 教学系统页面与接口同源，Server Actions 省掉 API 层样板 | 前后端无法独立扩容（本期不需要） |
| SQLite | 零外部依赖，校内单机部署最省心 | 并发写入弱；大规模需换 PostgreSQL |
| Prisma | 模型即文档、迁移可追溯、类型安全 | 引入原生引擎，镜像稍大 |
| standalone 产物 | 运行镜像不带 devDependencies | 需要显式复制 Prisma 引擎与 CLI |
| 会话 Cookie 而非 JWT | 可服务端注销、无需引入依赖 | 无状态校验略慢（查库一次） |

## 7. 扩展点

- **换数据库**：`datasource db` 改 `postgresql`，生成新 migration，`DATABASE_URL` 指向 PG；data.ts 基本不动。
- **附件**：`Submission.attachmentUrl` 已预留；加对象存储或本地卷 + 上传 Route Handler。
- **通知**：新增 `Notification` 模型 + 站内信页面；或接入邮件服务。
- **多学校**：加 `School` 模型与 `schoolId` 过滤，可在 `data.ts` 统一注入。
- **CI**：GitHub Actions 跑 `npm ci && npm run typecheck && npm run build` + Playwright。
