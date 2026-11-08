package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

// TestMigrateCreatesV4Schema 确认空库能建出 v4 全部表与关键列。
func TestMigrateCreatesV4Schema(t *testing.T) {
	dir := t.TempDir()
	database, err := Open(filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer func() { _ = database.Close() }()

	tables := []string{
		"users", "teacher_students", "classes", "class_members",
		"topics", "topic_assistants", "topic_members", "topic_groups", "group_members",
		"submissions", "submission_files", "evaluation_dimensions", "evaluations", "evaluation_scores",
	}
	for _, table := range tables {
		var count int
		if err := database.QueryRow(
			`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table,
		).Scan(&count); err != nil {
			t.Fatalf("检查表 %s 失败: %v", table, err)
		}
		if count != 1 {
			t.Errorf("缺少 v4 表 %s", table)
		}
	}

	for _, check := range []struct{ table, column string }{
		{"users", "login_id"},
		{"users", "password_hash"},
		{"topics", "class_id"},
		{"topics", "submit_mode"},
		{"topics", "group_min"},
		{"topics", "group_max"},
		{"topics", "allow_student_groups"},
		{"submissions", "group_id"},
		{"submissions", "student_id"},
	} {
		hasColumn, err := tableHasColumn(database, check.table, check.column)
		if err != nil {
			t.Fatalf("检查 %s.%s 失败: %v", check.table, check.column, err)
		}
		if !hasColumn {
			t.Errorf("%s 表缺少 %s 列", check.table, check.column)
		}
	}

	// submissions.student_id 必须可为空（小组提交）。
	var notNullCount int
	if err := database.QueryRow(
		`SELECT "notnull" FROM pragma_table_info('submissions') WHERE name = 'student_id'`,
	).Scan(&notNullCount); err != nil {
		t.Fatalf("读取 submissions.student_id 约束失败: %v", err)
	}
	if notNullCount != 0 {
		t.Error("submissions.student_id 应允许为空（小组提交 student_id 为空）")
	}

	// partial unique index：个人提交 / 小组提交各一条。
	var indexCount int
	if err := database.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
		 AND name IN ('idx_submissions_topic_student_individual', 'idx_submissions_topic_group')`,
	).Scan(&indexCount); err != nil {
		t.Fatalf("检查提交唯一索引失败: %v", err)
	}
	if indexCount != 2 {
		t.Errorf("应有 2 个提交唯一索引，实际 %d 个", indexCount)
	}
}

// TestMigrateDropsLegacyV3Schema 确认 v3（课题-提交-评价）旧库会被清理并重建为 v4。
func TestMigrateDropsLegacyV3Schema(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "legacy-v3.db")
	raw, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		t.Fatalf("打开旧库失败: %v", err)
	}
	defer func() { _ = raw.Close() }()

	legacyStatements := []string{
		`CREATE TABLE users (
			id TEXT PRIMARY KEY, login_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
			password_hash TEXT, avatar_color TEXT NOT NULL DEFAULT '#0D9488', created_by TEXT,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE topics (
			id TEXT PRIMARY KEY, title TEXT NOT NULL, description_md TEXT NOT NULL DEFAULT '',
			owner_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', join_mode TEXT NOT NULL DEFAULT 'ASSIGNED',
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE submissions (
			id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, student_id TEXT NOT NULL,
			text_content TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, created_at TEXT NOT NULL,
			UNIQUE(topic_id, student_id)
		)`,
	}
	for _, statement := range legacyStatements {
		if _, err := raw.Exec(statement); err != nil {
			t.Fatalf("创建 v3 结构失败: %v", err)
		}
	}

	if err := Migrate(raw); err != nil {
		t.Fatalf("迁移旧库失败: %v", err)
	}

	for _, table := range []string{"classes", "class_members", "topic_groups", "group_members"} {
		exists, err := tableExists(raw, table)
		if err != nil {
			t.Fatalf("检查表 %s 失败: %v", table, err)
		}
		if !exists {
			t.Errorf("v3 旧库重建后缺少 v4 表 %s", table)
		}
	}
	hasClassID, err := tableHasColumn(raw, "topics", "class_id")
	if err != nil {
		t.Fatalf("检查 topics.class_id 失败: %v", err)
	}
	if !hasClassID {
		t.Error("v3 旧库重建后 topics 应包含 class_id 列")
	}
}

