package handlers

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"aiworkspace/server/internal/db"
	"aiworkspace/server/internal/models"
)

// joinCodeAlphabet 生成邀请码用的字符集（去掉易混淆的 I / O / 0 / 1）。
const joinCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// newJoinCode 生成 6 位大写邀请码。
func newJoinCode() (string, error) {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, 6)
	for i, b := range buf {
		out[i] = joinCodeAlphabet[int(b)%len(joinCodeAlphabet)]
	}
	return string(out), nil
}

/* ------------------------------------------------------------------ */
/* 工作台                                                              */
/* ------------------------------------------------------------------ */

// TeacherOverview GET /api/teacher/overview：教师工作台统计。
func (h *API) TeacherOverview(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	overview := models.TeacherOverview{
		RecentSubmissions:   []models.RecentSubmission{},
		UpcomingAssignments: []models.UpcomingAssignment{},
	}

	count := func(query string) (int, error) {
		var n int
		err := h.DB.QueryRowContext(ctx, query, user.ID).Scan(&n)
		return n, err
	}

	var err error
	if overview.ClassCount, err = count(`SELECT COUNT(*) FROM classes WHERE teacher_id = ?`); err != nil {
		serverError(w, err)
		return
	}
	if overview.CourseCount, err = count(`SELECT COUNT(*) FROM courses c
		JOIN classes cl ON c.class_id = cl.id WHERE cl.teacher_id = ?`); err != nil {
		serverError(w, err)
		return
	}
	if overview.StudentCount, err = count(`SELECT COUNT(DISTINCT e.student_id) FROM enrollments e
		JOIN classes cl ON e.class_id = cl.id WHERE cl.teacher_id = ?`); err != nil {
		serverError(w, err)
		return
	}
	if overview.PendingGrading, err = count(`SELECT COUNT(*) FROM submissions s
		JOIN assignments a ON s.assignment_id = a.id
		JOIN courses c ON a.course_id = c.id
		JOIN classes cl ON c.class_id = cl.id
		WHERE cl.teacher_id = ? AND s.score IS NULL`); err != nil {
		serverError(w, err)
		return
	}

	// 最近提交（最多 6 条）
	rows, err := h.DB.QueryContext(ctx, `
		SELECT s.id, s.submitted_at, s.score,
		       u.id, u.name, u.avatar_color,
		       a.id, a.title, a.points,
		       c.title, cl.name
		FROM submissions s
		JOIN users u ON s.student_id = u.id
		JOIN assignments a ON s.assignment_id = a.id
		JOIN courses c ON a.course_id = c.id
		JOIN classes cl ON c.class_id = cl.id
		WHERE cl.teacher_id = ?
		ORDER BY s.submitted_at DESC, s.id DESC
		LIMIT 6`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var (
			submissionID, submittedAt           string
			score                               sql.NullInt64
			studentID, studentName, avatarColor string
			assignmentID, assignmentTitle       string
			points                              int
			courseTitle, className              string
		)
		if err := rows.Scan(&submissionID, &submittedAt, &score,
			&studentID, &studentName, &avatarColor,
			&assignmentID, &assignmentTitle, &points,
			&courseTitle, &className); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		overview.RecentSubmissions = append(overview.RecentSubmissions, models.RecentSubmission{
			ID:          submissionID,
			SubmittedAt: submittedAt,
			Score:       intPtr(score),
			Student: models.StudentBrief{
				ID:          studentID,
				Name:        studentName,
				AvatarColor: avatarColor,
			},
			Assignment: models.AssignmentSummary{
				ID:     assignmentID,
				Title:  assignmentTitle,
				Points: points,
				Course: models.CourseTitleClass{
					Title: courseTitle,
					Class: models.ClassName{Name: className},
				},
			},
		})
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

	// 即将截止（未来 5 条）
	now := db.Now()
	rows, err = h.DB.QueryContext(ctx, `
		SELECT a.id, a.title, a.due_at, a.points, c.title, cl.name,
		       (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id)
		FROM assignments a
		JOIN courses c ON a.course_id = c.id
		JOIN classes cl ON c.class_id = cl.id
		WHERE cl.teacher_id = ? AND a.due_at IS NOT NULL AND a.due_at >= ?
		ORDER BY a.due_at ASC, a.id ASC
		LIMIT 5`, user.ID, now)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var (
			assignmentID, assignmentTitle string
			dueAt                         sql.NullString
			points                        int
			courseTitle, className        string
			submittedCount                int
		)
		if err := rows.Scan(&assignmentID, &assignmentTitle, &dueAt, &points,
			&courseTitle, &className, &submittedCount); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		overview.UpcomingAssignments = append(overview.UpcomingAssignments, models.UpcomingAssignment{
			ID:     assignmentID,
			Title:  assignmentTitle,
			DueAt:  strPtr(dueAt),
			Points: points,
			Course: models.CourseTitleClass{
				Title: courseTitle,
				Class: models.ClassName{Name: className},
			},
			SubmittedCount: submittedCount,
		})
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

// TeacherClasses GET /api/teacher/classes：当前教师的班级列表。
func (h *API) TeacherClasses(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	rows, err := h.DB.QueryContext(ctx, `
		SELECT cl.id, cl.name, cl.grade, cl.join_code, cl.created_at,
		       (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = cl.id),
		       (SELECT COUNT(*) FROM courses c WHERE c.class_id = cl.id)
		FROM classes cl
		WHERE cl.teacher_id = ?
		ORDER BY cl.created_at DESC, cl.id DESC`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}

	classes := make([]models.TeacherClass, 0)
	for rows.Next() {
		var (
			class models.TeacherClass
			grade sql.NullString
		)
		if err := rows.Scan(&class.ID, &class.Name, &grade, &class.JoinCode, &class.CreatedAt,
			&class.EnrollmentCount, &class.CourseCount); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		class.Grade = strPtr(grade)
		class.Courses = []models.CourseBrief{}
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

	// 一次性取出这些班级的课程，按班级归组。
	courseRows, err := h.DB.QueryContext(ctx, `
		SELECT c.id, c.class_id, c.title, c.color
		FROM courses c
		JOIN classes cl ON c.class_id = cl.id
		WHERE cl.teacher_id = ?
		ORDER BY c.created_at ASC, c.id ASC`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	index := make(map[string]int, len(classes))
	for i := range classes {
		index[classes[i].ID] = i
	}
	for courseRows.Next() {
		var courseID, classID, title, color string
		if err := courseRows.Scan(&courseID, &classID, &title, &color); err != nil {
			courseRows.Close()
			serverError(w, err)
			return
		}
		if i, ok := index[classID]; ok {
			classes[i].Courses = append(classes[i].Courses, models.CourseBrief{
				ID:    courseID,
				Title: title,
				Color: color,
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

// CreateClass POST /api/teacher/classes：创建班级并分配唯一邀请码。
func (h *API) CreateClass(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	var req struct {
		Name  string  `json:"name"`
		Grade *string `json:"grade"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "请输入班级名称")
		return
	}
	if utf8.RuneCountInString(name) > 40 {
		writeError(w, http.StatusBadRequest, "班级名称过长")
		return
	}
	grade := trimPtr(req.Grade)
	if grade != nil && utf8.RuneCountInString(*grade) > 20 {
		writeError(w, http.StatusBadRequest, "年级过长")
		return
	}

	now := db.Now()
	for attempt := 0; attempt < 10; attempt++ {
		code, err := newJoinCode()
		if err != nil {
			serverError(w, err)
			return
		}
		var exists int
		if err := h.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM classes WHERE join_code = ?`, code).Scan(&exists); err != nil {
			serverError(w, err)
			return
		}
		if exists > 0 {
			continue
		}

		classID := db.NewID("c")
		_, err = h.DB.ExecContext(ctx, `
			INSERT INTO classes (id, name, grade, join_code, teacher_id, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			classID, name, nullString(grade), code, user.ID, now, now)
		if err != nil {
			// 极小概率撞码：换一个邀请码重试。
			if strings.Contains(strings.ToUpper(err.Error()), "UNIQUE") {
				continue
			}
			serverError(w, err)
			return
		}

		writeJSON(w, http.StatusCreated, models.TeacherClass{
			ID:              classID,
			Name:            name,
			Grade:           grade,
			JoinCode:        code,
			CreatedAt:       now,
			EnrollmentCount: 0,
			CourseCount:     0,
			Courses:         []models.CourseBrief{},
		})
		return
	}

	serverError(w, errors.New("邀请码连续冲突，创建班级失败"))
}

// TeacherClassDetail GET /api/teacher/classes/{id}：班级详情（学生、课程、公告）。
func (h *API) TeacherClassDetail(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	classID := strings.TrimSpace(r.PathValue("id"))
	if classID == "" {
		writeError(w, http.StatusNotFound, "班级不存在或无权访问")
		return
	}

	detail := models.TeacherClassDetail{
		Students:      []models.ClassStudent{},
		Courses:       []models.ClassCourse{},
		Announcements: []models.Announcement{},
	}
	var grade sql.NullString
	err := h.DB.QueryRowContext(ctx, `
		SELECT cl.id, cl.name, cl.grade, cl.join_code, t.name, t.email
		FROM classes cl
		JOIN users t ON cl.teacher_id = t.id
		WHERE cl.id = ? AND cl.teacher_id = ?`, classID, user.ID,
	).Scan(&detail.ID, &detail.Name, &grade, &detail.JoinCode, &detail.Teacher.Name, &detail.Teacher.Email)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "班级不存在或无权访问")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	detail.Grade = strPtr(grade)

	// 学生名单
	rows, err := h.DB.QueryContext(ctx, `
		SELECT u.id, u.name, u.email, u.avatar_color, e.created_at
		FROM enrollments e
		JOIN users u ON e.student_id = u.id
		WHERE e.class_id = ?
		ORDER BY e.created_at ASC, u.id ASC`, classID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var student models.ClassStudent
		if err := rows.Scan(&student.ID, &student.Name, &student.Email, &student.AvatarColor, &student.CreatedAt); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		detail.Students = append(detail.Students, student)
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

	// 课程（先读完课程行，再逐门查作业统计，避免单连接嵌套查询）
	type courseRow struct {
		id          string
		title       string
		description sql.NullString
		color       string
	}
	courseRows := make([]courseRow, 0)
	rows, err = h.DB.QueryContext(ctx, `
		SELECT id, title, description, color
		FROM courses
		WHERE class_id = ?
		ORDER BY created_at ASC, id ASC`, classID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var course courseRow
		if err := rows.Scan(&course.id, &course.title, &course.description, &course.color); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		courseRows = append(courseRows, course)
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
	for _, course := range courseRows {
		item := models.ClassCourse{
			ID:                course.id,
			Title:             course.title,
			Description:       strPtr(course.description),
			Color:             course.color,
			RecentAssignments: []models.AssignmentBrief{},
		}
		if err := h.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM assignments WHERE course_id = ?`, course.id).Scan(&item.AssignmentCount); err != nil {
			serverError(w, err)
			return
		}
		assignmentRows, err := h.DB.QueryContext(ctx, `
			SELECT id, title, due_at
			FROM assignments
			WHERE course_id = ?
			ORDER BY created_at DESC, id DESC
			LIMIT 3`, course.id)
		if err != nil {
			serverError(w, err)
			return
		}
		for assignmentRows.Next() {
			var (
				assignmentID, title string
				dueAt               sql.NullString
			)
			if err := assignmentRows.Scan(&assignmentID, &title, &dueAt); err != nil {
				assignmentRows.Close()
				serverError(w, err)
				return
			}
			item.RecentAssignments = append(item.RecentAssignments, models.AssignmentBrief{
				ID:    assignmentID,
				Title: title,
				DueAt: strPtr(dueAt),
			})
		}
		if err := assignmentRows.Err(); err != nil {
			assignmentRows.Close()
			serverError(w, err)
			return
		}
		if err := assignmentRows.Close(); err != nil {
			serverError(w, err)
			return
		}
		detail.Courses = append(detail.Courses, item)
	}

	// 公告（最近 5 条）
	rows, err = h.DB.QueryContext(ctx, `
		SELECT id, title, content, created_at
		FROM announcements
		WHERE class_id = ?
		ORDER BY created_at DESC, id DESC
		LIMIT 5`, classID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var announcement models.Announcement
		if err := rows.Scan(&announcement.ID, &announcement.Title, &announcement.Content, &announcement.CreatedAt); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		detail.Announcements = append(detail.Announcements, announcement)
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

	writeJSON(w, http.StatusOK, detail)
}

// CreateCourse POST /api/teacher/classes/{id}/courses：在班级下创建课程。
func (h *API) CreateCourse(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	classID := strings.TrimSpace(r.PathValue("id"))
	if classID == "" {
		writeError(w, http.StatusNotFound, "班级不存在或无权访问")
		return
	}

	var req struct {
		Title       string  `json:"title"`
		Description *string `json:"description"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		writeError(w, http.StatusBadRequest, "请输入课程名称")
		return
	}
	if utf8.RuneCountInString(title) > 60 {
		writeError(w, http.StatusBadRequest, "课程名称过长")
		return
	}
	description := trimPtr(req.Description)
	if description != nil && utf8.RuneCountInString(*description) > 500 {
		writeError(w, http.StatusBadRequest, "课程简介过长")
		return
	}

	var exists int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM classes WHERE id = ? AND teacher_id = ?`, classID, user.ID,
	).Scan(&exists); err != nil {
		serverError(w, err)
		return
	}
	if exists == 0 {
		writeError(w, http.StatusNotFound, "班级不存在或无权访问")
		return
	}

	now := db.Now()
	courseID := db.NewID("c")
	if _, err := h.DB.ExecContext(ctx, `
		INSERT INTO courses (id, title, description, color, class_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		courseID, title, nullString(description), "#0D9488", classID, now, now); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, models.CreatedCourse{
		ID:          courseID,
		Title:       title,
		Description: description,
		Color:       "#0D9488",
		ClassID:     classID,
		CreatedAt:   now,
	})
}

// CreateAnnouncement POST /api/teacher/classes/{id}/announcements：发布班级公告。
func (h *API) CreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	classID := strings.TrimSpace(r.PathValue("id"))
	if classID == "" {
		writeError(w, http.StatusNotFound, "班级不存在或无权访问")
		return
	}

	var req struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	title := strings.TrimSpace(req.Title)
	content := strings.TrimSpace(req.Content)
	switch {
	case title == "":
		writeError(w, http.StatusBadRequest, "请输入公告标题")
		return
	case utf8.RuneCountInString(title) > 80:
		writeError(w, http.StatusBadRequest, "标题过长")
		return
	case content == "":
		writeError(w, http.StatusBadRequest, "请输入公告内容")
		return
	case utf8.RuneCountInString(content) > 2000:
		writeError(w, http.StatusBadRequest, "内容过长")
		return
	}

	var exists int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM classes WHERE id = ? AND teacher_id = ?`, classID, user.ID,
	).Scan(&exists); err != nil {
		serverError(w, err)
		return
	}
	if exists == 0 {
		writeError(w, http.StatusNotFound, "班级不存在或无权访问")
		return
	}

	now := db.Now()
	announcementID := db.NewID("n")
	if _, err := h.DB.ExecContext(ctx, `
		INSERT INTO announcements (id, title, content, class_id, created_at)
		VALUES (?, ?, ?, ?, ?)`, announcementID, title, content, classID, now); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, models.CreatedAnnouncement{
		ID:        announcementID,
		Title:     title,
		Content:   content,
		ClassID:   classID,
		CreatedAt: now,
	})
}

/* ------------------------------------------------------------------ */
/* 作业与批改                                                          */
/* ------------------------------------------------------------------ */

// CreateAssignment POST /api/teacher/assignments：发布作业。
func (h *API) CreateAssignment(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	var req struct {
		CourseID    string  `json:"courseId"`
		Title       string  `json:"title"`
		Description *string `json:"description"`
		Points      int     `json:"points"`
		DueAt       *string `json:"dueAt"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}

	courseID := strings.TrimSpace(req.CourseID)
	if courseID == "" {
		writeError(w, http.StatusBadRequest, "请选择课程")
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		writeError(w, http.StatusBadRequest, "请输入作业标题")
		return
	}
	if utf8.RuneCountInString(title) > 80 {
		writeError(w, http.StatusBadRequest, "作业标题过长")
		return
	}
	description := trimPtr(req.Description)
	if description != nil && utf8.RuneCountInString(*description) > 2000 {
		writeError(w, http.StatusBadRequest, "作业要求过长")
		return
	}
	if req.Points < 1 {
		writeError(w, http.StatusBadRequest, "分值至少 1")
		return
	}
	if req.Points > 1000 {
		writeError(w, http.StatusBadRequest, "分值过大")
		return
	}
	dueAt, err := parseDateTime(req.DueAt)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var exists int
	if err := h.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM courses c
		JOIN classes cl ON c.class_id = cl.id
		WHERE c.id = ? AND cl.teacher_id = ?`, courseID, user.ID).Scan(&exists); err != nil {
		serverError(w, err)
		return
	}
	if exists == 0 {
		writeError(w, http.StatusNotFound, "课程不存在或无权访问")
		return
	}

	now := db.Now()
	assignmentID := db.NewID("a")
	if _, err := h.DB.ExecContext(ctx, `
		INSERT INTO assignments (id, title, description, due_at, points, course_id, created_by_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		assignmentID, title, nullString(description), nullString(dueAt), req.Points, courseID, user.ID, now, now); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, models.CreatedAssignment{ID: assignmentID})
}

// TeacherAssignments GET /api/teacher/assignments：当前教师的全部作业。
func (h *API) TeacherAssignments(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	rows, err := h.DB.QueryContext(ctx, `
		SELECT a.id, a.title, a.points, a.due_at, a.created_at,
		       c.id, c.title, cl.id, cl.name,
		       (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id),
		       (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.score IS NOT NULL)
		FROM assignments a
		JOIN courses c ON a.course_id = c.id
		JOIN classes cl ON c.class_id = cl.id
		WHERE cl.teacher_id = ?
		ORDER BY a.created_at DESC, a.id DESC`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}

	assignments := make([]models.TeacherAssignment, 0)
	for rows.Next() {
		var (
			assignment models.TeacherAssignment
			dueAt      sql.NullString
		)
		if err := rows.Scan(&assignment.ID, &assignment.Title, &assignment.Points, &dueAt, &assignment.CreatedAt,
			&assignment.Course.ID, &assignment.Course.Title,
			&assignment.Course.Class.ID, &assignment.Course.Class.Name,
			&assignment.SubmittedCount, &assignment.GradedCount); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		assignment.DueAt = strPtr(dueAt)
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

// TeacherAssignmentDetail GET /api/teacher/assignments/{id}：作业详情与全部提交。
func (h *API) TeacherAssignmentDetail(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	assignmentID := strings.TrimSpace(r.PathValue("id"))
	if assignmentID == "" {
		writeError(w, http.StatusNotFound, "作业不存在或无权访问")
		return
	}

	detail := models.TeacherAssignmentDetail{
		Submissions:     []models.GradeSubmission{},
		MissingStudents: []models.StudentContact{},
	}
	var (
		description sql.NullString
		dueAt       sql.NullString
		classID     string
	)
	err := h.DB.QueryRowContext(ctx, `
		SELECT a.id, a.title, a.description, a.points, a.due_at, a.created_at,
		       c.title, cl.id, cl.name
		FROM assignments a
		JOIN courses c ON a.course_id = c.id
		JOIN classes cl ON c.class_id = cl.id
		WHERE a.id = ? AND cl.teacher_id = ?`, assignmentID, user.ID,
	).Scan(&detail.ID, &detail.Title, &description, &detail.Points, &dueAt, &detail.CreatedAt,
		&detail.Course.Title, &classID, &detail.Course.Class.Name)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "作业不存在或无权访问")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	detail.Description = strPtr(description)
	detail.DueAt = strPtr(dueAt)
	detail.Course.Class.ID = classID

	// 已提交列表
	rows, err := h.DB.QueryContext(ctx, `
		SELECT s.id, s.content, s.submitted_at, s.score, s.feedback, s.graded_at,
		       u.id, u.name, u.email, u.avatar_color
		FROM submissions s
		JOIN users u ON s.student_id = u.id
		WHERE s.assignment_id = ?
		ORDER BY s.submitted_at DESC, s.id DESC`, assignmentID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var (
			submission models.GradeSubmission
			score      sql.NullInt64
			feedback   sql.NullString
			gradedAt   sql.NullString
		)
		if err := rows.Scan(&submission.ID, &submission.Content, &submission.SubmittedAt, &score, &feedback, &gradedAt,
			&submission.Student.ID, &submission.Student.Name, &submission.Student.Email, &submission.Student.AvatarColor); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		submission.Score = intPtr(score)
		submission.Feedback = strPtr(feedback)
		submission.GradedAt = strPtr(gradedAt)
		if score.Valid {
			detail.GradedCount++
		}
		detail.Submissions = append(detail.Submissions, submission)
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
	detail.SubmissionCount = len(detail.Submissions)

	// 未提交学生
	rows, err = h.DB.QueryContext(ctx, `
		SELECT u.id, u.name, u.email, u.avatar_color
		FROM enrollments e
		JOIN users u ON e.student_id = u.id
		WHERE e.class_id = ?
		  AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = ? AND s.student_id = u.id)
		ORDER BY e.created_at ASC, u.id ASC`, classID, assignmentID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var student models.StudentContact
		if err := rows.Scan(&student.ID, &student.Name, &student.Email, &student.AvatarColor); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		detail.MissingStudents = append(detail.MissingStudents, student)
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

	writeJSON(w, http.StatusOK, detail)
}

// GradeSubmission POST /api/teacher/submissions/{id}/grade：批改 / 修改批改。
func (h *API) GradeSubmission(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	submissionID := strings.TrimSpace(r.PathValue("id"))
	if submissionID == "" {
		writeError(w, http.StatusNotFound, "提交不存在或无权操作")
		return
	}

	var req struct {
		Score    *int    `json:"score"`
		Feedback *string `json:"feedback"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if req.Score == nil {
		writeError(w, http.StatusBadRequest, "请输入分数")
		return
	}
	if *req.Score < 0 {
		writeError(w, http.StatusBadRequest, "分数不能为负")
		return
	}
	if *req.Score > 1000 {
		writeError(w, http.StatusBadRequest, "分数过大")
		return
	}
	feedback := trimPtr(req.Feedback)
	if feedback != nil && utf8.RuneCountInString(*feedback) > 2000 {
		writeError(w, http.StatusBadRequest, "评语过长")
		return
	}

	var exists int
	if err := h.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM submissions s
		JOIN assignments a ON s.assignment_id = a.id
		JOIN courses c ON a.course_id = c.id
		JOIN classes cl ON c.class_id = cl.id
		WHERE s.id = ? AND cl.teacher_id = ?`, submissionID, user.ID).Scan(&exists); err != nil {
		serverError(w, err)
		return
	}
	if exists == 0 {
		writeError(w, http.StatusNotFound, "提交不存在或无权操作")
		return
	}

	now := db.Now()
	if _, err := h.DB.ExecContext(ctx, `
		UPDATE submissions
		SET score = ?, feedback = ?, graded_at = ?, updated_at = ?
		WHERE id = ?`, *req.Score, nullString(feedback), now, now, submissionID); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, models.OK{OK: true})
}
