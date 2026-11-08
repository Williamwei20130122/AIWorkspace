package db

import (
	"database/sql"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"time"

	"aiworkspace/server/internal/auth"
)

// DemoPassword 演示账号统一密码。
const DemoPassword = "demo1234"

// Seed 在 users 表为空时写入 v4 演示数据；返回是否真正写入了数据。
//
// 演示数据与 docs/CONTRACT.md 第 10.5 节（v4）保持一致：
//   - 教师 王老师 teacher@demo.edu、李老师 li@demo.edu（密码 demo1234）
//   - 学生 李小明 S001（无密码）、张小红 S002（demo1234）、
//     陈小军 S003（无密码）、刘小美 S004（无密码）
//   - 2 个班级（初二（3）班：S001–S004；数学兴趣小组：S001/S002）
//   - 3 个课题：课题 1 为小组模式（2 个小组、小组提交 + 评价），
//     课题 2 个人模式，课题 3 已结题且 S002 为历史成员
//   - 课题 1 小组提交的 2 个演示附件会写入 UPLOAD_DIR
func Seed(db *sql.DB, uploadDir string) (bool, error) {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return false, fmt.Errorf("检查用户表失败: %w", err)
	}
	if count > 0 {
		return false, nil
	}

	if uploadDir != "" {
		if err := os.MkdirAll(uploadDir, 0o755); err != nil {
			return false, fmt.Errorf("创建上传目录 %s 失败: %w", uploadDir, err)
		}
	}

	tx, err := db.Begin()
	if err != nil {
		return false, fmt.Errorf("开启种子事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := seedTx(tx, uploadDir); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("提交种子数据失败: %w", err)
	}
	return true, nil
}

