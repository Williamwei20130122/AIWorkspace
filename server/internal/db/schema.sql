-- AIWorkspace 教学系统数据库结构（docs/CONTRACT.md v4：v3 第 3 节 + 第 10 节增量）
-- 所有时间字段存 RFC3339（UTC）字符串，例如 2026-11-08T03:25:36Z。
-- 启动时由程序执行本文件（CREATE TABLE IF NOT EXISTS，可重复执行）。

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT,
  avatar_color TEXT NOT NULL DEFAULT '#0D9488',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 教师与学生的管理关系：一个学生可被多个老师管理
CREATE TABLE IF NOT EXISTS teacher_students (
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(teacher_id, student_id)
);

-- 班级：属于创建老师；学生从老师管理的学生中添加
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grade TEXT,
  teacher_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS class_members (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE(class_id, student_id)
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  join_mode TEXT NOT NULL DEFAULT 'ASSIGNED',
  class_id TEXT REFERENCES classes(id),
  submit_mode TEXT NOT NULL DEFAULT 'INDIVIDUAL',
  group_min INTEGER NOT NULL DEFAULT 2,
  group_max INTEGER NOT NULL DEFAULT 4,
  allow_student_groups INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 课题助教（最多 3 名，由应用层限制）
CREATE TABLE IF NOT EXISTS topic_assistants (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(topic_id, teacher_id)
);

-- 学生与课题的成员关系；removed_at 非空表示已移出但保留历史
CREATE TABLE IF NOT EXISTS topic_members (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE(topic_id, student_id)
);

-- 课题内小组（老师或学生创建）
CREATE TABLE IF NOT EXISTS topic_groups (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES topic_groups(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY(group_id, student_id)
);

-- 提交：个人提交 group_id 为空、student_id 非空；小组提交 group_id 非空、student_id 为空
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES topic_groups(id) ON DELETE CASCADE,
  submitted_by TEXT REFERENCES users(id),
  text_content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_files (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_dimensions (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  max_score INTEGER NOT NULL DEFAULT 100,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_scores (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  dimension_id TEXT NOT NULL REFERENCES evaluation_dimensions(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  UNIQUE(evaluation_id, dimension_id)
);

-- 查询索引：登录、按教师 / 班级 / 学生 / 课题过滤时使用
CREATE INDEX IF NOT EXISTS idx_users_login_id ON users(login_id);
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);
CREATE INDEX IF NOT EXISTS idx_teacher_students_teacher ON teacher_students(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_students_student ON teacher_students(student_id);
CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_class_members_class ON class_members(class_id);
CREATE INDEX IF NOT EXISTS idx_class_members_student ON class_members(student_id);
CREATE INDEX IF NOT EXISTS idx_topics_owner ON topics(owner_id);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);
CREATE INDEX IF NOT EXISTS idx_topics_class ON topics(class_id);
CREATE INDEX IF NOT EXISTS idx_topic_assistants_topic ON topic_assistants(topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_assistants_teacher ON topic_assistants(teacher_id);
CREATE INDEX IF NOT EXISTS idx_topic_members_topic ON topic_members(topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_members_student ON topic_members(student_id);
CREATE INDEX IF NOT EXISTS idx_topic_groups_topic ON topic_groups(topic_id);
CREATE INDEX IF NOT EXISTS idx_group_members_student ON group_members(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_topic ON submissions(topic_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_group ON submissions(group_id);
CREATE INDEX IF NOT EXISTS idx_submission_files_submission ON submission_files(submission_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_dimensions_topic ON evaluation_dimensions(topic_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_submission ON evaluations(submission_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_teacher ON evaluations(teacher_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_scores_evaluation ON evaluation_scores(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_scores_dimension ON evaluation_scores(dimension_id);

-- 唯一提交：个人提交 UNIQUE(topic_id, student_id)（group_id 为空）；小组提交 UNIQUE(topic_id, group_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_topic_student_individual
  ON submissions(topic_id, student_id) WHERE group_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_topic_group
  ON submissions(topic_id, group_id) WHERE group_id IS NOT NULL;
