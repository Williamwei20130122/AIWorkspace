# 开发契约 v3 · AIWorkspace 教学系统（课题 · 提交 · 评价）

> v1（Next.js）在 `feat/project-base`；v2（班级/作业模型，Go+TS）在 `feat/go-ts` 的 `da0a1b1`。
> **本文件是当前主线的唯一契约；改接口或模型必须同步更新。**

## 1. 技术栈

Go 1.27（net/http + modernc.org/sqlite，CGO_ENABLED=0）+ React 19 / Vite / TS strict / Tailwind v4 / React Router 7；单二进制 `go:embed` 前端；SQLite + 本地文件存储；Docker 单容器，宿主机 **3100**。

上传文件存 `/data/uploads`（本地开发 `server/data/uploads`），DB 存相对路径。

## 2. 产品模型（重新定义）

流程：**课题（Topic）→ 提交（Submission）→ 评价（Evaluation）**。

- **学生账号由老师创建**（姓名 + 学号）；一个学生可被多个老师管理。
- **学生登录**：学号直接进入；密码可选。学生可主动给自己加/改密码；老师可重置或关闭（清除）学生密码，但**永远看不到明文**。
- **课题**：由一个老师创建；可邀请 **最多 3 名助教**；创建者权限**可移交**。
- **学生加入课题是被动的**：只能由老师（创建者/助教）加入/移出；学生不能主动加入或退出。预留"开放课题"扩展位（本期不实现 UI）。
- 学生可以看到**曾经加入过的所有课题**及其评价（历史成员关系保留）。
- **课题有独立介绍页**（Markdown 编辑与渲染）。
- **提交**：文本（原样展示，不渲染 Markdown/LaTeX）+ 任意文件（多文件上传）；可重新提交，但**老师已评价后不可再重新提交**（后端 400 拒绝，前端禁用提交并提示）。
- **评价**：老师自定义**多维度评分**（维度属于课题，由课程老师定义）+ 文字评语；一个提交可多次评价（历史保留）；评价有单独的汇总页。学生可查看自己全部历史评价。表情包等后续功能不在本期实现，也不写进网页/README。

## 3. 数据模型（SQLite DDL，均 IF NOT EXISTS + 索引）

```sql
users (
  id TEXT PK, login_id TEXT UNIQUE NOT NULL,   -- 学号/工号
  name TEXT NOT NULL, role TEXT NOT NULL,      -- TEACHER | STUDENT | ADMIN
  password_hash TEXT,                          -- NULL = 无密码（学生默认）
  avatar_color TEXT NOT NULL DEFAULT '#0D9488',
  created_by TEXT,                             -- 创建该学生的老师 id（可空）
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
teacher_students ( teacher_id TEXT, student_id TEXT, created_at TEXT,
  UNIQUE(teacher_id, student_id) );
topics (
  id TEXT PK, title TEXT NOT NULL, description_md TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',       -- ACTIVE | CLOSED
  join_mode TEXT NOT NULL DEFAULT 'ASSIGNED',  -- 预留：ASSIGNED | OPEN
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
topic_assistants ( id TEXT PK, topic_id TEXT NOT NULL, teacher_id TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(topic_id, teacher_id) );
topic_members ( id TEXT PK, topic_id TEXT NOT NULL, student_id TEXT NOT NULL,
  joined_at TEXT NOT NULL, removed_at TEXT,   -- 保留历史
  UNIQUE(topic_id, student_id) );
submissions ( id TEXT PK, topic_id TEXT NOT NULL, student_id TEXT NOT NULL,
  text_content TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(topic_id, student_id) );
submission_files ( id TEXT PK, submission_id TEXT NOT NULL,
  original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL, created_at TEXT NOT NULL );
evaluation_dimensions ( id TEXT PK, topic_id TEXT NOT NULL,
  name TEXT NOT NULL, max_score INTEGER NOT NULL DEFAULT 100, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL );
evaluations ( id TEXT PK, submission_id TEXT NOT NULL, teacher_id TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL );
evaluation_scores ( id TEXT PK, evaluation_id TEXT NOT NULL, dimension_id TEXT NOT NULL,
  score INTEGER NOT NULL, UNIQUE(evaluation_id, dimension_id) );
```

时间一律 RFC3339 UTC 字符串。`login_id` 唯一；`topic_members` 的 `removed_at` 非空表示已移出但保留历史。

## 4. 认证与账号

- **账号标识（login_id，全局唯一）**：
  - 教师：**邮箱或手机号**（注册时二选一，作为 login_id；用于登录与展示）。
  - 学生：**老师创建时设置的默认用户名**（学号/拼音等，不能与任何已有账号的 login_id 冲突）。
- `POST /api/auth/login` body `{loginId, password?}` → 200 `{user}` + `aw_session` Cookie。
  - 账号 `password_hash` 为 NULL：直接登录（忽略 password）。
  - 否则校验 password；失败 400 `{error:"账号或密码不正确"}`（400 而非 401，避免前端 401 统一跳登录吞掉文案）。
  - 教师也可用邮箱或手机号登录（login_id 存的就是其中一个）；登录框文案「邮箱 / 手机号 / 学号」。
