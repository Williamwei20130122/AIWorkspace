package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"aiworkspace/server/internal/models"
)

/* ------------------------------------------------------------------ */
/* 教师班级管理（v4）                                                  */
/* ------------------------------------------------------------------ */

// TeacherClasses GET /api/teacher/classes：我创建的班级。
func (h *API) TeacherClasses(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	rows, err := h.DB.QueryContext(r.Context(),
		`SELECT c.id, c.name, c.grade, c.created_at,
		   (SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id AND m.removed_at IS NULL),
		   (SELECT COUNT(*) FROM topics t WHERE t.class_id = c.id)
		 FROM classes c
		 WHERE c.teacher_id = ?
		 ORDER BY c.created_at DESC, c.id`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = rows.Close() }()

	classes := make([]models.TeacherClass, 0)
	for rows.Next() {
		var (
			item  models.TeacherClass
			grade sql.NullString
		)
		if err := rows.Scan(&item.ID, &item.Name, &grade, &item.CreatedAt,
			&item.MemberCount, &item.TopicCount); err != nil {
			serverError(w, err)
			return
		}
		item.Grade = strPtr(grade)
		classes = append(classes, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, classes)
}

// createClassRequest POST /api/teacher/classes 请求体。
type createClassRequest struct {
	Name  string  `json:"name"`
	Grade *string `json:"grade"`
}

// CreateClass POST /api/teacher/classes。
func (h *API) CreateClass(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	var req createClassRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "请输入班级名称")
		return
	}
	if len([]rune(name)) > 100 {
		writeError(w, http.StatusBadRequest, "班级名称过长")
		return
	}
	grade := gradePtr(req.Grade)
	if grade != nil && len([]rune(*grade)) > 50 {
		writeError(w, http.StatusBadRequest, "年级过长")
		return
	}
	timestamp := now()
	classID := newID("c")
	if _, err := h.DB.ExecContext(r.Context(),
		`INSERT INTO classes (id, name, grade, teacher_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		classID, name, nullableString(grade), user.ID, timestamp, timestamp,
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.CreatedID{ID: classID})
}

// TeacherClassDetail GET /api/teacher/classes/{id}：班级学生与课题。
func (h *API) TeacherClassDetail(w http.ResponseWriter, r *http.Request) {
	class, ok := h.requireOwnerClass(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	ctx := r.Context()
	detail := models.TeacherClassDetail{
		ID:       class.ID,
		Name:     class.Name,
		Grade:    class.Grade,
		Students: []models.ClassStudent{},
		Topics:   []models.ClassTopic{},
	}

	rows, err := h.DB.QueryContext(ctx,
		`SELECT m.student_id, u.name, u.login_id, m.removed_at
		 FROM class_members m JOIN users u ON u.id = m.student_id
		 WHERE m.class_id = ?
		 ORDER BY (m.removed_at IS NOT NULL), u.name, m.student_id`, class.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var (
			item      models.ClassStudent
			removedAt sql.NullString
		)
		if err := rows.Scan(&item.ID, &item.Name, &item.LoginID, &removedAt); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		item.RemovedAt = strPtr(removedAt)
		detail.Students = append(detail.Students, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	rows, err = h.DB.QueryContext(ctx,
		`SELECT id, title, status FROM topics WHERE class_id = ?
		 ORDER BY updated_at DESC, id`, class.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var item models.ClassTopic
		if err := rows.Scan(&item.ID, &item.Title, &item.Status); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		detail.Topics = append(detail.Topics, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	writeJSON(w, http.StatusOK, detail)
}

// updateClassRequest PATCH /api/teacher/classes/{id} 请求体。
type updateClassRequest struct {
	Name  *string `json:"name"`
	Grade *string `json:"grade"`
}

// UpdateClass PATCH /api/teacher/classes/{id}。
func (h *API) UpdateClass(w http.ResponseWriter, r *http.Request) {
	class, ok := h.requireOwnerClass(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	var req updateClassRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	name := class.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if name == "" {
			writeError(w, http.StatusBadRequest, "请输入班级名称")
			return
		}
		if len([]rune(name)) > 100 {
			writeError(w, http.StatusBadRequest, "班级名称过长")
			return
		}
	}
	grade := class.Grade
	if req.Grade != nil {
		grade = gradePtr(req.Grade)
		if grade != nil && len([]rune(*grade)) > 50 {
			writeError(w, http.StatusBadRequest, "年级过长")
			return
		}
	}
	if _, err := h.DB.ExecContext(r.Context(),
		`UPDATE classes SET name = ?, grade = ?, updated_at = ? WHERE id = ?`,
		name, nullableString(grade), now(), class.ID,
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

// addClassStudentRequest POST /api/teacher/classes/{id}/students 请求体。
type addClassStudentRequest struct {
	LoginID   string `json:"loginId"`
	StudentID string `json:"studentId"`
}

// AddClassStudent POST /api/teacher/classes/{id}/students：只能添加自己管理的学生。
func (h *API) AddClassStudent(w http.ResponseWriter, r *http.Request) {
	class, ok := h.requireOwnerClass(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	var req addClassStudentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	ctx := r.Context()
	student, ok := h.resolveStudentForClass(w, r, req.StudentID, req.LoginID)
	if !ok {
		return
	}
	var managed int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM teacher_students WHERE teacher_id = ? AND student_id = ?`,
		currentUser(r).ID, student.ID,
	).Scan(&managed); err != nil {
		serverError(w, err)
		return
	}
	if managed == 0 {
		writeError(w, http.StatusForbidden, "只能添加自己管理的学生")
		return
	}

	var (
		memberID  string
		removedAt sql.NullString
	)
	err := h.DB.QueryRowContext(ctx,
		`SELECT id, removed_at FROM class_members WHERE class_id = ? AND student_id = ?`,
		class.ID, student.ID,
	).Scan(&memberID, &removedAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if _, err := h.DB.ExecContext(ctx,
			`INSERT INTO class_members (id, class_id, student_id, joined_at, removed_at)
			 VALUES (?, ?, ?, ?, NULL)`,
			newID("cm"), class.ID, student.ID, now(),
		); err != nil {
			serverError(w, err)
			return
		}
	case err != nil:
		serverError(w, err)
		return
	case removedAt.Valid:
		if _, err := h.DB.ExecContext(ctx,
			`UPDATE class_members SET removed_at = NULL WHERE id = ?`, memberID,
		); err != nil {
			serverError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusCreated, models.OK{OK: true})
}

