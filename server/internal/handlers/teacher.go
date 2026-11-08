package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"aiworkspace/server/internal/auth"
	"aiworkspace/server/internal/models"
)

/* ------------------------------------------------------------------ */
/* 教师工作台 / 课题列表 / 创建                                        */
/* ------------------------------------------------------------------ */

// managedTopicsSQL 是「我管理的课题」的 WHERE 条件（创建者或助教）。
const managedTopicsSQL = `(t.owner_id = ? OR EXISTS (
	SELECT 1 FROM topic_assistants a WHERE a.topic_id = t.id AND a.teacher_id = ?
))`

// TeacherOverview GET /api/teacher/overview。
func (h *API) TeacherOverview(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	overview := models.TeacherOverview{
		RecentEvaluations: []models.RecentEvaluation{},
		Topics:            []models.OverviewTopic{},
	}

	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM teacher_students WHERE teacher_id = ?`, user.ID,
	).Scan(&overview.StudentCount); err != nil {
		serverError(w, err)
		return
	}

	type topicBrief struct{ ID, Title, Status string }
	topics := make([]topicBrief, 0)
	rows, err := h.DB.QueryContext(ctx,
		`SELECT t.id, t.title, t.status FROM topics t
		 WHERE `+managedTopicsSQL+`
		 ORDER BY t.updated_at DESC, t.id`, user.ID, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var item topicBrief
		if err := rows.Scan(&item.ID, &item.Title, &item.Status); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		topics = append(topics, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	overview.TopicCount = len(topics)
	for _, topic := range topics {
		memberCount, submissionCount, pendingCount, err := h.topicStats(ctx, topic.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		overview.PendingEvaluationCount += pendingCount
		overview.Topics = append(overview.Topics, models.OverviewTopic{
			ID:              topic.ID,
			Title:           topic.Title,
			Status:          topic.Status,
			MemberCount:     memberCount,
			SubmissionCount: submissionCount,
			PendingCount:    pendingCount,
		})
	}

	type recentRow struct {
		ID, CreatedAt, Comment, StudentID, StudentName, TopicID, TopicTitle string
	}
	recent := make([]recentRow, 0)
	rows, err = h.DB.QueryContext(ctx,
		`SELECT e.id, e.created_at, e.comment, s.student_id, su.name, t.id, t.title
		 FROM evaluations e
		 JOIN submissions s ON s.id = e.submission_id
		 JOIN topics t ON t.id = s.topic_id
		 JOIN users su ON su.id = s.student_id
		 WHERE `+managedTopicsSQL+`
		 ORDER BY e.created_at DESC, e.id DESC
		 LIMIT 5`, user.ID, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var item recentRow
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.Comment,
			&item.StudentID, &item.StudentName, &item.TopicID, &item.TopicTitle); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		recent = append(recent, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()
	for _, item := range recent {
		overview.RecentEvaluations = append(overview.RecentEvaluations, models.RecentEvaluation{
			ID:        item.ID,
			CreatedAt: item.CreatedAt,
			Comment:   item.Comment,
			Student:   models.IDName{ID: item.StudentID, Name: item.StudentName},
			Topic:     models.IDName{ID: item.TopicID, Name: item.TopicTitle},
		})
	}

	writeJSON(w, http.StatusOK, overview)
}

// topicStats 统计课题的有效成员数、提交数、待评价提交数。
func (h *API) topicStats(ctx context.Context, topicID string) (memberCount, submissionCount, pendingCount int, err error) {
	err = h.DB.QueryRowContext(ctx,
		`SELECT
		   (SELECT COUNT(*) FROM topic_members m WHERE m.topic_id = t.id AND m.removed_at IS NULL),
		   (SELECT COUNT(*) FROM submissions s WHERE s.topic_id = t.id),
		   (SELECT COUNT(*) FROM submissions s WHERE s.topic_id = t.id AND NOT EXISTS (
		      SELECT 1 FROM evaluations e WHERE e.submission_id = s.id))
		 FROM topics t WHERE t.id = ?`, topicID,
	).Scan(&memberCount, &submissionCount, &pendingCount)
	return memberCount, submissionCount, pendingCount, err
}

// TeacherTopics GET /api/teacher/topics?page=1&pageSize=8&status=ALL|ACTIVE|CLOSED&keyword=。
// 返回分页对象 {items, total, page, pageSize}，供课题管理仪表盘/表格使用。
func (h *API) TeacherTopics(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	query := r.URL.Query()
	page := queryInt(query.Get("page"), 1, 1, 100000)
	pageSize := queryInt(query.Get("pageSize"), 8, 1, 50)
	status := strings.ToUpper(strings.TrimSpace(query.Get("status")))
	keyword := strings.TrimSpace(query.Get("keyword"))

	where := managedTopicsSQL
	args := []any{user.ID, user.ID}
	if status == statusActive || status == statusClosed {
		where += " AND t.status = ?"
		args = append(args, status)
	}
	if keyword != "" {
		where += " AND t.title LIKE ?"
		args = append(args, "%"+keyword+"%")
	}

	var total int
	if err := h.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM topics t WHERE `+where, args...).Scan(&total); err != nil {
		serverError(w, err)
		return
	}

	stats := models.TopicStats{}
	statsArgs := []any{user.ID, user.ID}
	if err := h.DB.QueryRowContext(ctx,
		`SELECT
		   COALESCE(SUM(CASE WHEN t.status = ? THEN 1 ELSE 0 END), 0),
		   COALESCE(SUM(CASE WHEN t.status = ? THEN 1 ELSE 0 END), 0)
		 FROM topics t WHERE `+managedTopicsSQL,
		statusActive, statusClosed, user.ID, user.ID,
	).Scan(&stats.Active, &stats.Closed); err != nil {
		serverError(w, err)
		return
	}
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM submissions s
		 JOIN topics t ON t.id = s.topic_id
		 WHERE `+managedTopicsSQL+`
		   AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.submission_id = s.id)`,
		statsArgs...,
	).Scan(&stats.PendingTotal); err != nil {
		serverError(w, err)
		return
	}

	type row struct {
		ID, Title, Status, JoinMode, OwnerID, OwnerName, UpdatedAt string
		MemberCount, SubmissionCount, PendingCount                 int
	}
	dataArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := h.DB.QueryContext(ctx,
		`SELECT t.id, t.title, t.status, t.join_mode, t.owner_id, COALESCE(ou.name, ''), t.updated_at,
		   (SELECT COUNT(*) FROM topic_members m WHERE m.topic_id = t.id AND m.removed_at IS NULL),
		   (SELECT COUNT(*) FROM submissions s WHERE s.topic_id = t.id),
		   (SELECT COUNT(*) FROM submissions s WHERE s.topic_id = t.id AND NOT EXISTS (
		      SELECT 1 FROM evaluations e WHERE e.submission_id = s.id))
		 FROM topics t LEFT JOIN users ou ON ou.id = t.owner_id
		 WHERE `+where+`
		 ORDER BY t.updated_at DESC, t.id
		 LIMIT ? OFFSET ?`, dataArgs...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = rows.Close() }()

	topics := make([]models.TeacherTopic, 0)
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.ID, &item.Title, &item.Status, &item.JoinMode,
			&item.OwnerID, &item.OwnerName, &item.UpdatedAt,
			&item.MemberCount, &item.SubmissionCount, &item.PendingCount); err != nil {
			serverError(w, err)
			return
		}
		topics = append(topics, models.TeacherTopic{
			ID:              item.ID,
			Title:           item.Title,
			Status:          item.Status,
			JoinMode:        item.JoinMode,
			Owner:           models.IDName{ID: item.OwnerID, Name: item.OwnerName},
			IsOwner:         item.OwnerID == user.ID,
			MemberCount:     item.MemberCount,
			SubmissionCount: item.SubmissionCount,
			PendingCount:    item.PendingCount,
			UpdatedAt:       item.UpdatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.TeacherTopicPage{
		Items:    topics,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
		Stats:    stats,
	})
}

// queryInt 解析查询参数中的整数，非法或越界时返回 fallback。
func queryInt(raw string, fallback, min, max int) int {
	v, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || v < min || v > max {
		return fallback
	}
	return v
}

// createTopicRequest POST /api/teacher/topics 请求体。
type createTopicRequest struct {
	Title         string `json:"title"`
	DescriptionMD string `json:"descriptionMd"`
}

// CreateTopic POST /api/teacher/topics。
func (h *API) CreateTopic(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	var req createTopicRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		writeError(w, http.StatusBadRequest, "请输入课题标题")
		return
	}
	if len([]rune(title)) > 200 {
		writeError(w, http.StatusBadRequest, "课题标题过长")
		return
	}
	timestamp := now()
	topicID := newID("t")
	if _, err := h.DB.ExecContext(r.Context(),
		`INSERT INTO topics (id, title, description_md, owner_id, status, join_mode, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		topicID, title, req.DescriptionMD, user.ID, statusActive, joinModeAssigned, timestamp, timestamp,
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.CreatedID{ID: topicID})
}

