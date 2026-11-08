package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

// TestMigrateCreatesV3Schema 确认空库能建出 v3 全部表与关键列。
func TestMigrateCreatesV3Schema(t *testing.T) {
	dir := t.TempDir()
	database, err := Open(filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	defer func() { _ = database.Close() }()

	tables := []string{
		"users", "teacher_students", "topics", "topic_assistants", "topic_members",
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
			t.Errorf("缺少 v3 表 %s", table)
		}
	}

	hasLoginID, err := tableHasColumn(database, "users", "login_id")
	if err != nil {
		t.Fatalf("检查 users.login_id 失败: %v", err)
	}
	if !hasLoginID {
		t.Fatal("users 表缺少 login_id 列")
	}
	hasPasswordHash, err := tableHasColumn(database, "users", "password_hash")
	if err != nil {
		t.Fatalf("检查 users.password_hash 失败: %v", err)
	}
	if !hasPasswordHash {
		t.Fatal("users 表缺少 password_hash 列")
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
		"topics":                3,
		"topic_assistants":      1,
		"topic_members":         6,
		"submissions":           3,
		"submission_files":      2,
		"evaluation_dimensions": 3,
		"evaluations":           2,
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