// resolveStudentForClass 解析请求里的学生（id 或 loginId）；失败时已写好响应。
func (h *API) resolveStudentForClass(w http.ResponseWriter, r *http.Request, studentID, loginID string) (*models.User, bool) {
	ctx := r.Context()
	var (
		student *models.User
		err     error
	)
	switch {
	case strings.TrimSpace(studentID) != "":
		student, _, err = h.getUserByID(ctx, strings.TrimSpace(studentID))
	case strings.TrimSpace(loginID) != "":
		student, _, err = h.getUserByLoginID(ctx, strings.TrimSpace(loginID))
	default:
		writeError(w, http.StatusBadRequest, "请选择学生")
		return nil, false
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "学生不存在")
		return nil, false
	}
	if err != nil {
		serverError(w, err)
		return nil, false
	}
	if student.Role != roleStudent {
		writeError(w, http.StatusBadRequest, "只能添加学生账号")
		return nil, false
	}
	return student, true
}

// RemoveClassStudent DELETE /api/teacher/classes/{id}/students/{studentId}：置 removed_at 保留历史。
func (h *API) RemoveClassStudent(w http.ResponseWriter, r *http.Request) {
	class, ok := h.requireOwnerClass(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	result, err := h.DB.ExecContext(r.Context(),
		`UPDATE class_members SET removed_at = ?
		 WHERE class_id = ? AND student_id = ? AND removed_at IS NULL`,
		now(), class.ID, r.PathValue("studentId"))
	if err != nil {
		serverError(w, err)
		return
	}
	affected, err := result.RowsAffected()
	if err != nil {
		serverError(w, err)
		return
	}
	if affected == 0 {
		writeError(w, http.StatusNotFound, "该学生不在班级中")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* ------------------------------------------------------------------ */
/* 学生班级（v4）                                                      */
/* ------------------------------------------------------------------ */

// StudentClasses GET /api/student/classes：我所在的班级。
func (h *API) StudentClasses(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	rows, err := h.DB.QueryContext(r.Context(),
		`SELECT c.id, c.name, c.grade, COALESCE(t.name, ''),
		   (SELECT COUNT(*) FROM class_members cm WHERE cm.class_id = c.id AND cm.removed_at IS NULL),
		   (SELECT COUNT(*) FROM topics tp WHERE tp.class_id = c.id)
		 FROM class_members m
		 JOIN classes c ON c.id = m.class_id
		 LEFT JOIN users t ON t.id = c.teacher_id
		 WHERE m.student_id = ? AND m.removed_at IS NULL
		 ORDER BY c.name, c.id`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = rows.Close() }()

	classes := make([]models.StudentClass, 0)
	for rows.Next() {
		var (
			item        models.StudentClass
			grade       sql.NullString
			teacherName string
		)
		if err := rows.Scan(&item.ID, &item.Name, &grade, &teacherName,
			&item.MemberCount, &item.TopicCount); err != nil {
			serverError(w, err)
			return
		}
		item.Grade = strPtr(grade)
		item.Teacher = models.NameOnly{Name: teacherName}
		classes = append(classes, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, classes)
}
