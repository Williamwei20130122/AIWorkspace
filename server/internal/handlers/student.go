package handlers

import (
	"database/sql"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"aiworkspace/server/internal/db"
	"aiworkspace/server/internal/models"
)

// joinCodePattern 邀请码格式：6 位大写字母 / 数字。
var joinCodePattern = regexp.MustCompile(`^[A-Z0-9]{6}$`)

/* ------------------------------------------------------------------ */
/* 工作台                                                              */
/* ------------------------------------------------------------------ */

// StudentOverview GET /api/student/overview：学生工作台统计。
func (h *API) StudentOverview(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	overview := models.StudentOverview{
		DueSoon:             []models.DueSoonAssignment{},
		RecentAnnouncements: []models.AnnouncementWithClass{},
	}

	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM enrollments WHERE student_id = ?`, user.ID).Scan(&overview.ClassCount); err != nil {
		serverError(w, err)
		return
	}
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM courses WHERE class_id IN (SELECT class_id FROM enrollments WHERE student_id = ?)`, user.ID,
	).Scan(&overview.CourseCount); err != nil {
		serverError(w, err)
		return
	}

	// 已加入班级的全部作业 + 我的提交（LEFT JOIN 保证未提交的作业也在列表里）
	now := db.Now()
	rows, err := h.DB.QueryContext(ctx, `
		SELECT a.id, a.title, a.points, a.due_at, c.title, cl.name, s.id, s.score
		FROM assignments a
		JOIN courses c ON a.course_id = c.id
		JOIN classes cl ON c.class_id = cl.id
		LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
		WHERE c.class_id IN (SELECT class_id FROM enrollments WHERE student_id = ?)
		ORDER BY a.due_at ASC, a.created_at DESC, a.id DESC`, user.ID, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	gradedCount := 0
	percentSum := 0.0
	for rows.Next() {
		var (
			assignmentID, title    string
			points                 int
			dueAt                  sql.NullString
			courseTitle, className string
			submissionID           sql.NullString
			score                  sql.NullInt64
		)
		if err := rows.Scan(&assignmentID, &title, &points, &dueAt, &courseTitle, &className, &submissionID, &score); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		if !submissionID.Valid {
			overview.PendingCount++
			if dueAt.Valid && dueAt.String >= now && len(overview.DueSoon) < 5 {
				overview.DueSoon = append(overview.DueSoon, models.DueSoonAssignment{
					ID:     assignmentID,
					Title:  title,
					DueAt:  strPtr(dueAt),
					Points: points,
					Course: models.CourseTitleClass{
						Title: courseTitle,
						Class: models.ClassName{Name: className},
					},
				})
			}
			continue
		}
		overview.SubmittedCount++
		if score.Valid && points > 0 {
			gradedCount++
			percentSum += float64(score.Int64) / float64(points) * 100
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		serverError(w, err)
		return
	}
	if err := rows.Close(); err != nil {
		serverError(w, err)
		return
	}
	if gradedCount > 0 {
		average := int(math.Round(percentSum / float64(gradedCount)))
		overview.AveragePercent = &average
	}

	// 最近公告（已加入班级，最多 4 条）
	rows, err = h.DB.QueryContext(ctx, `
		SELECT an.id, an.title, an.content, an.created_at, cl.name
		FROM announcements an
		JOIN classes cl ON an.class_id = cl.id
		WHERE an.class_id IN (SELECT class_id FROM enrollments WHERE student_id = ?)
		ORDER BY an.created_at DESC, an.id DESC
		LIMIT 4`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var (
			announcement models.AnnouncementWithClass
			className    string
		)
		if err := rows.Scan(&announcement.ID, &announcement.Title, &announcement.Content, &announcement.CreatedAt, &className); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		announcement.Class = models.ClassName{Name: className}
		overview.RecentAnnouncements = append(overview.RecentAnnouncements, announcement)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		serverError(w, err)
		return
	}
	if err := rows.Close(); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, overview)
}

/* ------------------------------------------------------------------ */
/* 班级                                                                */
/* ------------------------------------------------------------------ */