// TestMigrateDropsLegacyV2Schema 确认 v2（班级 / 任务模型）旧库会被清理并重建为 v3。
func TestMigrateDropsLegacyV2Schema(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "legacy.db")
	raw, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		t.Fatalf("打开旧库失败: %v", err)
	}
	defer func() { _ = raw.Close() }()

	legacyStatements := []string{
		`CREATE TABLE users (
			id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'STUDENT',
			avatar_color TEXT NOT NULL DEFAULT '#0D9488',
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE classes (id TEXT PRIMARY KEY, name TEXT NOT NULL)`,
		`INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
		 VALUES ('u1', '旧用户', 'old@demo.edu', 'hash', 'STUDENT', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
	}
	for _, statement := range legacyStatements {
		if _, err := raw.Exec(statement); err != nil {
			t.Fatalf("创建 v2 结构失败: %v", err)
		}
	}

	if err := Migrate(raw); err != nil {
		t.Fatalf("迁移旧库失败: %v", err)
	}

	hasLoginID, err := tableHasColumn(raw, "users", "login_id")
	if err != nil {
		t.Fatalf("检查 users.login_id 失败: %v", err)
	}
	if !hasLoginID {
		t.Fatal("v2 旧库应被重建为含 login_id 的 v3 users 表")
	}

	var users int
	if err := raw.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		t.Fatalf("统计 v3 users 失败: %v", err)
	}
	if users != 0 {
		t.Errorf("重建后旧用户数据应被清空，实际还有 %d 条", users)
	}

	var topics int
	if err := raw.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'topics'`,
	).Scan(&topics); err != nil {
		t.Fatalf("检查 topics 表失败: %v", err)
	}
	if topics != 1 {
		t.Error("重建后缺少 topics 表")
	}
}

