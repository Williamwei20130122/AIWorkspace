// Package db 负责 SQLite 数据库的打开、建表迁移与演示数据种子。
package db

import (
	"crypto/rand"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

// Now 返回统一格式的当前 UTC 时间字符串（RFC3339）。
func Now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// FormatTime 把时间转成统一的 RFC3339（UTC）字符串。
func FormatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

// Open 打开（必要时创建）SQLite 数据库文件并执行建表迁移。
func Open(path string) (*sql.DB, error) {
	if path == "" {
		return nil, fmt.Errorf("DATABASE_PATH 不能为空")
	}
	// 确保数据库文件所在目录存在（默认 ./data/app.db）。
	if path != ":memory:" {
		if dir := filepath.Dir(path); dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("创建数据库目录 %s 失败: %w", dir, err)
			}
		}
	}

	dsn := sqliteDSN(path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败: %w", err)
	}
	// SQLite 同一时刻只允许一个写者；单连接可避免 SQLITE_BUSY，本系统数据量很小。
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("连接数据库失败: %w", err)
	}
	if err := Migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// sqliteDSN 构造 modernc.org/sqlite 的连接串，开启 WAL、外键与忙等待。
func sqliteDSN(path string) string {
	if path == ":memory:" {
		return "file::memory:?cache=shared&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)"
	}
	return "file:" + filepath.ToSlash(path) +
		"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)"
}

// Migrate 执行内嵌 schema.sql 建表（每条语句单独执行，可重复调用）。
//
// v2（班级 / 任务模型）与本版本的 users 表结构不兼容，因此在建表前先检测
// 旧库：若 users 表存在但没有 login_id 列，说明是 v2 数据库，直接丢弃旧
// 业务表后按 v3 重建（v3 是一次产品模型重构，旧数据无法无损迁移）。
func Migrate(db *sql.DB) error {
	if err := dropLegacySchema(db); err != nil {
		return err
	}
	for _, stmt := range strings.Split(schemaSQL, ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("执行数据库迁移失败: %w", err)
		}
	}
	return nil
}

// legacyTables 是 v2 及 v3 可能出现的全部表名，按“子表在前”的顺序重建。
var legacyTables = []string{
	"evaluation_scores",
	"evaluation_dimensions",
	"evaluations",
	"submission_files",
	"topic_members",
	"topic_assistants",
	"submissions",
	"topics",
	"teacher_students",
	"announcements",
	"assignments",
	"courses",
	"enrollments",
	"classes",
	"users",
}

// dropLegacySchema 检测 v2 数据库并清理旧表；全新库 / 已是 v3 时不做任何事。
func dropLegacySchema(db *sql.DB) error {
	var tableCount int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'users'`,
	).Scan(&tableCount); err != nil {
		return fmt.Errorf("检查数据库结构失败: %w", err)
	}
	if tableCount == 0 {
		return nil
	}

	hasLoginID, err := tableHasColumn(db, "users", "login_id")
	if err != nil {
		return err
	}
	if hasLoginID {
		return nil
	}

	log.Printf("检测到 v2（班级 / 任务模型）数据库结构，按 v3 契约重建数据表（旧数据不会保留）")
	for _, table := range legacyTables {
		if _, err := db.Exec("DROP TABLE IF EXISTS " + table); err != nil {
			return fmt.Errorf("清理旧表 %s 失败: %w", table, err)
		}
	}
	return nil
}

// tableHasColumn 判断表是否存在指定列。
func tableHasColumn(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return false, fmt.Errorf("读取表 %s 结构失败: %w", table, err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var (
			cid          int
			name         string
			columnType   string
			notNull      int
			defaultValue any
			pk           int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return false, fmt.Errorf("解析表 %s 结构失败: %w", table, err)
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

// NewID 生成带前缀的随机 id（cuid 风格，24 位十六进制随机串）。
func NewID(prefix string) string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand 在正常系统上不会失败；失败说明运行环境异常，直接终止更安全。
		panic("生成随机 id 失败: " + err.Error())
	}
	return prefix + hex.EncodeToString(buf)
}