// StudentClasses GET /api/student/classes：我加入的班级与课程。
func (h *API) StudentClasses(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	rows, err := h.DB.QueryContext(ctx, `
		SELECT cl.id, cl.name, t.name, t.email,
		       (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = cl.id)
		FROM classes cl
		JOIN users t ON cl.teacher_id = t.id
		JOIN enrollments en ON en.class_id = cl.id AND en.student_id = ?
		ORDER BY cl.created_at DESC, cl.id DESC`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}

	classes := make([]models.StudentClass, 0)
	for rows.Next() {
		var class models.StudentClass
		if err := rows.Scan(&class.ID, &class.Name, &class.Teacher.Name, &class.Teacher.Email, &class.StudentCount); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		class.Courses = []models.StudentCourse{}
		classes = append(classes, class)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		serverError(w, err)
		return
	}
	if err := rows.Close(); err != nil {
		serverError(w, err)
		return
	}

	// 课程按班级归组
	index := make(map[string]int, len(classes))
	for i := range classes {
		index[classes[i].ID] = i
	}
	courseRows, err := h.DB.QueryContext(ctx, `
		SELECT c.id, c.class_id, c.title,
		       (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id)
		FROM courses c
		WHERE c.class_id IN (SELECT class_id FROM enrollments WHERE student_id = ?)
		ORDER BY c.created_at ASC, c.id ASC`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for courseRows.Next() {
		var (
			courseID, classID, title string
			assignmentCount          int
		)
		if err := courseRows.Scan(&courseID, &classID, &title, &assignmentCount); err != nil {
			courseRows.Close()
			serverError(w, err)
			return
		}
		if i, ok := index[classID]; ok {
			classes[i].Courses = append(classes[i].Courses, models.StudentCourse{
				ID:              courseID,
				Title:           title,
				AssignmentCount: assignmentCount,
			})
		}
	}
	if err := courseRows.Err(); err != nil {
		courseRows.Close()
		serverError(w, err)
		return
	}
	if err := courseRows.Close(); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, classes)
}