// seedTx 在事务内写入全部演示数据，并把演示附件写入 uploadDir。
func seedTx(tx *sql.Tx, uploadDir string) error {
	now := time.Now().UTC()
	day := 24 * time.Hour
	past := func(d time.Duration) string { return FormatTime(now.Add(-d)) }

	passwordHash, err := auth.HashPassword(DemoPassword)
	if err != nil {
		return fmt.Errorf("生成演示账号密码失败: %w", err)
	}

	insertUser := func(name, loginID, role, avatarColor string, password *string, createdBy *string, createdAt string) (string, error) {
		id := NewID("u")
		_, err := tx.Exec(
			`INSERT INTO users (id, login_id, name, role, password_hash, avatar_color, created_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, loginID, name, role, nullString(password), avatarColor, nullString(createdBy), createdAt, createdAt,
		)
		return id, err
	}
	insertClass := func(name string, grade *string, teacherID, createdAt string) (string, error) {
		id := NewID("c")
		_, err := tx.Exec(
			`INSERT INTO classes (id, name, grade, teacher_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			id, name, nullString(grade), teacherID, createdAt, createdAt,
		)
		return id, err
	}
	insertClassMember := func(classID, studentID, joinedAt string, removedAt *string) error {
		_, err := tx.Exec(
			`INSERT INTO class_members (id, class_id, student_id, joined_at, removed_at)
			 VALUES (?, ?, ?, ?, ?)`,
			NewID("cm"), classID, studentID, joinedAt, nullString(removedAt),
		)
		return err
	}
	insertTopic := func(title, descriptionMD, ownerID, status, classID, submitMode string,
		groupMin, groupMax int, allowStudentGroups bool, createdAt, updatedAt string) (string, error) {
		id := NewID("t")
		_, err := tx.Exec(
			`INSERT INTO topics (id, title, description_md, owner_id, status, join_mode,
			                     class_id, submit_mode, group_min, group_max, allow_student_groups,
			                     created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'ASSIGNED', ?, ?, ?, ?, ?, ?, ?)`,
			id, title, descriptionMD, ownerID, status, classID, submitMode,
			groupMin, groupMax, allowStudentGroups, createdAt, updatedAt,
		)
		return id, err
	}
	insertTopicMember := func(topicID, studentID, joinedAt string, removedAt *string) error {
		_, err := tx.Exec(
			`INSERT INTO topic_members (id, topic_id, student_id, joined_at, removed_at) VALUES (?, ?, ?, ?, ?)`,
			NewID("tm"), topicID, studentID, joinedAt, nullString(removedAt),
		)
		return err
	}
	insertGroup := func(topicID, name, createdBy, createdAt string) (string, error) {
		id := NewID("g")
		_, err := tx.Exec(
			`INSERT INTO topic_groups (id, topic_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
			id, topicID, name, createdBy, createdAt,
		)
		return id, err
	}
	insertGroupMember := func(groupID, studentID, joinedAt string) error {
		_, err := tx.Exec(
			`INSERT INTO group_members (group_id, student_id, joined_at) VALUES (?, ?, ?)`,
			groupID, studentID, joinedAt,
		)
		return err
	}
	insertDimension := func(topicID, name string, maxScore, sortOrder int, createdAt string) (string, error) {
		id := NewID("dim")
		_, err := tx.Exec(
			`INSERT INTO evaluation_dimensions (id, topic_id, name, max_score, sort_order, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			id, topicID, name, maxScore, sortOrder, createdAt,
		)
		return id, err
	}
	insertSubmission := func(topicID string, studentID, groupID, submittedBy *string,
		textContent, createdAt, updatedAt string) (string, error) {
		id := NewID("s")
		_, err := tx.Exec(
			`INSERT INTO submissions (id, topic_id, student_id, group_id, submitted_by,
			                          text_content, updated_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id, topicID, nullString(studentID), nullString(groupID), nullString(submittedBy),
			textContent, updatedAt, createdAt,
		)
		return id, err
	}
	insertEvaluation := func(submissionID, teacherID, comment, createdAt string) (string, error) {
		id := NewID("ev")
		_, err := tx.Exec(
			`INSERT INTO evaluations (id, submission_id, teacher_id, comment, created_at) VALUES (?, ?, ?, ?, ?)`,
			id, submissionID, teacherID, comment, createdAt,
		)
		return id, err
	}
	insertScore := func(evaluationID, dimensionID string, score int) error {
		_, err := tx.Exec(
			`INSERT INTO evaluation_scores (id, evaluation_id, dimension_id, score) VALUES (?, ?, ?, ?)`,
			NewID("es"), evaluationID, dimensionID, score,
		)
		return err
	}

	// ---------- 用户 ----------
	wangID, err := insertUser("王老师", "teacher@demo.edu", "TEACHER", "#0D9488", &passwordHash, nil, past(30*day))
	if err != nil {
		return fmt.Errorf("写入教师账号失败: %w", err)
	}
	liID, err := insertUser("李老师", "li@demo.edu", "TEACHER", "#2563EB", &passwordHash, nil, past(28*day))
	if err != nil {
		return fmt.Errorf("写入教师账号失败: %w", err)
	}
	limingID, err := insertUser("李小明", "S001", "STUDENT", "#D97706", nil, &wangID, past(25*day))
	if err != nil {
		return fmt.Errorf("写入学生账号失败: %w", err)
	}
	xiaohongID, err := insertUser("张小红", "S002", "STUDENT", "#DB2777", &passwordHash, &wangID, past(25*day))
	if err != nil {
		return fmt.Errorf("写入学生账号失败: %w", err)
	}
	xiaojunID, err := insertUser("陈小军", "S003", "STUDENT", "#7C3AED", nil, &wangID, past(24*day))
	if err != nil {
		return fmt.Errorf("写入学生账号失败: %w", err)
	}
	xiaomeiID, err := insertUser("刘小美", "S004", "STUDENT", "#059669", nil, &wangID, past(24*day))
	if err != nil {
		return fmt.Errorf("写入学生账号失败: %w", err)
	}

	// ---------- 教师-学生管理关系（一个学生可被多个老师管理） ----------
	links := []struct {
		teacherID string
		studentID string
	}{
		{wangID, limingID}, {wangID, xiaohongID}, {wangID, xiaojunID}, {wangID, xiaomeiID},
		{liID, limingID}, {liID, xiaohongID},
	}
	for _, link := range links {
		if _, err := tx.Exec(
			`INSERT INTO teacher_students (teacher_id, student_id, created_at) VALUES (?, ?, ?)`,
			link.teacherID, link.studentID, past(24*day),
		); err != nil {
			return fmt.Errorf("写入教师学生关系失败: %w", err)
		}
	}

	// ---------- 班级（v4） ----------
	grade := "初二"
	mainClassID, err := insertClass("初二（3）班", &grade, wangID, past(24*day))
	if err != nil {
		return fmt.Errorf("写入班级失败: %w", err)
	}
	clubClassID, err := insertClass("数学兴趣小组", &grade, wangID, past(20*day))
	if err != nil {
		return fmt.Errorf("写入班级失败: %w", err)
	}
	classMembers := []struct {
		classID   string
		studentID string
	}{
		{mainClassID, limingID}, {mainClassID, xiaohongID},
		{mainClassID, xiaojunID}, {mainClassID, xiaomeiID},
		{clubClassID, limingID}, {clubClassID, xiaohongID},
	}
	for _, member := range classMembers {
		if err := insertClassMember(member.classID, member.studentID, past(24*day), nil); err != nil {
			return fmt.Errorf("写入班级成员失败: %w", err)
		}
	}

	// ---------- 课题 ----------
	weatherDescription := `# 校园气象站数据记录

本课题围绕校园气象站，开展为期两周的数据采集与分析。本课题为**小组合作**，请以小组为单位提交。

## 任务要求

1. 每天早上 8:00 与下午 16:00 记录气温、湿度与风速；
2. 用表格整理至少 10 天的数据；
3. 绘制气温变化折线图，并写出 200 字以上的分析。

## 参考

- 实验楼三楼气象站
- 数据记录表模板见班级共享文件夹`

	bookDescription := `# 班级图书角运营方案

为班级图书角设计一套可持续的运营方案（个人独立完成）。

## 需要包含

1. 图书分类与编号规则；
2. 借阅登记与归还提醒流程；
3. 一个月的活动计划（推荐书单、读书分享）。

## 成果形式

一份运营方案文档 + 一张图书角布局示意图。`

	plantDescription := `# 校园植物观察

选择校园内的一种植物，连续观察并记录它的生长变化。

本课题已经结题，提交与评价保留用于回顾与展示。`

	weatherTopicID, err := insertTopic("校园气象站数据记录", weatherDescription, wangID, "ACTIVE",
		mainClassID, "GROUP", 2, 4, true, past(12*day), past(2*day))
	if err != nil {
		return fmt.Errorf("写入课题失败: %w", err)
	}
	bookTopicID, err := insertTopic("班级图书角运营方案", bookDescription, wangID, "ACTIVE",
		mainClassID, "INDIVIDUAL", 2, 4, false, past(10*day), past(4*day))
	if err != nil {
		return fmt.Errorf("写入课题失败: %w", err)
	}
	plantTopicID, err := insertTopic("校园植物观察（已结题）", plantDescription, wangID, "CLOSED",
		mainClassID, "INDIVIDUAL", 2, 4, false, past(20*day), past(6*day))
	if err != nil {
		return fmt.Errorf("写入课题失败: %w", err)
	}

	// 课题 1 助教：李老师
	if _, err := tx.Exec(
		`INSERT INTO topic_assistants (id, topic_id, teacher_id, created_at) VALUES (?, ?, ?, ?)`,
		NewID("ta"), weatherTopicID, liID, past(11*day),
	); err != nil {
		return fmt.Errorf("写入课题助教失败: %w", err)
	}

	// ---------- 课题成员 ----------
	topicMembers := []struct {
		topicID   string
		studentID string
		joinedAt  string
		removedAt *string
	}{
		{weatherTopicID, limingID, past(11 * day), nil},
		{weatherTopicID, xiaohongID, past(11 * day), nil},
		{weatherTopicID, xiaojunID, past(11 * day), nil},
		{bookTopicID, limingID, past(9 * day), nil},
		{bookTopicID, xiaohongID, past(9 * day), nil},
		{bookTopicID, xiaomeiID, past(9 * day), nil},
		{plantTopicID, xiaohongID, past(19 * day), stringPtr(past(5 * day))},
	}
	for _, member := range topicMembers {
		if err := insertTopicMember(member.topicID, member.studentID, member.joinedAt, member.removedAt); err != nil {
			return fmt.Errorf("写入课题成员失败: %w", err)
		}
	}

	// ---------- 课题 1 分组（老师建组） ----------
	weatherGroupA, err := insertGroup(weatherTopicID, "气象观测一组", "teacher", past(11*day))
	if err != nil {
		return fmt.Errorf("写入小组失败: %w", err)
	}
	weatherGroupB, err := insertGroup(weatherTopicID, "气象观测二组", "teacher", past(11*day))
	if err != nil {
		return fmt.Errorf("写入小组失败: %w", err)
	}
	groupAssignments := []struct {
		groupID   string
		studentID string
	}{
		{weatherGroupA, limingID},
		{weatherGroupA, xiaojunID},
		{weatherGroupB, xiaohongID},
	}
	for _, assignment := range groupAssignments {
		if err := insertGroupMember(assignment.groupID, assignment.studentID, past(11*day)); err != nil {
			return fmt.Errorf("写入小组成员失败: %w", err)
		}
	}

	// ---------- 评价维度（课题 1） ----------
	dimensionNames := []struct {
		name      string
		maxScore  int
		sortOrder int
	}{
		{"数据完整性", 100, 0},
		{"分析质量", 100, 1},
		{"规范表达", 100, 2},
	}
	dimensionIDs := make([]string, 0, len(dimensionNames))
	for _, dimension := range dimensionNames {
		id, err := insertDimension(weatherTopicID, dimension.name, dimension.maxScore, dimension.sortOrder, past(12*day))
		if err != nil {
			return fmt.Errorf("写入评价维度失败: %w", err)
		}
		dimensionIDs = append(dimensionIDs, id)
	}

	// ---------- 提交：课题 1 小组 A 的小组提交（李小明提交） ----------
	groupSubmissionID, err := insertSubmission(weatherTopicID, nil, &weatherGroupA, &limingID,
		`我们小组完成了校园气象站连续 10 天的数据记录。
记录表见附件一，气温变化折线图说明见附件二。

分析：11 月中旬昼夜温差逐渐增大，午后 14:00 前后气温最高；晴天湿度明显低于阴天，风速与降温过程相关性较强。`,
		past(36*time.Hour), past(30*time.Hour))
	if err != nil {
		return fmt.Errorf("写入提交失败: %w", err)
	}

	// ---------- 演示附件（课题 1 小组提交：2 个文件） ----------
	demoFiles := []struct {
		originalName string
		extension    string
		content      string
	}{
		{
			originalName: "气象记录表.md",
			extension:    ".md",
			content: `# 校园气象站数据记录表

| 日期 | 08:00 气温(℃) | 16:00 气温(℃) | 湿度(%) | 风速(m/s) |
| --- | --- | --- | --- | --- |
| 11-11 | 12.4 | 19.8 | 63 | 1.8 |
| 11-12 | 11.9 | 18.6 | 68 | 2.1 |
| 11-13 | 10.5 | 17.2 | 72 | 2.4 |
| 11-14 | 9.8 | 16.4 | 75 | 3.0 |
| 11-15 | 10.2 | 18.1 | 70 | 2.2 |

结论：昼夜温差逐日增大，午后气温最高，风速与降温过程明显相关。`,
		},
		{
			originalName: "气温折线图说明.txt",
			extension:    ".txt",
			content: `气温变化折线图说明

横轴：11 月 11 日 — 11 月 20 日（共 10 天）
纵轴：气温（℃），范围 5 — 25
两条折线：每天早上 8:00（蓝色）与下午 16:00（橙色）

主要发现：
1. 下午气温整体高于早上约 6 — 8℃；
2. 11 月 17 日出现明显降温，两天内下降约 4℃；
3. 晴天（11-12、11-13）湿度较低，阴天湿度明显上升。

（折线图图片见课堂投影，数据源为上表。）`,
		},
	}
	for _, demo := range demoFiles {
		fileID := NewID("f")
		storagePath := path.Join("submissions", groupSubmissionID, fileID+demo.extension)
		if err := writeSeedFile(uploadDir, storagePath, demo.content); err != nil {
			return fmt.Errorf("写入演示附件失败: %w", err)
		}
		if _, err := tx.Exec(
			`INSERT INTO submission_files (id, submission_id, original_name, mime_type, size_bytes, storage_path, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			fileID, groupSubmissionID, demo.originalName, mimeTypeForExtension(demo.extension),
			int64(len(demo.content)), storagePath, past(30*time.Hour),
		); err != nil {
			return fmt.Errorf("写入演示附件记录失败: %w", err)
		}
	}

	// ---------- 评价：课题 1 小组提交的评价 ----------
	weatherEvaluationID, err := insertEvaluation(groupSubmissionID, wangID,
		"小组分工明确，数据完整、记录规范，折线图说明抓住了昼夜温差与湿度变化；分析部分可以再补充一周的对比数据。",
		past(26*time.Hour))
	if err != nil {
		return fmt.Errorf("写入评价失败: %w", err)
	}
	weatherScores := []int{90, 85, 88}
	for index, dimensionID := range dimensionIDs {
		if err := insertScore(weatherEvaluationID, dimensionID, weatherScores[index]); err != nil {
			return fmt.Errorf("写入评价分数失败: %w", err)
		}
	}

	return nil
}

// writeSeedFile 把演示附件写入 UPLOAD_DIR 下的相对路径。
func writeSeedFile(uploadDir, storagePath, content string) error {
	if uploadDir == "" {
		return nil
	}
	absolute := filepath.Join(uploadDir, filepath.FromSlash(storagePath))
	if err := os.MkdirAll(filepath.Dir(absolute), 0o755); err != nil {
		return err
	}
	return os.WriteFile(absolute, []byte(content), 0o644)
}

// mimeTypeForExtension 给演示附件一个合理的 MIME。
func mimeTypeForExtension(extension string) string {
	switch extension {
	case ".md":
		return "text/markdown; charset=utf-8"
	case ".txt":
		return "text/plain; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}

// nullString 把可空字符串转成 SQL 参数。
func nullString(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

// stringPtr 返回字符串指针，便于构造可空时间列。
func stringPtr(value string) *string {
	return &value
}
