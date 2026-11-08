# 开发契约 · AIWorkspace 教学系统基底

本文件是前后端/多人协作的接口约定。**改动数据层或 Action 签名时必须同步更新本文件。**

## 1. 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js 15（App Router，Server Components + Server Actions） |
| 语言 | TypeScript 5（strict） |
| 样式 | Tailwind CSS v4（CSS-first，`src/app/globals.css` 里 `@theme` 定义令牌） |
| 数据 | Prisma 6 + SQLite（`prisma/schema.prisma`，本地 `prisma/dev.db`） |
| 校验 | zod 3 |
| 部署 | Docker 多阶段构建（standalone），宿主端口 **3100** |

## 2. 目录结构

```
src/
  app/
    layout.tsx            根布局
    page.tsx              按登录角色重定向
    globals.css           设计令牌 + 基础组件 CSS
    login/page.tsx        登录页
    actions/              Server Actions（"use server"）
      auth.ts  teacher.ts  student.ts
    teacher/              教师端路由（登录角色 TEACHER）
      layout.tsx  page.tsx
      classes/page.tsx  classes/[id]/page.tsx
      assignments/page.tsx  assignments/[id]/page.tsx
    student/              学生端路由（登录角色 STUDENT）
      layout.tsx  page.tsx
      classes/page.tsx
      assignments/page.tsx  assignments/[id]/page.tsx
      grades/page.tsx
  components/
    ui/                   通用展示组件（Card / Badge / Button / Field / StatCard / PageHeader / EmptyState / Avatar / icons）
    shell/app-shell.tsx   带侧栏的整体框架（client）
    auth/login-form.tsx   登录表单（client）
    teacher/              教师端交互组件（client）
    student/              学生端交互组件（client）
  lib/
    prisma.ts             Prisma 单例
    auth.ts               session cookie / 口令哈希 / requireUser / requireRole
    roles.ts              角色常量
    action-state.ts       ActionState 类型
    format.ts             日期/分数/文案格式化 + cn()
    data.ts               全部查询函数（服务端专用）
prisma/
  schema.prisma           数据模型
  seed.ts                 演示数据
  migrations/             迁移记录
```

## 3. 数据层（src/lib/data.ts）

所有函数都是 `async`，只允许在 Server Component / Server Action 中调用；已按当前用户做权限过滤，找不到或无权限返回 `null`。

### 教师端

| 函数 | 参数 | 返回 |
| --- | --- | --- |
| `getTeacherOverview(teacherId)` | 教师 id | `{ classCount, courseCount, studentCount, pendingGrading, recentSubmissions, upcomingAssignments }` |
| `listTeacherClasses(teacherId)` | 教师 id | 班级数组（含 `_count.enrollments`、`_count.courses`、`courses[]`） |
| `getTeacherClassDetail(classId, teacherId)` | 班级 id、教师 id | 班级（含 `enrollments[].student`、`courses[]._count.assignments`、`courses[].assignments`、`announcements`）或 `null` |
| `listTeacherAssignments(teacherId)` | 教师 id | 作业数组（含 `course.class`、`submissions[]`，附加 `submittedCount`、`gradedCount`） |
| `getTeacherAssignmentDetail(assignmentId, teacherId)` | 作业 id、教师 id | 作业（含 `course.class.enrollments[].student`、`submissions[].student`，附加 `missingStudents`）或 `null` |

### 学生端

| 函数 | 参数 | 返回 |
| --- | --- | --- |
| `getStudentOverview(studentId)` | 学生 id | `{ classCount, courseCount, pendingCount, submittedCount, averagePercent, dueSoon, recentAnnouncements }` |
| `listStudentAssignments(studentId)` | 学生 id | 作业数组（含 `course.class`、`mySubmission`） |
| `getStudentAssignmentDetail(assignmentId, studentId)` | 作业 id、学生 id | 作业（含 `course.class.teacher`、`mySubmission`）或 `null` |
| `listStudentClasses(studentId)` | 学生 id | 班级数组（含 `teacher`、`_count.enrollments`、`courses[]._count.assignments`） |
| `listStudentGrades(studentId)` | 学生 id | 已批改的提交数组（含 `assignment.course.class`） |
| `listStudentAnnouncements(studentId, take?)` | 学生 id | 公告数组（含 `class`） |