- `POST /api/auth/register` **教师自助注册** body `{name, loginId, password}` → 201 `{user}` + 自动登录 Cookie。
  - loginId 校验：`含 @` 视为邮箱（必须符合邮箱格式）；`纯数字 10-11 位` 视为手机号（校验 `^1\d{10}$`）；否则 400「请使用邮箱或手机号注册」。
  - loginId 已存在 → 409 `{error:"该邮箱/手机号已注册"}`。
  - 密码至少 8 位；姓名必填。
- `POST /api/auth/logout` → 204。
- `GET /api/me` → 200 `{user}`；未登录 401。
- `POST /api/me/password`（学生本人）body `{newPassword}`（允许空字符串 = 清除密码）→ 200。
- **老师管理学生**：
  - `GET /api/teacher/students` → 我管理的学生列表（含 `hasPassword` 布尔，绝不返回哈希）。
  - `GET /api/teacher/students/lookup?loginId=xxx` → `{exists: true, user:{id,name,loginId,hasPassword,managedByMe,createdBy:[teacherNames]}}` 或 `{exists:false}`（用于创建前查看冲突账号信息）。
  - `POST /api/teacher/students` `{name, loginId}` →
    - 成功：201 创建学生并自动关联到我；
    - loginId 已被占用：**409** 且返回 `{error:"该用户名已存在", conflict:{id,name,loginId,hasPassword,managedByMe,createdBy:[teacherNames]}}`，老师据此判断「是同一个人 → 加入」还是「不是 → 换个用户名重新创建」。
  - `POST /api/teacher/students/{id}/link` → 把已有学生关联到我的管理列表（幂等，200 `{ok:true}`）。
  - `POST /api/teacher/students/{id}/password` `{password}` → 重置密码（老师无法读取）。
  - `DELETE /api/teacher/students/{id}/password` → 关闭密码（置 NULL）。
  - 学生密码操作：返回 200 `{ok:true}`；老师只能操作 `teacher_students` 里属于自己管理的学生（404/403）。
- 用户 JSON：`{id, loginId, name, role, avatarColor, hasPassword}`。
- 会话 token 同 v2（HMAC-SHA256，`base64url(payload).sig`，Cookie `aw_session`，7 天，HttpOnly，SameSite=Lax）。

## 5. 权限规则

| 操作 | 创建者 | 助教(≤3) | 学生 |
| --- | --- | --- | --- |
| 查看课题（介绍/成员/提交） | ✓ | ✓ | 仅自己（含历史成员） |
| 编辑课题标题/介绍/关闭 | ✓ | - | - |
| 管理助教 / 移交创建者 | ✓ | - | - |
| 添加/移出学生 | ✓ | ✓ | - |
| 评价提交 / 编辑维度 | ✓ | ✓ | - |
| 提交作品 | - | - | ✓（仅未关闭课题，且未被评价） |
| 查看评价 | 自己课题全部 | 自己课题全部 | 仅自己 |

辅助函数：`canManageTopic(user, topic)`（owner 或 assistant）；学生访问课题要求 `topic_members` 存在（removed_at 非空 = 历史，允许只读查看）。

## 6. API 契约（JSON）

### 教师

- `GET /api/teacher/overview` → `{topicCount, studentCount, pendingEvaluationCount, recentEvaluations:[{id, createdAt, comment, student:{id,name}, topic:{id,title}}], topics:[{id,title,status,memberCount,submissionCount,pendingCount}]}`
- `GET /api/teacher/topics` → `[{id, title, status, joinMode, owner:{id,name}, isOwner, memberCount, submissionCount, pendingCount, updatedAt}]`
- `POST /api/teacher/topics` `{title, descriptionMd?}` → 201 `{id}`
- `GET /api/teacher/topics/{id}` → `{id, title, descriptionMd, status, joinMode, owner:{id,name}, assistants:[{id,name,loginId}], students:[{id,name,loginId,hasPassword,removedAt}], dimensions:[{id,name,maxScore,sortOrder}], submissions:[{id, student:{id,name,loginId}, textContent, updatedAt, fileCount, evaluationCount, latestEvaluation:{id,comment,scores:[{dimensionId,dimensionName,score,maxScore}]}|null, pending}]}`
- `PATCH /api/teacher/topics/{id}` `{title?, descriptionMd?, status?}` → 200
- `POST /api/teacher/topics/{id}/assistants` `{loginId}` → 201（最多 3 个，超过 400）
- `DELETE /api/teacher/topics/{id}/assistants/{teacherId}` → 204
- `POST /api/teacher/topics/{id}/transfer` `{teacherId}` → 200（原创建者变为助教，需 ≤3 限制）
- `POST /api/teacher/topics/{id}/students` `{loginId 或 studentId}` → 201（幂等；removed 的恢复）
- `DELETE /api/teacher/topics/{id}/students/{studentId}` → 204（置 removed_at，保留历史）
- `GET /api/teacher/topics/{id}/dimensions` / `POST` `{name,maxScore}` / `PATCH /{dimId}` / `DELETE /{dimId}`
- `GET /api/teacher/submissions/{id}` → `{id, topic:{id,title}, student:{id,name,loginId}, textContent, files:[{id,originalName,mimeType,sizeBytes}], updatedAt, evaluations:[{id,createdAt,teacher:{id,name},comment,scores:[{dimensionId,dimensionName,score,maxScore}]}]}`
- `POST /api/teacher/submissions/{id}/evaluations` `{comment, scores:[{dimensionId, score}]}` → 201（评分为整数，范围 0..维度 maxScore）
- `GET /api/teacher/evaluations` → `[{id, createdAt, comment, teacher:{id,name}, student:{id,name}, topic:{id,title}, submissionId, scores:[{dimensionName, score, maxScore}]}]`（我管理课题下的全部评价，按时间倒序）