// JoinClass POST /api/student/classes/join：用邀请码加入班级（重复加入幂等）。
func (h *API) JoinClass(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	var req struct {
		JoinCode string `json:"joinCode"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.JoinCode))
	if !joinCodePattern.MatchString(code) {
		writeError(w, http.StatusBadRequest, "邀请码为 6 位字母数字")
		return
	}

	var classID, className string
	err := h.DB.QueryRowContext(ctx, `SELECT id, name FROM classes WHERE join_code = ?`, code).Scan(&classID, &className)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "没有找到这个邀请码对应的班级")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}

	if _, err := h.DB.ExecContext(ctx, `
		INSERT OR IGNORE INTO enrollments (id, class_id, student_id, created_at)
		VALUES (?, ?, ?, ?)`, db.NewID("e"), classID, user.ID, db.Now()); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, models.JoinResult{OK: true, ClassName: className})
}

/* ------------------------------------------------------------------ */
/* 作业                                                                */
/* ------------------------------------------------------------------ */

// StudentAssignments GET /api/student/assignments：已加入班级的全部作业。
func (h *API) StudentAssignments(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	rows, err := h.DB.QueryContext(ctx, `
		SELECT a.id, a.title, a.points, a.due_at, c.title, cl.id, cl.name,
		       s.id, s.submitted_at, s.content, s.score, s.feedback, s.graded_at
		FROM assignments a
		JOIN courses c ON a.course_id = c.id
		JOIN classes cl ON c.class_id = cl.id
		LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
		WHERE c.class_id IN (SELECT class_id FROM enrollments WHERE student_id = ?)
		ORDER BY a.due_at ASC, a.created_at DESC, a.id DESC`, user.ID, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}

	assignments := make([]models.StudentAssignment, 0)
	for rows.Next() {
		var (
			assignment   models.StudentAssignment
			dueAt        sql.NullString
			submissionID sql.NullString
			submittedAt  sql.NullString
			content      sql.NullString
			score        sql.NullInt64
			feedback     sql.NullString
			gradedAt     sql.NullString
		)
		if err := rows.Scan(&assignment.ID, &assignment.Title, &assignment.Points, &dueAt,
			&assignment.Course.Title, &assignment.Course.Class.ID, &assignment.Course.Class.Name,
			&submissionID, &submittedAt, &content, &score, &feedback, &gradedAt); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		assignment.DueAt = strPtr(dueAt)
		if submissionID.Valid {
			assignment.MySubmission = &models.MySubmission{
				ID:          submissionID.String,
				SubmittedAt: submittedAt.String,
				Content:     content.String,
				Score:       intPtr(score),
				Feedback:    strPtr(feedback),
				GradedAt:    strPtr(gradedAt),
			}
		}
		assignments = append(assignments, assignment)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		serverError(w, err)
		return
	}
	if err := rows.Close(); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, assignments)
}

// StudentAssignmentDetail GET /api/student/assignments/{id}：作业详情与我的提交。
func (h *API) StudentAssignmentDetail(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	assignmentID := strings.TrimSpace(r.PathValue("id"))
	if assignmentID == "" {
		writeError(w, http.StatusNotFound, "作业不存在或你不在该班级")
		return
	}

	var (
		detail       models.StudentAssignmentDetail
		description  sql.NullString
		dueAt        sql.NullString
		submissionID sql.NullString
		submittedAt  sql.NullString
		content      sql.NullString
		score        sql.NullInt64
		feedback     sql.NullString
		gradedAt     sql.NullString
	)
	err := h.DB.QueryRowContext(ctx, `
		SELECT a.id, a.title, a.description, a.points, a.due_at,
		       c.title, cl.id, cl.name, t.name,
		       s.id, s.submitted_at, s.content, s.score, s.feedback, s.graded_at
		FROM assignments a
		JOIN courses c ON a.course_id = c.id
		JOIN classes cl ON c.class_id = cl.id
		JOIN users t ON cl.teacher_id = t.id
		LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
		WHERE a.id = ? AND cl.id IN (SELECT class_id FROM enrollments WHERE student_id = ?)`,
		user.ID, assignmentID, user.ID,
	).Scan(&detail.ID, &detail.Title, &description, &detail.Points, &dueAt,
		&detail.Course.Title, &detail.Course.Class.ID, &detail.Course.Class.Name, &detail.Course.Class.Teacher.Name,
		&submissionID, &submittedAt, &content, &score, &feedback, &gradedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "作业不存在或你不在该班级")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	detail.Description = strPtr(description)
	detail.DueAt = strPtr(dueAt)
	if submissionID.Valid {
		detail.MySubmission = &models.MySubmission{
			ID:          submissionID.String,
			SubmittedAt: submittedAt.String,
			Content:     content.String,
			Score:       intPtr(score),
			Feedback:    strPtr(feedback),
			GradedAt:    strPtr(gradedAt),
		}
	}

	writeJSON(w, http.StatusOK, detail)
}

// SubmitAssignment POST /api/student/assignments/{id}/submit：提交 / 重新提交作业。
// 重新提交会清空原分数、评语与批改时间，等待教师重新批改。
func (h *API) SubmitAssignment(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	assignmentID := strings.TrimSpace(r.PathValue("id"))
	if assignmentID == "" {
		writeError(w, http.StatusNotFound, "作业不存在或你不在该班级")
		return
	}

	var req struct {
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		writeError(w, http.StatusBadRequest, "请填写作业内容")
		return
	}
	if utf8.RuneCountInString(content) > 5000 {
		writeError(w, http.StatusBadRequest, "内容过长")
		return
	}

	var exists int
	if err := h.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM assignments a
		JOIN courses c ON a.course_id = c.id
		WHERE a.id = ? AND c.class_id IN (SELECT class_id FROM enrollments WHERE student_id = ?)`,
		assignmentID, user.ID).Scan(&exists); err != nil {
		serverError(w, err)
		return
	}
	if exists == 0 {
		writeError(w, http.StatusNotFound, "作业不存在或你不在该班级")
		return
	}

	now := db.Now()
	if _, err := h.DB.ExecContext(ctx, `
		INSERT INTO submissions (id, assignment_id, student_id, content, attachment_url, submitted_at, updated_at, score, feedback, graded_at)
		VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL)
		ON CONFLICT(assignment_id, student_id) DO UPDATE SET
			content = excluded.content,
			submitted_at = excluded.submitted_at,
			updated_at = excluded.updated_at,
			score = NULL,
			feedback = NULL,
			graded_at = NULL`,
		db.NewID("s"), assignmentID, user.ID, content, now, now); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

/* ------------------------------------------------------------------ */
/* 成绩单                                                              */
/* ------------------------------------------------------------------ */

// StudentGrades GET /api/student/grades：已批改作业的成绩列表。
func (h *API) StudentGrades(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	rows, err := h.DB.QueryContext(ctx, `
		SELECT s.id, s.score, s.feedback, s.submitted_at,
		       a.id, a.title, a.points, a.due_at, c.title, cl.name
		FROM submissions s
		JOIN assignments a ON s.assignment_id = a.id
		JOIN courses c ON a.course_id = c.id
		JOIN classes cl ON c.class_id = cl.id
		WHERE s.student_id = ? AND s.score IS NOT NULL
		ORDER BY s.submitted_at DESC, s.id DESC`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}

	grades := make([]models.Grade, 0)
	for rows.Next() {
		var (
			grade    models.Grade
			feedback sql.NullString
			dueAt    sql.NullString
		)
		if err := rows.Scan(&grade.ID, &grade.Score, &feedback, &grade.SubmittedAt,
			&grade.Assignment.ID, &grade.Assignment.Title, &grade.Assignment.Points, &dueAt,
			&grade.Assignment.Course.Title, &grade.Assignment.Course.Class.Name); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		grade.Feedback = strPtr(feedback)
		grade.Assignment.DueAt = strPtr(dueAt)
		grades = append(grades, grade)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		serverError(w, err)
		return
	}
	if err := rows.Close(); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, grades)
}
