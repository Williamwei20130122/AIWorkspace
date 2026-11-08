package db

import (
	"database/sql"
	"fmt"
	"time"

	"aiworkspace/server/internal/auth"
)

// DemoPassword 演示账号统一密码（与 v1 种子数据一致）。
const DemoPassword = "demo1234"

// Seed 在 users 表为空时写入演示数据；返回是否真正写入了数据。
//
// 演示数据与 docs/CONTRACT.md 第 7 节（以及 v1 prisma/seed.mjs）保持一致：
//   - 教师 王老师 teacher@demo.edu
//   - 学生 李小明 student@demo.edu、张小红 xiaohong@demo.edu、
//     陈小军 xiaojun@demo.edu、刘小美 xiaomei@demo.edu
//   - 2 个班级（邀请码 MATH01 / MATH02）、3 门课程、3 份作业（1 份已截止）、
//     4 条提交（2 条已批改）、3 条公告
//   - 密码统一 demo1234，scrypt$salt$hash 格式存储
func Seed(db *sql.DB) (bool, error) {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return false, fmt.Errorf("检查用户表失败: %w", err)
	}
	if count > 0 {
		return false, nil
	}

	tx, err := db.Begin()
	if err != nil {
		return false, fmt.Errorf("开启种子事务失败: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := seedTx(tx); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("提交种子数据失败: %w", err)
	}
	return true, nil
}