### 学生

- `GET /api/student/overview` → `{topicCount, pendingSubmissionCount, submittedCount, latestEvaluations:[...], topics:[{id,title,status,evaluationCount,submitted}]}`
- `GET /api/student/topics` → `[{id,title,status,owner:{name},submitted,updatedAt,removedAt}]`（含历史课题）
- `GET /api/student/topics/{id}` → `{id,title,descriptionMd,status,owner:{name},assistants:[{name}],mySubmission:{id,textContent,updatedAt,files:[{id,originalName,sizeBytes}]}|null,myEvaluations:[{id,createdAt,comment,scores:[{dimensionName,score,maxScore}]}]}`
- `POST /api/student/topics/{id}/submission` **multipart**：`textContent` 字段 + `files`（可多份，字段名 `files`）→ 200 `{ok:true}`；重交覆盖文本/附件；课题 CLOSED 时 400；**已有评价时禁止重新提交：400 `{error:"老师已评价，不能重新提交"}`**；单文件 ≤ 100MB；总文件数 ≤ 10；文件名保留原扩展名并做安全清洗。
- `GET /api/student/files/{fileId}` → 附件下载（鉴权：文件属于该学生自己的提交，或老师管理该课题；`Content-Disposition: attachment`）。
- `GET /api/student/evaluations` → `[{id, createdAt, comment, topic:{id,title}, scores:[{dimensionName, score, maxScore}]}]`（我全部历史课题的评价）

### 通用
- `GET /api/health` → `{ok:true}`（DB ping）
- 错误统一 `{error:"中文"}`；401 未登录、403 无权限、404 不存在、400 参数错误、409 冲突。

## 7. 前端页面（Vite SPA）

路由：
- `/login` 登录（学号 + 可选密码；演示账号提示）
- 教师：`/teacher` 工作台、`/teacher/topics` 课题列表、`/teacher/topics/:id` 课题详情（介绍编辑 Markdown 预览、成员、提交、评价表单、维度管理）、`/teacher/students` 学生管理（创建/密码重置/关闭）、`/teacher/evaluations` 评价汇总
- 学生：`/student` 工作台、`/student/topics`（当前+历史）、`/student/topics/:id` 课题介绍 + 提交（文本 + 多文件上传）+ 我的评价、`/student/evaluations` 我的全部评价
- 未登录跳 `/login`；角色不符跳对应首页。

约定：`lib/api.ts` 同前；上传用 `fetch` + `FormData`（不要设置 Content-Type）；Markdown 渲染介绍页用轻量方案（允许新增 `marked` 依赖，仅用于介绍页展示；提交内容一律纯文本 `whitespace-pre-wrap`）；设计系统沿用 `docs/design-system.md`（Flat、teal、amber CTA、无渐变/阴影）。

## 8. 种子数据（SEED_ON_START=1 且 users 为空）

- 教师：`王老师` loginId `teacher@demo.edu` 密码 `demo1234`；`李老师` loginId `li@demo.edu` 密码 `demo1234`（教师用邮箱/手机号）。
- 学生：`李小明` `S001`（无密码）、`张小红` `S002` 密码 `demo1234`、`陈小军` `S003`（无密码）、`刘小美` `S004`（无密码）。
- 课题 1「校园气象站数据记录」owner 王老师、助教 李老师、成员 S001/S002/S003、状态 ACTIVE、介绍页 Markdown；维度：数据完整性/分析质量/规范表达（各 100）。
- 课题 2「班级图书角运营方案」owner 王老师、成员 S001/S004、状态 ACTIVE。
- 课题 3「校园植物观察（已结题）」owner 王老师、成员 S002（removed_at 有值，用于历史展示）、状态 CLOSED。
- 提交：课题1 S001（文本+2 个演示附件）、S002（文本，无附件）；课题3 S002（文本）。
- 评价：课题1 S001 的评价（3 维度 + 评语）、课题3 S002 的评价。
- 演示登录：教师 `teacher@demo.edu / demo1234`；学生 `S001`（无密码直接进）。

## 9. Docker

同 v2 结构（Vite → Go → alpine），`go:embed` 前端；`/data` 卷同时放 `app.db` 与 `uploads/`；`DATABASE_PATH=/data/app.db`、`UPLOAD_DIR=/data/uploads`；`AUTH_SECRET` 必填（compose 从 `.env`）。