类型可直接推导：`type Overview = Awaited<ReturnType<typeof getTeacherOverview>>`。

### Session

- `getSessionUser()`：当前登录用户或 `null`
- `requireUser()`：未登录跳 `/login`
- `requireRole(ROLES.TEACHER)` / `requireRole(ROLES.STUDENT)`：角色不符跳对应首页
- `ROLE_LABEL`：角色中文名

## 4. Server Actions

统一签名：`(prevState: ActionState, formData: FormData) => Promise<ActionState>`，`ActionState = { error?: string; success?: string }`。
成功需要跳转的 action 内部调用 `redirect()`；停留本页的返回 `{ success }`。

| 文件 | Action | 字段 | 成功行为 |
| --- | --- | --- | --- |
| `actions/auth.ts` | `loginAction` | `email`, `password` | 跳角色首页 |
| | `logoutAction` | — | 跳 `/login` |
| `actions/teacher.ts` | `createClassAction` | `name`, `grade?` | 跳班级详情 |
| | `createCourseAction` | `classId`, `title`, `description?` | 停留，返回 success |
| | `createAssignmentAction` | `courseId`, `title`, `description?`, `points`, `dueAt?` | 跳作业详情 |
| | `gradeSubmissionAction` | `submissionId`, `score`, `feedback?` | 停留，返回 success |
| | `createAnnouncementAction` | `classId`, `title`, `content` | 停留，返回 success |
| `actions/student.ts` | `joinClassAction` | `joinCode` | 停留，返回 success |
| | `submitAssignmentAction` | `assignmentId`, `content` | 停留，返回 success |

客户端表单写法（React 19）：

```tsx
"use client";
import { useActionState } from "react";
import { createCourseAction } from "@/app/actions/teacher";
import { initialActionState } from "@/lib/action-state";

const [state, formAction, pending] = useActionState(createCourseAction, initialActionState);
<form action={formAction}>…</form>
```

`<input type="datetime-local" name="dueAt">` 的值由 action 内部 `parseDateTimeLocal` 解析。

## 5. 共享 UI（src/components/ui/）

- `Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter` / `SectionTitle`
- `Badge`：`tone` = brand / success / warning / danger / neutral / info
- `Button`：`variant` = primary / secondary / accent / ghost / danger，`size` = md / sm；`buttonClass()` 用于 `<Link>`
- `Field` / `Input` / `Textarea` / `Select` / `FormMessage`
- `StatCard`：`label`、`value`、`hint?`、`icon?`、`tone?`
- `PageHeader`：`eyebrow?`、`title`、`description?`、`actions?`
- `EmptyState`：`icon?`、`title`、`description?`、`action?`
- `Avatar`：`name`、`color?`、`size`
- `icons.tsx`：`IconDashboard` / `IconUsers` / `IconBook` / `IconClipboard` / `IconGraduation` / `IconChart` / `IconBell` / `IconLogout` / `IconPlus` / `IconArrowLeft` / `IconArrowRight` / `IconCheck` / `IconClock` / `IconMenu` / `IconClose` / `IconCalendar` / `IconFile` / `IconAward` / `IconSearch`

## 6. 设计系统

- 风格：Flat Design（无渐变、无阴影，边框 + 色块区分层级）
- 主色 teal `#0D9488`，CTA 琥珀 `#D97706`，背景 `#F0FDFA`，正文 `#134E4A`，卡片白，边框 `#d5ece8`
- 字体：Plus Jakarta Sans + 系统中文字体，正文 14–15px，标题 600–700 字重
- 圆角：卡片 16px，按钮/输入框 10px，徽章全圆
- 布局：桌面 256px 左侧栏 + 主内容；移动端顶部栏 + 抽屉
- 间距 4/8/16/24/32/48px；页面主标题用 `PageHeader`

## 7. 硬性约定

- Server Component 为默认；只有交互（表单、抽屉、复制等）才 `"use client"`。
- Next.js 15：页面 `params` 是 `Promise`，必须 `const { id } = await params;`。
- 查不到数据调用 `notFound()`；无权限由 `requireRole` 负责跳转。
- 不新增第三方依赖；图标用 `components/ui/icons.tsx`。
- 文案全中文，按钮用动词，日期用 `formatDate` / `formatDateTime` / `dueLabel`。
- 教师只能看自己的班级；学生只能看已加入班级（由 data.ts 保证，页面不要绕过）。