/* ------------------------------------------------------------------ */
/* 课题详情 / 编辑                                                     */
/* ------------------------------------------------------------------ */

// TeacherTopicDetail GET /api/teacher/topics/{id}。
func (h *API) TeacherTopicDetail(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	ctx := r.Context()

	detail := models.TeacherTopicDetail{
		ID:            topic.ID,
		Title:         topic.Title,
		DescriptionMD: topic.DescriptionMD,
		Status:        topic.Status,
		JoinMode:      topic.JoinMode,
		Owner:         models.IDName{ID: topic.OwnerID, Name: topic.OwnerName},
		Assistants:    []models.TopicAssistant{},
		Students:      []models.TopicStudent{},
		Dimensions:    []models.Dimension{},
		Submissions:   []models.TeacherTopicSubmission{},
	}

	// 助教
	rows, err := h.DB.QueryContext(ctx,
		`SELECT a.teacher_id, u.name, u.login_id
		 FROM topic_assistants a JOIN users u ON u.id = a.teacher_id
		 WHERE a.topic_id = ? ORDER BY a.created_at, u.name`, topic.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var item models.TopicAssistant
		if err := rows.Scan(&item.ID, &item.Name, &item.LoginID); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		detail.Assistants = append(detail.Assistants, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	// 成员（含已移出的历史成员）
	rows, err = h.DB.QueryContext(ctx,
		`SELECT m.student_id, u.name, u.login_id, u.password_hash, m.removed_at
		 FROM topic_members m JOIN users u ON u.id = m.student_id
		 WHERE m.topic_id = ?
		 ORDER BY (m.removed_at IS NOT NULL), u.name, m.student_id`, topic.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var (
			item         models.TopicStudent
			passwordHash sql.NullString
			removedAt    sql.NullString
		)
		if err := rows.Scan(&item.ID, &item.Name, &item.LoginID, &passwordHash, &removedAt); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		item.HasPassword = passwordHash.Valid && passwordHash.String != ""
		item.RemovedAt = strPtr(removedAt)
		detail.Students = append(detail.Students, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	// 评价维度
	rows, err = h.DB.QueryContext(ctx,
		`SELECT id, name, max_score, sort_order FROM evaluation_dimensions
		 WHERE topic_id = ? ORDER BY sort_order, name, id`, topic.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var item models.Dimension
		if err := rows.Scan(&item.ID, &item.Name, &item.MaxScore, &item.SortOrder); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		detail.Dimensions = append(detail.Dimensions, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	// 提交列表
	type submissionRow struct {
		ID, StudentID, StudentName, StudentLoginID, TextContent, UpdatedAt string
	}
	submissionRows := make([]submissionRow, 0)
	rows, err = h.DB.QueryContext(ctx,
		`SELECT s.id, s.student_id, u.name, u.login_id, s.text_content, s.updated_at
		 FROM submissions s JOIN users u ON u.id = s.student_id
		 WHERE s.topic_id = ?
		 ORDER BY s.updated_at DESC, s.id`, topic.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var item submissionRow
		if err := rows.Scan(&item.ID, &item.StudentID, &item.StudentName,
			&item.StudentLoginID, &item.TextContent, &item.UpdatedAt); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		submissionRows = append(submissionRows, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	for _, item := range submissionRows {
		var fileCount, evaluationCount int
		if err := h.DB.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM submission_files WHERE submission_id = ?`, item.ID,
		).Scan(&fileCount); err != nil {
			serverError(w, err)
			return
		}
		if err := h.DB.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM evaluations WHERE submission_id = ?`, item.ID,
		).Scan(&evaluationCount); err != nil {
			serverError(w, err)
			return
		}
		latest, err := h.latestEvaluation(ctx, item.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		detail.Submissions = append(detail.Submissions, models.TeacherTopicSubmission{
			ID: item.ID,
			Student: models.StudentBrief{
				ID:      item.StudentID,
				Name:    item.StudentName,
				LoginID: item.StudentLoginID,
			},
			TextContent:      item.TextContent,
			UpdatedAt:        item.UpdatedAt,
			FileCount:        fileCount,
			EvaluationCount:  evaluationCount,
			LatestEvaluation: latest,
			Pending:          evaluationCount == 0,
		})
	}

	writeJSON(w, http.StatusOK, detail)
}

// latestEvaluation 读取提交的最近一次评价（含各维度分数）。
func (h *API) latestEvaluation(ctx context.Context, submissionID string) (*models.EvaluationSummary, error) {
	var (
		evaluationID string
		comment      string
	)
	err := h.DB.QueryRowContext(ctx,
		`SELECT id, comment FROM evaluations WHERE submission_id = ?
		 ORDER BY created_at DESC, id DESC LIMIT 1`, submissionID,
	).Scan(&evaluationID, &comment)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	scores, err := h.evaluationScoresDetail(ctx, evaluationID)
	if err != nil {
		return nil, err
	}
	return &models.EvaluationSummary{ID: evaluationID, Comment: comment, Scores: scores}, nil
}

// evaluationScoresDetail 读取一次评价的分数（含维度 id / 名称 / 满分）。
func (h *API) evaluationScoresDetail(ctx context.Context, evaluationID string) ([]models.ScoreDetail, error) {
	rows, err := h.DB.QueryContext(ctx,
		`SELECT es.dimension_id, d.name, es.score, d.max_score
		 FROM evaluation_scores es JOIN evaluation_dimensions d ON d.id = es.dimension_id
		 WHERE es.evaluation_id = ?
		 ORDER BY d.sort_order, d.name, d.id`, evaluationID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	scores := make([]models.ScoreDetail, 0)
	for rows.Next() {
		var item models.ScoreDetail
		if err := rows.Scan(&item.DimensionID, &item.DimensionName, &item.Score, &item.MaxScore); err != nil {
			return nil, err
		}
		scores = append(scores, item)
	}
	return scores, rows.Err()
}

// evaluationScoresBrief 读取一次评价的分数（只含维度名称 / 分数 / 满分）。
func (h *API) evaluationScoresBrief(ctx context.Context, evaluationID string) ([]models.ScoreBrief, error) {
	detail, err := h.evaluationScoresDetail(ctx, evaluationID)
	if err != nil {
		return nil, err
	}
	brief := make([]models.ScoreBrief, 0, len(detail))
	for _, item := range detail {
		brief = append(brief, models.ScoreBrief{
			DimensionID:   item.DimensionID,
			DimensionName: item.DimensionName,
			Score:         item.Score,
			MaxScore:      item.MaxScore,
		})
	}
	return brief, nil
}

// updateTopicRequest PATCH /api/teacher/topics/{id} 请求体（字段均可选）。
type updateTopicRequest struct {
	Title         *string `json:"title"`
	DescriptionMD *string `json:"descriptionMd"`
	Status        *string `json:"status"`
}

// UpdateTopic PATCH /api/teacher/topics/{id}：仅创建者可编辑标题 / 介绍 / 关闭。
func (h *API) UpdateTopic(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireOwnerTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	var req updateTopicRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}

	title := topic.Title
	if req.Title != nil {
		title = strings.TrimSpace(*req.Title)
		if title == "" {
			writeError(w, http.StatusBadRequest, "请输入课题标题")
			return
		}
	}
	description := topic.DescriptionMD
	if req.DescriptionMD != nil {
		description = *req.DescriptionMD
	}
	status := topic.Status
	if req.Status != nil {
		status = strings.TrimSpace(*req.Status)
		if !validTopicStatus(status) {
			writeError(w, http.StatusBadRequest, "课题状态只能是 ACTIVE 或 CLOSED")
			return
		}
	}

	if _, err := h.DB.ExecContext(r.Context(),
		`UPDATE topics SET title = ?, description_md = ?, status = ?, updated_at = ? WHERE id = ?`,
		title, description, status, now(), topic.ID,
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

/* ------------------------------------------------------------------ */
/* 助教管理 / 创建者移交                                               */
/* ------------------------------------------------------------------ */

// assistantRequest POST /api/teacher/topics/{id}/assistants 请求体。
type assistantRequest struct {
	LoginID string `json:"loginId"`
}

// AddAssistant POST /api/teacher/topics/{id}/assistants：仅创建者，最多 3 名。
func (h *API) AddAssistant(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireOwnerTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	var req assistantRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	loginID := strings.TrimSpace(req.LoginID)
	if loginID == "" {
		writeError(w, http.StatusBadRequest, "请输入教师的用户名或 ID")
		return
	}
	ctx := r.Context()
	teacher, _, err := h.getUserByLoginID(ctx, loginID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "教师不存在，请检查用户名或 ID")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if teacher.Role != roleTeacher {
		writeError(w, http.StatusBadRequest, "只能邀请教师作为助教")
		return
	}
	if teacher.ID == topic.OwnerID {
		writeError(w, http.StatusBadRequest, "该教师已是课题创建者")
		return
	}

	var count int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM topic_assistants WHERE topic_id = ?`, topic.ID,
	).Scan(&count); err != nil {
		serverError(w, err)
		return
	}
	if count >= 3 {
		writeError(w, http.StatusBadRequest, "助教最多 3 名")
		return
	}

	var existing int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM topic_assistants WHERE topic_id = ? AND teacher_id = ?`,
		topic.ID, teacher.ID,
	).Scan(&existing); err != nil {
		serverError(w, err)
		return
	}
	if existing > 0 {
		writeError(w, http.StatusConflict, "该教师已是助教")
		return
	}

	if _, err := h.DB.ExecContext(ctx,
		`INSERT INTO topic_assistants (id, topic_id, teacher_id, created_at) VALUES (?, ?, ?, ?)`,
		newID("ta"), topic.ID, teacher.ID, now(),
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.CreatedID{ID: teacher.ID})
}

// RemoveAssistant DELETE /api/teacher/topics/{id}/assistants/{teacherId}：仅创建者。
func (h *API) RemoveAssistant(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireOwnerTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	teacherID := r.PathValue("teacherId")
	if teacherID == topic.OwnerID {
		writeError(w, http.StatusBadRequest, "不能移除课题创建者")
		return
	}
	result, err := h.DB.ExecContext(r.Context(),
		`DELETE FROM topic_assistants WHERE topic_id = ? AND teacher_id = ?`, topic.ID, teacherID)
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
		writeError(w, http.StatusNotFound, "助教不存在")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// transferRequest POST /api/teacher/topics/{id}/transfer 请求体。
type transferRequest struct {
	TeacherID string `json:"teacherId"`
}

// TransferTopic POST /api/teacher/topics/{id}/transfer：原创建者变为助教，需满足助教上限。
func (h *API) TransferTopic(w http.ResponseWriter, r *http.Request) {
	topic, owner, ok := h.requireOwnerTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	var req transferRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	targetID := strings.TrimSpace(req.TeacherID)
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "请选择接收课题的教师")
		return
	}
	if targetID == topic.OwnerID {
		writeError(w, http.StatusBadRequest, "该教师已是课题创建者")
		return
	}
	ctx := r.Context()
	target, _, err := h.getUserByID(ctx, targetID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "教师不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if target.Role != roleTeacher {
		writeError(w, http.StatusBadRequest, "只能移交给教师")
		return
	}

	tx, err := h.DB.BeginTx(ctx, nil)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx,
		`SELECT teacher_id FROM topic_assistants WHERE topic_id = ? ORDER BY created_at`, topic.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	assistantIDs := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		assistantIDs = append(assistantIDs, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	targetIsAssistant := false
	for _, id := range assistantIDs {
		if id == target.ID {
			targetIsAssistant = true
			break
		}
	}
	// 移交后原创建者成为助教：若目标不是助教，则助教数 +1，必须不超过 3。
	if !targetIsAssistant && len(assistantIDs) >= 3 {
		writeError(w, http.StatusBadRequest, "助教已达上限 3 名，无法移交")
		return
	}

	if targetIsAssistant {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM topic_assistants WHERE topic_id = ? AND teacher_id = ?`, topic.ID, target.ID,
		); err != nil {
			serverError(w, err)
			return
		}
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO topic_assistants (id, topic_id, teacher_id, created_at) VALUES (?, ?, ?, ?)`,
		newID("ta"), topic.ID, owner.ID, now(),
	); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE topics SET owner_id = ?, updated_at = ? WHERE id = ?`,
		target.ID, now(), topic.ID,
	); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

/* ------------------------------------------------------------------ */
/* 课题成员（学生）管理                                                */
/* ------------------------------------------------------------------ */

// addTopicStudentRequest POST /api/teacher/topics/{id}/students 请求体。
type addTopicStudentRequest struct {
	LoginID   string `json:"loginId"`
	StudentID string `json:"studentId"`
}

// AddTopicStudent POST /api/teacher/topics/{id}/students：创建者 / 助教；幂等，removed 的恢复。
func (h *API) AddTopicStudent(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	var req addTopicStudentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	ctx := r.Context()

	var (
		student *models.User
		err     error
	)
	loginID := strings.TrimSpace(req.LoginID)
	studentID := strings.TrimSpace(req.StudentID)
	switch {
	case studentID != "":
		student, _, err = h.getUserByID(ctx, studentID)
	case loginID != "":
		student, _, err = h.getUserByLoginID(ctx, loginID)
	default:
		writeError(w, http.StatusBadRequest, "请输入学生学号")
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "学生不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if student.Role != roleStudent {
		writeError(w, http.StatusBadRequest, "只能添加学生账号")
		return
	}

	var (
		memberID  string
		removedAt sql.NullString
	)
	err = h.DB.QueryRowContext(ctx,
		`SELECT id, removed_at FROM topic_members WHERE topic_id = ? AND student_id = ?`,
		topic.ID, student.ID,
	).Scan(&memberID, &removedAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if _, err := h.DB.ExecContext(ctx,
			`INSERT INTO topic_members (id, topic_id, student_id, joined_at, removed_at)
			 VALUES (?, ?, ?, ?, NULL)`,
			newID("tm"), topic.ID, student.ID, now(),
		); err != nil {
			serverError(w, err)
			return
		}
	case err != nil:
		serverError(w, err)
		return
	case removedAt.Valid:
		// 恢复历史成员，保留原来的 joined_at。
		if _, err := h.DB.ExecContext(ctx,
			`UPDATE topic_members SET removed_at = NULL WHERE id = ?`, memberID,
		); err != nil {
			serverError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusCreated, models.OK{OK: true})
}

// RemoveTopicStudent DELETE /api/teacher/topics/{id}/students/{studentId}：置 removed_at 保留历史。
func (h *API) RemoveTopicStudent(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	studentID := r.PathValue("studentId")
	result, err := h.DB.ExecContext(r.Context(),
		`UPDATE topic_members SET removed_at = ?
		 WHERE topic_id = ? AND student_id = ? AND removed_at IS NULL`,
		now(), topic.ID, studentID)
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
		writeError(w, http.StatusNotFound, "该学生不在课题中")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* ------------------------------------------------------------------ */
/* 评价维度管理                                                        */
/* ------------------------------------------------------------------ */

// dimensionRequest POST/PATCH 评价维度请求体。
type dimensionRequest struct {
	Name      string `json:"name"`
	MaxScore  *int   `json:"maxScore"`
	SortOrder *int   `json:"sortOrder"`
}

// TeacherDimensions GET /api/teacher/topics/{id}/dimensions。
func (h *API) TeacherDimensions(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	rows, err := h.DB.QueryContext(r.Context(),
		`SELECT id, name, max_score, sort_order FROM evaluation_dimensions
		 WHERE topic_id = ? ORDER BY sort_order, name, id`, topic.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = rows.Close() }()
	dimensions := make([]models.Dimension, 0)
	for rows.Next() {
		var item models.Dimension
		if err := rows.Scan(&item.ID, &item.Name, &item.MaxScore, &item.SortOrder); err != nil {
			serverError(w, err)
			return
		}
		dimensions = append(dimensions, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dimensions)
}

// CreateDimension POST /api/teacher/topics/{id}/dimensions。
func (h *API) CreateDimension(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	var req dimensionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "请输入维度名称")
		return
	}
	maxScore := 100
	if req.MaxScore != nil {
		maxScore = *req.MaxScore
	}
	if maxScore <= 0 || maxScore > 10000 {
		writeError(w, http.StatusBadRequest, "满分需在 1 到 10000 之间")
		return
	}
	ctx := r.Context()

	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	} else {
		if err := h.DB.QueryRowContext(ctx,
			`SELECT COALESCE(MAX(sort_order), -1) + 1 FROM evaluation_dimensions WHERE topic_id = ?`,
			topic.ID,
		).Scan(&sortOrder); err != nil {
			serverError(w, err)
			return
		}
	}

	dimensionID := newID("dim")
	if _, err := h.DB.ExecContext(ctx,
		`INSERT INTO evaluation_dimensions (id, topic_id, name, max_score, sort_order, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		dimensionID, topic.ID, name, maxScore, sortOrder, now(),
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.CreatedID{ID: dimensionID})
}

// UpdateDimension PATCH /api/teacher/topics/{id}/dimensions/{dimId}。
func (h *API) UpdateDimension(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	dimensionID := r.PathValue("dimId")
	ctx := r.Context()

	var (
		name      string
		maxScore  int
		sortOrder int
	)
	err := h.DB.QueryRowContext(ctx,
		`SELECT name, max_score, sort_order FROM evaluation_dimensions
		 WHERE id = ? AND topic_id = ?`, dimensionID, topic.ID,
	).Scan(&name, &maxScore, &sortOrder)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "评价维度不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}

	var req dimensionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if strings.TrimSpace(req.Name) != "" {
		name = strings.TrimSpace(req.Name)
	}
	if req.MaxScore != nil {
		maxScore = *req.MaxScore
		if maxScore <= 0 || maxScore > 10000 {
			writeError(w, http.StatusBadRequest, "满分需在 1 到 10000 之间")
			return
		}
	}
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}

	if _, err := h.DB.ExecContext(ctx,
		`UPDATE evaluation_dimensions SET name = ?, max_score = ?, sort_order = ?
		 WHERE id = ? AND topic_id = ?`,
		name, maxScore, sortOrder, dimensionID, topic.ID,
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

// DeleteDimension DELETE /api/teacher/topics/{id}/dimensions/{dimId}。
func (h *API) DeleteDimension(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	result, err := h.DB.ExecContext(r.Context(),
		`DELETE FROM evaluation_dimensions WHERE id = ? AND topic_id = ?`,
		r.PathValue("dimId"), topic.ID)
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
		writeError(w, http.StatusNotFound, "评价维度不存在")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

/* ------------------------------------------------------------------ */
/* 教师学生管理                                                        */
/* ------------------------------------------------------------------ */

// TeacherStudents GET /api/teacher/students：我管理的学生（含 hasPassword，绝不返回哈希）。
func (h *API) TeacherStudents(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	rows, err := h.DB.QueryContext(r.Context(),
		`SELECT u.id, u.login_id, u.name, u.role, u.avatar_color, u.password_hash, ts.created_at
		 FROM users u JOIN teacher_students ts ON ts.student_id = u.id
		 WHERE ts.teacher_id = ?
		 ORDER BY u.name, u.id`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = rows.Close() }()

	students := make([]models.ManagedStudent, 0)
	for rows.Next() {
		var (
			item         models.ManagedStudent
			passwordHash sql.NullString
		)
		if err := rows.Scan(&item.ID, &item.LoginID, &item.Name, &item.Role, &item.AvatarColor,
			&passwordHash, &item.CreatedAt); err != nil {
			serverError(w, err)
			return
		}
		item.HasPassword = passwordHash.Valid && passwordHash.String != ""
		students = append(students, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, students)
}

// createStudentRequest POST /api/teacher/students 请求体。
type createStudentRequest struct {
	Name    string `json:"name"`
	LoginID string `json:"loginId"`
}

// CreateStudent POST /api/teacher/students：创建学生并自动关联到我。
func (h *API) CreateStudent(w http.ResponseWriter, r *http.Request) {
	teacher := currentUser(r)
	var req createStudentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	name := strings.TrimSpace(req.Name)
	loginID := normalizeLoginID(req.LoginID)
	if name == "" {
		writeError(w, http.StatusBadRequest, "请输入学生姓名")
		return
	}
	if loginID == "" {
		writeError(w, http.StatusBadRequest, "请输入学生用户名")
		return
	}
	if len([]rune(name)) > 100 || len([]rune(loginID)) > 64 {
		writeError(w, http.StatusBadRequest, "姓名或用户名过长")
		return
	}
	ctx := r.Context()

	// 用户名全局唯一：已存在时返回 409 + 已有账号信息，由老师决定「关联」还是「换用户名」。
	if _, _, err := h.getUserByLoginID(ctx, loginID); err == nil {
		h.writeStudentConflict(w, r, loginID)
		return
	} else if !errors.Is(err, sql.ErrNoRows) {
		serverError(w, err)
		return
	}

	timestamp := now()
	student := models.User{
		ID:          newID("u"),
		LoginID:     loginID,
		Name:        name,
		Role:        roleStudent,
		AvatarColor: pickAvatarColor(loginID + name),
		HasPassword: false,
	}

	tx, err := h.DB.BeginTx(ctx, nil)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO users (id, login_id, name, role, password_hash, avatar_color, created_by, created_at, updated_at)
		 VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
		student.ID, student.LoginID, student.Name, student.Role, student.AvatarColor,
		teacher.ID, timestamp, timestamp,
	); err != nil {
		if isUniqueViolation(err) {
			h.writeStudentConflict(w, r, loginID)
			return
		}
		serverError(w, err)
		return
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO teacher_students (teacher_id, student_id, created_at) VALUES (?, ?, ?)`,
		teacher.ID, student.ID, timestamp,
	); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.ManagedStudent{
		ID:          student.ID,
		Name:        student.Name,
		LoginID:     student.LoginID,
		Role:        student.Role,
		AvatarColor: student.AvatarColor,
		HasPassword: false,
		CreatedAt:   timestamp,
	})
}

// writeStudentConflict 输出 409 + 已有账号信息（用户名冲突时的「先看信息」流程）。
func (h *API) writeStudentConflict(w http.ResponseWriter, r *http.Request, loginID string) {
	ctx := r.Context()
	student, _, err := h.getUserByLoginID(ctx, loginID)
	if err != nil {
		serverError(w, err)
		return
	}
	info, err := h.buildStudentAccountInfo(ctx, student, currentUser(r).ID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusConflict, map[string]any{
		"error":    "该用户名已存在",
		"conflict": info,
	})
}

// LinkStudent POST /api/teacher/students/{id}/link：把已有学生关联到我的管理列表（幂等）。
func (h *API) LinkStudent(w http.ResponseWriter, r *http.Request) {
	teacher := currentUser(r)
	student, _, err := h.getUserByID(r.Context(), r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "学生不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if student.Role != roleStudent {
		writeError(w, http.StatusBadRequest, "只能关联学生账号")
		return
	}
	if _, err := h.DB.ExecContext(r.Context(),
		`INSERT OR IGNORE INTO teacher_students (teacher_id, student_id, created_at) VALUES (?, ?, ?)`,
		teacher.ID, student.ID, now(),
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

// resetPasswordRequest POST /api/teacher/students/{id}/password 请求体。
type resetPasswordRequest struct {
	Password string `json:"password"`
}

// requireManagedStudent 校验学生存在且由当前教师管理；失败时已写好响应。
func (h *API) requireManagedStudent(w http.ResponseWriter, r *http.Request, studentID string) (*models.User, bool) {
	ctx := r.Context()
	student, _, err := h.getUserByID(ctx, studentID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "学生不存在")
		return nil, false
	}
	if err != nil {
		serverError(w, err)
		return nil, false
	}
	if student.Role != roleStudent {
		writeError(w, http.StatusNotFound, "学生不存在")
		return nil, false
	}
	var managed int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM teacher_students WHERE teacher_id = ? AND student_id = ?`,
		currentUser(r).ID, student.ID,
	).Scan(&managed); err != nil {
		serverError(w, err)
		return nil, false
	}
	if managed == 0 {
		writeError(w, http.StatusForbidden, "只能操作自己管理的学生")
		return nil, false
	}
	return student, true
}

// ResetStudentPassword POST /api/teacher/students/{id}/password：重置密码（老师无法读取）。
func (h *API) ResetStudentPassword(w http.ResponseWriter, r *http.Request) {
	student, ok := h.requireManagedStudent(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	var req resetPasswordRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	if strings.TrimSpace(req.Password) == "" {
		writeError(w, http.StatusBadRequest, "请输入新密码")
		return
	}
	if len(req.Password) > 200 {
		writeError(w, http.StatusBadRequest, "密码过长")
		return
	}
	hashed, err := auth.HashPassword(req.Password)
	if err != nil {
		serverError(w, err)
		return
	}
	if _, err := h.DB.ExecContext(r.Context(),
		`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
		hashed, now(), student.ID,
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

// ClearStudentPassword DELETE /api/teacher/students/{id}/password：关闭密码（置 NULL）。
func (h *API) ClearStudentPassword(w http.ResponseWriter, r *http.Request) {
	student, ok := h.requireManagedStudent(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	if _, err := h.DB.ExecContext(r.Context(),
		`UPDATE users SET password_hash = NULL, updated_at = ? WHERE id = ?`,
		now(), student.ID,
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

/* ------------------------------------------------------------------ */
/* 教师查看提交 / 评价 / 评价汇总                                      */
/* ------------------------------------------------------------------ */

// TeacherSubmissionDetail GET /api/teacher/submissions/{id}。
func (h *API) TeacherSubmissionDetail(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var (
		submissionID string
		topicID      string
		topicTitle   string
		studentID    string
		studentName  string
		studentLogin string
		textContent  string
		updatedAt    string
	)
	err := h.DB.QueryRowContext(ctx,
		`SELECT s.id, s.topic_id, t.title, s.student_id, u.name, u.login_id, s.text_content, s.updated_at
		 FROM submissions s
		 JOIN topics t ON t.id = s.topic_id
		 JOIN users u ON u.id = s.student_id
		 WHERE s.id = ?`, r.PathValue("id"),
	).Scan(&submissionID, &topicID, &topicTitle, &studentID, &studentName, &studentLogin,
		&textContent, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "提交不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	topic, err := h.getTopic(ctx, topicID)
	if err != nil {
		serverError(w, err)
		return
	}
	allowed, err := h.canManageTopic(ctx, currentUser(r), topic)
	if err != nil {
		serverError(w, err)
		return
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "无权查看该提交")
		return
	}

	detail := models.TeacherSubmissionDetail{
		ID:          submissionID,
		Topic:       models.IDName{ID: topicID, Name: topicTitle},
		Student:     models.StudentBrief{ID: studentID, Name: studentName, LoginID: studentLogin},
		TextContent: textContent,
		Files:       []models.SubmissionFile{},
		UpdatedAt:   updatedAt,
		Evaluations: []models.TeacherEvaluation{},
	}

	// 附件
	rows, err := h.DB.QueryContext(ctx,
		`SELECT id, original_name, mime_type, size_bytes FROM submission_files
		 WHERE submission_id = ? ORDER BY created_at, id`, submissionID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var item models.SubmissionFile
		if err := rows.Scan(&item.ID, &item.OriginalName, &item.MimeType, &item.SizeBytes); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		detail.Files = append(detail.Files, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	// 评价历史
	type evaluationRow struct {
		ID, CreatedAt, TeacherID, TeacherName, Comment string
	}
	evaluationRows := make([]evaluationRow, 0)
	rows, err = h.DB.QueryContext(ctx,
		`SELECT e.id, e.created_at, e.teacher_id, u.name, e.comment
		 FROM evaluations e JOIN users u ON u.id = e.teacher_id
		 WHERE e.submission_id = ?
		 ORDER BY e.created_at DESC, e.id DESC`, submissionID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var item evaluationRow
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.TeacherID, &item.TeacherName, &item.Comment); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		evaluationRows = append(evaluationRows, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	for _, item := range evaluationRows {
		scores, err := h.evaluationScoresDetail(ctx, item.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		detail.Evaluations = append(detail.Evaluations, models.TeacherEvaluation{
			ID:        item.ID,
			CreatedAt: item.CreatedAt,
			Teacher:   models.IDName{ID: item.TeacherID, Name: item.TeacherName},
			Comment:   item.Comment,
			Scores:    scores,
		})
	}

	writeJSON(w, http.StatusOK, detail)
}

// evaluationScoreRequest 评价提交时的单维度分数。
type evaluationScoreRequest struct {
	DimensionID string `json:"dimensionId"`
	Score       int    `json:"score"`
}

// createEvaluationRequest POST /api/teacher/submissions/{id}/evaluations 请求体。
type createEvaluationRequest struct {
	Comment string                   `json:"comment"`
	Scores  []evaluationScoreRequest `json:"scores"`
}

// CreateEvaluation POST /api/teacher/submissions/{id}/evaluations：一次评价可含多维度分数。
func (h *API) CreateEvaluation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	submissionID := r.PathValue("id")

	var topicID string
	err := h.DB.QueryRowContext(ctx,
		`SELECT topic_id FROM submissions WHERE id = ?`, submissionID,
	).Scan(&topicID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "提交不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	topic, err := h.getTopic(ctx, topicID)
	if err != nil {
		serverError(w, err)
		return
	}
	allowed, err := h.canManageTopic(ctx, currentUser(r), topic)
	if err != nil {
		serverError(w, err)
		return
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "无权评价该提交")
		return
	}

	var req createEvaluationRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	comment := strings.TrimSpace(req.Comment)
	if len([]rune(comment)) > 5000 {
		writeError(w, http.StatusBadRequest, "评语过长")
		return
	}

	// 读取课题维度，校验分数范围与维度归属。
	type dimensionInfo struct {
		Name     string
		MaxScore int
	}
	dimensions := make(map[string]dimensionInfo)
	rows, err := h.DB.QueryContext(ctx,
		`SELECT id, name, max_score FROM evaluation_dimensions WHERE topic_id = ?`, topicID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var (
			id       string
			info     dimensionInfo
			maxScore int
		)
		if err := rows.Scan(&id, &info.Name, &maxScore); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		info.MaxScore = maxScore
		dimensions[id] = info
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	seen := make(map[string]bool, len(req.Scores))
	for _, score := range req.Scores {
		dimensionID := strings.TrimSpace(score.DimensionID)
		info, exists := dimensions[dimensionID]
		if !exists {
			writeError(w, http.StatusBadRequest, "评分维度不存在")
			return
		}
		if score.Score < 0 || score.Score > info.MaxScore {
			writeError(w, http.StatusBadRequest, "评分超出允许范围")
			return
		}
		if seen[dimensionID] {
			writeError(w, http.StatusBadRequest, "评分维度重复")
			return
		}
		seen[dimensionID] = true
	}

	timestamp := now()
	evaluationID := newID("ev")
	tx, err := h.DB.BeginTx(ctx, nil)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO evaluations (id, submission_id, teacher_id, comment, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		evaluationID, submissionID, currentUser(r).ID, comment, timestamp,
	); err != nil {
		serverError(w, err)
		return
	}
	for _, score := range req.Scores {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO evaluation_scores (id, evaluation_id, dimension_id, score) VALUES (?, ?, ?, ?)`,
			newID("es"), evaluationID, strings.TrimSpace(score.DimensionID), score.Score,
		); err != nil {
			serverError(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.CreatedID{ID: evaluationID})
}

// TeacherEvaluations GET /api/teacher/evaluations：我管理课题下的全部评价，按时间倒序。
func (h *API) TeacherEvaluations(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	type evaluationRow struct {
		ID, CreatedAt, Comment            string
		TeacherID, TeacherName            string
		StudentID, StudentName            string
		TopicID, TopicTitle, SubmissionID string
	}
	rows, err := h.DB.QueryContext(ctx,
		`SELECT e.id, e.created_at, e.comment,
		        te.id, te.name, su.id, su.name, t.id, t.title, s.id
		 FROM evaluations e
		 JOIN submissions s ON s.id = e.submission_id
		 JOIN topics t ON t.id = s.topic_id
		 JOIN users te ON te.id = e.teacher_id
		 JOIN users su ON su.id = s.student_id
		 WHERE `+managedTopicsSQL+`
		 ORDER BY e.created_at DESC, e.id DESC`, user.ID, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	evaluationRows := make([]evaluationRow, 0)
	for rows.Next() {
		var item evaluationRow
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.Comment,
			&item.TeacherID, &item.TeacherName, &item.StudentID, &item.StudentName,
			&item.TopicID, &item.TopicTitle, &item.SubmissionID); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		evaluationRows = append(evaluationRows, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	evaluations := make([]models.EvaluationListItem, 0, len(evaluationRows))
	for _, item := range evaluationRows {
		scores, err := h.evaluationScoresBrief(ctx, item.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		evaluations = append(evaluations, models.EvaluationListItem{
			ID:           item.ID,
			CreatedAt:    item.CreatedAt,
			Comment:      item.Comment,
			Teacher:      models.IDName{ID: item.TeacherID, Name: item.TeacherName},
			Student:      models.IDName{ID: item.StudentID, Name: item.StudentName},
			Topic:        models.IDName{ID: item.TopicID, Name: item.TopicTitle},
			SubmissionID: item.SubmissionID,
			Scores:       scores,
		})
	}
	writeJSON(w, http.StatusOK, evaluations)
}