// seedTx 在事务内写入全部演示数据。
func seedTx(tx *sql.Tx) error {
	now := time.Now().UTC()
	day := 24 * time.Hour
	ts := FormatTime(now)
	past := func(d time.Duration) string { return FormatTime(now.Add(-d)) }
	future := func(d time.Duration) string { return FormatTime(now.Add(d)) }

	passwordHash, err := auth.HashPassword(DemoPassword)
	if err != nil {
		return fmt.Errorf("生成演示账号密码失败: %w", err)
	}

	// teacherID 在所有插入闭包中共享：先声明，写入教师后再赋值。
	var teacherID string

	insertUser := func(name, email, role, avatarColor string) (string, error) {
		id := NewID("u")
		_, err := tx.Exec(
			`INSERT INTO users (id, name, email, password_hash, role, avatar_color, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id, name, email, passwordHash, role, avatarColor, ts, ts,
		)
		return id, err
	}
	insertClass := func(name, grade, joinCode string) (string, error) {
		id := NewID("c")
		_, err := tx.Exec(
			`INSERT INTO classes (id, name, grade, join_code, teacher_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, name, grade, joinCode, teacherID, ts, ts,
		)
		return id, err
	}
	insertEnrollment := func(classID, studentID string) error {
		_, err := tx.Exec(
			`INSERT INTO enrollments (id, class_id, student_id, created_at) VALUES (?, ?, ?, ?)`,
			NewID("e"), classID, studentID, ts,
		)
		return err
	}
	insertCourse := func(classID, title, description, color string) (string, error) {
		id := NewID("c")
		_, err := tx.Exec(
			`INSERT INTO courses (id, title, description, color, class_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, title, description, color, classID, ts, ts,
		)
		return id, err
	}
	insertAssignment := func(courseID, title, description string, points int, dueAt *string) (string, error) {
		id := NewID("a")
		_, err := tx.Exec(
			`INSERT INTO assignments (id, title, description, due_at, points, course_id, created_by_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, title, description, nullString(dueAt), points, courseID, teacherID, ts, ts,
		)
		return id, err
	}
	insertSubmission := func(assignmentID, studentID, content string, score *int, feedback *string, submittedAt string) error {
		_, err := tx.Exec(
			`INSERT INTO submissions (id, assignment_id, student_id, content, attachment_url, submitted_at, updated_at, score, feedback, graded_at)
			 VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
			NewID("s"), assignmentID, studentID, content, submittedAt, submittedAt, nullInt(score), nullString(feedback), feedbackTime(score, submittedAt),
		)
		return err
	}
	insertAnnouncement := func(classID, title, content, createdAt string) error {
		_, err := tx.Exec(
			`INSERT INTO announcements (id, title, content, class_id, created_at) VALUES (?, ?, ?, ?, ?)`,
			NewID("n"), title, content, classID, createdAt,
		)
		return err
	}

	// ---------- 用户 ----------
	teacherID, err = insertUser("王老师", "teacher@demo.edu", "TEACHER", "#0D9488")
	if err != nil {
		return fmt.Errorf("写入教师账号失败: %w", err)
	}
	limingID, err := insertUser("李小明", "student@demo.edu", "STUDENT", "#D97706")
	if err != nil {
		return fmt.Errorf("写入学生账号失败: %w", err)
	}
	xiaohongID, err := insertUser("张小红", "xiaohong@demo.edu", "STUDENT", "#2563EB")
	if err != nil {
		return fmt.Errorf("写入学生账号失败: %w", err)
	}
	xiaojunID, err := insertUser("陈小军", "xiaojun@demo.edu", "STUDENT", "#7C3AED")
	if err != nil {
		return fmt.Errorf("写入学生账号失败: %w", err)
	}
	xiaomeiID, err := insertUser("刘小美", "xiaomei@demo.edu", "STUDENT", "#DB2777")
	if err != nil {
		return fmt.Errorf("写入学生账号失败: %w", err)
	}

	// ---------- 班级 ----------
	classA, err := insertClass("初二（3）班", "初二", "MATH01")
	if err != nil {
		return fmt.Errorf("写入班级失败: %w", err)
	}
	classB, err := insertClass("初二数学兴趣小组", "初二", "MATH02")
	if err != nil {
		return fmt.Errorf("写入班级失败: %w", err)
	}

	// ---------- 入班关系 ----------
	enrollments := []struct {
		classID   string
		studentID string
	}{
		{classA, limingID},
		{classA, xiaohongID},
		{classA, xiaojunID},
		{classA, xiaomeiID},
		{classB, limingID},
		{classB, xiaohongID},
	}
	for _, e := range enrollments {
		if err := insertEnrollment(e.classID, e.studentID); err != nil {
			return fmt.Errorf("写入入班关系失败: %w", err)
		}
	}

	// ---------- 课程 ----------
	mathID, err := insertCourse(classA, "数学", "人教版八年级上册：有理数、整式与几何证明基础", "#0D9488")
	if err != nil {
		return fmt.Errorf("写入课程失败: %w", err)
	}
	physicsID, err := insertCourse(classA, "物理", "八年级物理：声、光、电基础与实验", "#D97706")
	if err != nil {
		return fmt.Errorf("写入课程失败: %w", err)
	}
	if _, err := insertCourse(classB, "数学思维拓展", "每周一次的兴趣小组：趣味数论与几何变换", "#2563EB"); err != nil {
		return fmt.Errorf("写入课程失败: %w", err)
	}

	// ---------- 作业（第 2 份已截止） ----------
	due1 := future(3 * day)
	due2 := past(2 * day)
	due3 := future(5 * day)
	assignment1, err := insertAssignment(mathID, "第一章 有理数 单元练习",
		"完成练习册 P12–P18：有理数的加减乘除与混合运算。要求写出关键步骤，拍照或直接录入过程。", 100, &due1)
	if err != nil {
		return fmt.Errorf("写入作业失败: %w", err)
	}
	assignment2, err := insertAssignment(mathID, "几何证明入门：全等三角形",
		"完成两道证明题，说明所用判定定理（SSS / SAS / ASA / AAS）。", 100, &due2)
	if err != nil {
		return fmt.Errorf("写入作业失败: %w", err)
	}
	assignment3, err := insertAssignment(physicsID, "实验报告：测量小灯泡的电阻",
		"按实验报告格式记录：实验目的、器材、电路图、数据表格、误差分析。可上传文字版报告。", 50, &due3)
	if err != nil {
		return fmt.Errorf("写入作业失败: %w", err)
	}
	_ = assignment3

	// ---------- 提交（2 条已批改、2 条待批改） ----------
	score92 := 92
	grade72 := "步骤完整，符号处理正确。第 15 题可再检查一遍计算顺序。"
	if err := insertSubmission(assignment1, limingID,
		"练习册 P12–P18 已完成。\n1) (-3) + 5 - (-2) = 4；\n2) (-2)^3 × (-3) = 24；\n3) 混合运算部分：先乘除后加减，注意符号。\n易错点：负负得正时括号处理。",
		&score92, &grade72, past(26*time.Hour)); err != nil {
		return fmt.Errorf("写入提交失败: %w", err)
	}
	if err := insertSubmission(assignment1, xiaohongID,
		"已提交：P12–P18 全部完成，最后一页练习题附了解题过程。",
		nil, nil, past(8*time.Hour)); err != nil {
		return fmt.Errorf("写入提交失败: %w", err)
	}
	score85 := 85
	grade85 := "第一题思路清晰；第二题记得先作垂线再说明。"
	if err := insertSubmission(assignment2, limingID,
		"1) 用 SAS 证明 △ABC ≌ △DEF；2) 用 ASA 证明角平分线上的点到两边距离相等。",
		&score85, &grade85, past(3*day)); err != nil {
		return fmt.Errorf("写入提交失败: %w", err)
	}
	if err := insertSubmission(assignment2, xiaohongID,
		"两道证明题已完成，写在作业本上并拍照整理。",
		nil, nil, past(3*day-2*time.Hour)); err != nil {
		return fmt.Errorf("写入提交失败: %w", err)
	}

	// ---------- 公告 ----------
	announcements := []struct {
		classID   string
		title     string
		content   string
		createdAt string
	}{
		{classA, "期中考试安排", "期中考试定于下周三上午 8:30–10:10 在教室进行，范围：有理数、整式、全等三角形。", past(6 * time.Hour)},
		{classA, "实验课提醒", "本周五物理实验课请提前 5 分钟到实验室，穿运动鞋，勿携带食品。", past(30 * time.Hour)},
		{classB, "兴趣小组活动", "本周六上午 9:00 在图书馆三楼开展数学思维拓展活动，欢迎带一道有趣的题来分享。", past(2 * day)},
	}
	for _, a := range announcements {
		if err := insertAnnouncement(a.classID, a.title, a.content, a.createdAt); err != nil {
			return fmt.Errorf("写入公告失败: %w", err)
		}
	}
	return nil
}

// nullString 把可空字符串转成 SQL 参数。
func nullString(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

// nullInt 把可空整数转成 SQL 参数。
func nullInt(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// feedbackTime 有分数时返回提交后 2 小时的批改时间，保持“批改晚于提交”的演示语义。
func feedbackTime(score *int, submittedAt string) any {
	if score == nil {
		return nil
	}
	t, err := time.Parse(time.RFC3339, submittedAt)
	if err != nil {
		return submittedAt
	}
	return FormatTime(t.Add(2 * time.Hour))
}