// TestSeedDemoData 确认种子数据的数量、密码可空规则与演示附件。
func TestSeedDemoData(t *testing.T) {
	dir := t.TempDir()
	database, err := Open(filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer func() { _ = database.Close() }()

	uploadDir := filepath.Join(dir, "uploads")
	seeded, err := Seed(database, uploadDir)
	if err != nil {
		t.Fatalf("写入种子数据失败: %v", err)
	}
	if !seeded {
		t.Fatal("空库应写入种子数据")
	}

	want := map[string]int{
		"users":                 6,
		"teacher_students":      6,
		"classes":               2,
		"class_members":         6,
		"topics":                3,
		"topic_assistants":      1,
		"topic_members":         7,
		"topic_groups":          2,
		"group_members":         3,
		"submissions":           1,
		"submission_files":      2,
		"evaluation_dimensions": 3,
		"evaluations":           1,
		"evaluation_scores":     3,
	}
	for table, expected := range want {
		var count int
		if err := database.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil {
			t.Fatalf("统计 %s 失败: %v", table, err)
		}
		if count != expected {
			t.Errorf("%s 数量应为 %d，实际为 %d", table, expected, count)
		}
	}

	// 班级：初二（3）班 4 人、数学兴趣小组 2 人。
	var mainClassMembers int
	if err := database.QueryRow(
		`SELECT COUNT(*) FROM class_members m JOIN classes c ON c.id = m.class_id
		 WHERE c.name = '初二（3）班' AND m.removed_at IS NULL`,
	).Scan(&mainClassMembers); err != nil {
		t.Fatalf("统计班级成员失败: %v", err)
	}
	if mainClassMembers != 4 {
		t.Errorf("初二（3）班应有 4 名有效学生，实际 %d", mainClassMembers)
	}

	// 课题 1：GROUP 模式、2 个小组、小组提交 student_id 为空且 group_id 非空。
	var (
		submitMode  string
		groupMin    int
		groupMax    int
		allowGroups int
		className   string
	)
	if err := database.QueryRow(
		`SELECT t.submit_mode, t.group_min, t.group_max, t.allow_student_groups, c.name
		 FROM topics t JOIN classes c ON c.id = t.class_id
		 WHERE t.title = '校园气象站数据记录'`,
	).Scan(&submitMode, &groupMin, &groupMax, &allowGroups, &className); err != nil {
		t.Fatalf("读取课题 1 配置失败: %v", err)
	}
	if submitMode != "GROUP" || groupMin != 2 || groupMax != 4 || allowGroups != 1 {
		t.Errorf("课题 1 分组配置不符：mode=%s min=%d max=%d allow=%d",
			submitMode, groupMin, groupMax, allowGroups)
	}
	if className != "初二（3）班" {
		t.Errorf("课题 1 应属于初二（3）班，实际 %s", className)
	}

	var (
		groupID      sql.NullString
		studentID    sql.NullString
		submittedBy  sql.NullString
		groupMembers int
	)
	if err := database.QueryRow(
		`SELECT s.group_id, s.student_id, s.submitted_by,
		        (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = s.group_id)
		 FROM submissions s WHERE s.topic_id = (
		   SELECT id FROM topics WHERE title = '校园气象站数据记录'
		 )`,
	).Scan(&groupID, &studentID, &submittedBy, &groupMembers); err != nil {
		t.Fatalf("读取小组提交失败: %v", err)
	}
	if !groupID.Valid || groupID.String == "" {
		t.Error("课题 1 提交应为小组提交（group_id 非空）")
	}
	if studentID.Valid {
		t.Error("小组提交的 student_id 应为 NULL")
	}
	if !submittedBy.Valid {
		t.Error("小组提交应记录实际提交人 submitted_by")
	}
	if groupMembers != 2 {
		t.Errorf("课题 1 提交所属小组应有 2 名成员，实际 %d", groupMembers)
	}

	// 编辑/提交人：
	var creatorName string
	if err := database.QueryRow(
		`SELECT creator.name FROM users student JOIN users creator ON creator.id = student.created_by
		 WHERE student.login_id = 'S001'`,
	).Scan(&creatorName); err != nil {
		t.Fatalf("读取学生创建者失败: %v", err)
	}
	if creatorName != "王老师" {
		t.Errorf("S001 的创建者应为王老师，实际 %s", creatorName)
	}

	// 教师：teacher@demo.edu / li@demo.edu；学生 S001 无密码。
	var (
		teacherHash sql.NullString
		studentHash sql.NullString
	)
	if err := database.QueryRow(
		`SELECT password_hash FROM users WHERE login_id = 'teacher@demo.edu'`,
	).Scan(&teacherHash); err != nil {
		t.Fatalf("读取教师密码失败: %v", err)
	}
	if !teacherHash.Valid || teacherHash.String == "" {
		t.Error("教师账号应设置密码")
	}
	if err := database.QueryRow(
		`SELECT password_hash FROM users WHERE login_id = 'S001'`,
	).Scan(&studentHash); err != nil {
		t.Fatalf("读取学生密码失败: %v", err)
	}
	if studentHash.Valid {
		t.Error("S001 应为无密码账号（password_hash 为 NULL）")
	}

	var teacherRole string
	if err := database.QueryRow(
		`SELECT role FROM users WHERE login_id = 'li@demo.edu'`,
	).Scan(&teacherRole); err != nil {
		t.Fatalf("读取李老师失败: %v", err)
	}
	if teacherRole != "TEACHER" {
		t.Errorf("li@demo.edu 应为 TEACHER，实际为 %s", teacherRole)
	}

	// 历史成员：课题 3 的 S002 removed_at 非空。
	var removed int
	if err := database.QueryRow(
		`SELECT COUNT(*) FROM topic_members m JOIN topics t ON t.id = m.topic_id
		 JOIN users u ON u.id = m.student_id
		 WHERE t.status = 'CLOSED' AND u.login_id = 'S002' AND m.removed_at IS NOT NULL`,
	).Scan(&removed); err != nil {
		t.Fatalf("检查历史成员失败: %v", err)
	}
	if removed != 1 {
		t.Errorf("课题 3 应有 S002 的历史成员关系，实际 %d 条", removed)
	}

	// 演示附件写入磁盘。
	files, err := filepath.Glob(filepath.Join(uploadDir, "submissions", "*", "*"))
	if err != nil {
		t.Fatalf("查找演示附件失败: %v", err)
	}
	if len(files) != 2 {
		t.Errorf("演示附件应为 2 个，实际 %d 个", len(files))
	}
	for _, file := range files {
		info, err := os.Stat(file)
		if err != nil {
			t.Fatalf("演示附件不可读 %s: %v", file, err)
		}
		if info.Size() == 0 {
			t.Errorf("演示附件 %s 不应为空", file)
		}
	}

	// 重复 Seed 应跳过。
	seeded, err = Seed(database, uploadDir)
	if err != nil {
		t.Fatalf("重复写入种子数据失败: %v", err)
	}
	if seeded {
		t.Error("users 非空时不应再次写入种子数据")
	}
}
