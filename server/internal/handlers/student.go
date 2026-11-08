package handlers

import (
	"context"
	"database/sql"
	"errors"
	"mime/multipart"
	"net/http"
	"os"

	"aiworkspace/server/internal/models"
)

/* ------------------------------------------------------------------ */
/* 学生工作台 / 课题列表 / 课题详情                                    */
/* ------------------------------------------------------------------ */

// StudentOverview GET /api/student/overview。
func (h *API) StudentOverview(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()

	overview := models.StudentOverview{
		LatestEvaluations: []models.StudentEvaluationItem{},
		Topics:            []models.StudentOverviewTopic{},
	}

	type topicRow struct {
		ID, Title, Status, UpdatedAt, OwnerName string
		RemovedAt                               *string
	}
	topics := make([]topicRow, 0)
	rows, err := h.DB.QueryContext(ctx,
		`SELECT t.id, t.title, t.status, t.updated_at, COALESCE(ou.name, ''), m.removed_at
		 FROM topic_members m
		 JOIN topics t ON t.id = m.topic_id
		 LEFT JOIN users ou ON ou.id = t.owner_id
		 WHERE m.student_id = ?
		 ORDER BY (m.removed_at IS NOT NULL), t.updated_at DESC, t.id`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var (
			item      topicRow
			removedAt sql.NullString
		)
		if err := rows.Scan(&item.ID, &item.Title, &item.Status, &item.UpdatedAt,
			&item.OwnerName, &removedAt); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		item.RemovedAt = strPtr(removedAt)
		topics = append(topics, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	for _, topic := range topics {
		submissionID, err := h.mySubmissionID(ctx, topic.ID, user.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		evaluationCount := 0
		if submissionID != "" {
			if err := h.DB.QueryRowContext(ctx,
				`SELECT COUNT(*) FROM evaluations WHERE submission_id = ?`, submissionID,
			).Scan(&evaluationCount); err != nil {
				serverError(w, err)
				return
			}
		}
		submitted := submissionID != ""
		overview.TopicCount++
		if submitted {
			overview.SubmittedCount++
		}
		if topic.RemovedAt == nil && topic.Status == statusActive && !submitted {
			overview.PendingSubmissionCount++
		}
		overview.Topics = append(overview.Topics, models.StudentOverviewTopic{
			ID:              topic.ID,
			Title:           topic.Title,
			Status:          topic.Status,
			Owner:           models.NameOnly{Name: topic.OwnerName},
			EvaluationCount: evaluationCount,
			Submitted:       submitted,
			UpdatedAt:       topic.UpdatedAt,
			RemovedAt:       topic.RemovedAt,
		})
	}

	items, err := h.studentEvaluations(ctx, user.ID, 5)
	if err != nil {
		serverError(w, err)
		return
	}
	overview.LatestEvaluations = items
	writeJSON(w, http.StatusOK, overview)
}

// mySubmissionID 返回学生在某课题下的提交 id；没有提交时返回空串。
func (h *API) mySubmissionID(ctx context.Context, topicID, studentID string) (string, error) {
	var submissionID string
	err := h.DB.QueryRowContext(ctx,
		`SELECT id FROM submissions WHERE topic_id = ? AND student_id = ?`, topicID, studentID,
	).Scan(&submissionID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return submissionID, nil
}

// StudentTopics GET /api/student/topics（含历史课题）。
func (h *API) StudentTopics(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	rows, err := h.DB.QueryContext(r.Context(),
		`SELECT t.id, t.title, t.status, COALESCE(ou.name, ''), t.updated_at, m.removed_at,
		        CASE WHEN s.id IS NULL THEN 0 ELSE 1 END
		 FROM topic_members m
		 JOIN topics t ON t.id = m.topic_id
		 LEFT JOIN users ou ON ou.id = t.owner_id
		 LEFT JOIN submissions s ON s.topic_id = t.id AND s.student_id = m.student_id
		 WHERE m.student_id = ?
		 ORDER BY (m.removed_at IS NOT NULL), t.updated_at DESC, t.id`, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = rows.Close() }()

	topics := make([]models.StudentTopic, 0)
	for rows.Next() {
		var (
			item      models.StudentTopic
			ownerName string
			removedAt sql.NullString
			submitted int
		)
		if err := rows.Scan(&item.ID, &item.Title, &item.Status, &ownerName,
			&item.UpdatedAt, &removedAt, &submitted); err != nil {
			serverError(w, err)
			return
		}
		item.Owner = models.NameOnly{Name: ownerName}
		item.RemovedAt = strPtr(removedAt)
		item.Submitted = submitted == 1
		topics = append(topics, item)
	}
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, topics)
}

// StudentTopicDetail GET /api/student/topics/{id}（历史成员只读）。
func (h *API) StudentTopicDetail(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	topicID := r.PathValue("id")

	topic, err := h.getTopic(ctx, topicID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "课题不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	membership, err := h.getMembership(ctx, topicID, user.ID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusForbidden, "无权访问该课题")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	_ = membership

	detail := models.StudentTopicDetail{
		ID:            topic.ID,
		Title:         topic.Title,
		DescriptionMD: topic.DescriptionMD,
		Status:        topic.Status,
		Owner:         models.NameOnly{Name: topic.OwnerName},
		Assistants:    []models.NameOnly{},
		MyEvaluations: []models.StudentEvaluationBrief{},
	}

	// 助教（只展示姓名）
	rows, err := h.DB.QueryContext(ctx,
		`SELECT u.name FROM topic_assistants a JOIN users u ON u.id = a.teacher_id
		 WHERE a.topic_id = ? ORDER BY a.created_at, u.name`, topicID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		detail.Assistants = append(detail.Assistants, models.NameOnly{Name: name})
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	// 我的提交
	submissionID, err := h.mySubmissionID(ctx, topicID, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if submissionID != "" {
		var submission models.StudentSubmission
		submission.ID = submissionID
		submission.Files = []models.StudentFile{}
		if err := h.DB.QueryRowContext(ctx,
			`SELECT text_content, updated_at FROM submissions WHERE id = ?`, submissionID,
		).Scan(&submission.TextContent, &submission.UpdatedAt); err != nil {
			serverError(w, err)
			return
		}
		rows, err := h.DB.QueryContext(ctx,
			`SELECT id, original_name, mime_type, size_bytes FROM submission_files
			 WHERE submission_id = ? ORDER BY created_at, id`, submissionID)
		if err != nil {
			serverError(w, err)
			return
		}
		for rows.Next() {
			var file models.StudentFile
			if err := rows.Scan(&file.ID, &file.OriginalName, &file.MimeType, &file.SizeBytes); err != nil {
				_ = rows.Close()
				serverError(w, err)
				return
			}
			submission.Files = append(submission.Files, file)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		_ = rows.Close()
		detail.MySubmission = &submission

		// 我的评价（该提交的全部评价历史）：先收集评价行，再逐个取分数，避免单连接下嵌套查询。
		type evaluationRow struct {
			ID, CreatedAt, TeacherID, TeacherName, Comment string
		}
		records := make([]evaluationRow, 0)
		evaluationRows, err := h.DB.QueryContext(ctx,
			`SELECT e.id, e.created_at, e.teacher_id, u.name, e.comment
			 FROM evaluations e JOIN users u ON u.id = e.teacher_id
			 WHERE e.submission_id = ? ORDER BY e.created_at DESC, e.id DESC`, submissionID)
		if err != nil {
			serverError(w, err)
			return
		}
		for evaluationRows.Next() {
			var item evaluationRow
			if err := evaluationRows.Scan(&item.ID, &item.CreatedAt, &item.TeacherID,
				&item.TeacherName, &item.Comment); err != nil {
				_ = evaluationRows.Close()
				serverError(w, err)
				return
			}
			records = append(records, item)
		}
		if err := evaluationRows.Err(); err != nil {
			_ = evaluationRows.Close()
			serverError(w, err)
			return
		}
		_ = evaluationRows.Close()
		for _, record := range records {
			scores, err := h.evaluationScoresBrief(ctx, record.ID)
			if err != nil {
				serverError(w, err)
				return
			}
			detail.MyEvaluations = append(detail.MyEvaluations, models.StudentEvaluationBrief{
				ID:        record.ID,
				CreatedAt: record.CreatedAt,
				Teacher:   models.IDName{ID: record.TeacherID, Name: record.TeacherName},
				Comment:   record.Comment,
				Scores:    scores,
			})
		}
	}

	writeJSON(w, http.StatusOK, detail)
}

// studentEvaluations 读取学生的评价历史；limit <= 0 表示不限制。
func (h *API) studentEvaluations(ctx context.Context, studentID string, limit int) ([]models.StudentEvaluationItem, error) {
	query := `SELECT e.id, e.created_at, e.comment, t.id, t.title
		FROM evaluations e
		JOIN submissions s ON s.id = e.submission_id
		JOIN topics t ON t.id = s.topic_id
		WHERE s.student_id = ?
		ORDER BY e.created_at DESC, e.id DESC`
	args := []any{studentID}
	if limit > 0 {
		query += ` LIMIT ?`
		args = append(args, limit)
	}
	rows, err := h.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	type evaluationRow struct {
		ID, CreatedAt, Comment, TopicID, TopicTitle string
	}
	records := make([]evaluationRow, 0)
	for rows.Next() {
		var item evaluationRow
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.Comment, &item.TopicID, &item.TopicTitle); err != nil {
			_ = rows.Close()
			return nil, err
		}
		records = append(records, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	items := make([]models.StudentEvaluationItem, 0, len(records))
	for _, record := range records {
		scores, err := h.evaluationScoresBrief(ctx, record.ID)
		if err != nil {
			return nil, err
		}
		items = append(items, models.StudentEvaluationItem{
			ID:        record.ID,
			CreatedAt: record.CreatedAt,
			Comment:   record.Comment,
			Topic:     models.IDName{ID: record.TopicID, Name: record.TopicTitle},
			Scores:    scores,
		})
	}
	return items, nil
}

// StudentEvaluations GET /api/student/evaluations：我全部历史课题的评价。
func (h *API) StudentEvaluations(w http.ResponseWriter, r *http.Request) {
	items, err := h.studentEvaluations(r.Context(), currentUser(r).ID, 0)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

/* ------------------------------------------------------------------ */
/* 学生提交（multipart：文本 + 多附件）                                */
/* ------------------------------------------------------------------ */

// SubmitTopicSubmission POST /api/student/topics/{id}/submission。
func (h *API) SubmitTopicSubmission(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r)
	ctx := r.Context()
	topicID := r.PathValue("id")

	topic, err := h.getTopic(ctx, topicID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "课题不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	membership, err := h.getMembership(ctx, topicID, user.ID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusForbidden, "无权提交该课题")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if membership.RemovedAt != nil {
		writeError(w, http.StatusForbidden, "你已被移出该课题，只能查看")
		return
	}
	if topic.Status != statusActive {
		writeError(w, http.StatusBadRequest, "课题已关闭，无法提交")
		return
	}

	// 已评价的提交不允许重新提交（保证评价结果稳定）。
	submissionID, err := h.mySubmissionID(ctx, topicID, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if submissionID != "" {
		var evaluationCount int
		if err := h.DB.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM evaluations WHERE submission_id = ?`, submissionID,
		).Scan(&evaluationCount); err != nil {
			serverError(w, err)
			return
		}
		if evaluationCount > 0 {
			writeError(w, http.StatusBadRequest, "老师已评价，不能重新提交")
			return
		}
	}

	// 解析 multipart（限制请求总大小，超出时返回 400）。
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadTotalBytes)
	if err := r.ParseMultipartForm(multipartMemory); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(w, http.StatusBadRequest, "上传内容过大（单文件不超过 100MB，最多 10 个文件）")
			return
		}
		writeError(w, http.StatusBadRequest, "上传格式不正确")
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	textContent := r.FormValue("textContent")
	if len(textContent) > maxTextContentBytes {
		writeError(w, http.StatusBadRequest, "提交文本过长")
		return
	}
	var fileHeaders []*multipart.FileHeader
	if r.MultipartForm != nil {
		fileHeaders = r.MultipartForm.File["files"]
	}
	if len(fileHeaders) > maxFilesPerSubmission {
		writeError(w, http.StatusBadRequest, "最多上传 10 个文件")
		return
	}
	for _, header := range fileHeaders {
		if header.Size > maxFileBytes {
			writeError(w, http.StatusBadRequest, "单个文件不能超过 100MB")
			return
		}
	}

	existing := submissionID != ""
	if !existing {
		submissionID = newID("s")
	}

	// 先把附件写入磁盘；数据库事务失败时清理这些新文件。
	stored := make([]storedFile, 0, len(fileHeaders))
	cleanupNewFiles := func() {
		for _, file := range stored {
			if absolute, err := h.resolveStoragePath(file.StoragePath); err == nil {
				_ = os.Remove(absolute)
			}
		}
	}
	for _, header := range fileHeaders {
		file, err := saveUploadedFile(h.UploadDir, submissionID, header)
		if err != nil {
			cleanupNewFiles()
			if errors.Is(err, errFileTooLarge) {
				writeError(w, http.StatusBadRequest, "单个文件不能超过 100MB")
				return
			}
			serverError(w, err)
			return
		}
		stored = append(stored, file)
	}

	timestamp := now()
	tx, err := h.DB.BeginTx(ctx, nil)
	if err != nil {
		cleanupNewFiles()
		serverError(w, err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	if existing {
		if _, err := tx.ExecContext(ctx,
			`UPDATE submissions SET text_content = ?, updated_at = ? WHERE id = ?`,
			textContent, timestamp, submissionID,
		); err != nil {
			cleanupNewFiles()
			serverError(w, err)
			return
		}
	} else {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO submissions (id, topic_id, student_id, text_content, updated_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			submissionID, topicID, user.ID, textContent, timestamp, timestamp,
		); err != nil {
			cleanupNewFiles()
			serverError(w, err)
			return
		}
	}

	// 记录旧附件路径，提交成功后从磁盘删除。
	oldPaths := make([]string, 0)
	rows, err := tx.QueryContext(ctx,
		`SELECT storage_path FROM submission_files WHERE submission_id = ?`, submissionID)
	if err != nil {
		cleanupNewFiles()
		serverError(w, err)
		return
	}
	for rows.Next() {
		var storagePath string
		if err := rows.Scan(&storagePath); err != nil {
			_ = rows.Close()
			cleanupNewFiles()
			serverError(w, err)
			return
		}
		oldPaths = append(oldPaths, storagePath)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		cleanupNewFiles()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM submission_files WHERE submission_id = ?`, submissionID,
	); err != nil {
		cleanupNewFiles()
		serverError(w, err)
		return
	}
	for _, file := range stored {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO submission_files (id, submission_id, original_name, mime_type, size_bytes, storage_path, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			newID("sf"), submissionID, file.OriginalName, file.MimeType, file.SizeBytes, file.StoragePath, timestamp,
		); err != nil {
			cleanupNewFiles()
			serverError(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		cleanupNewFiles()
		serverError(w, err)
		return
	}

	// 提交成功后再清理旧附件，避免事务失败时丢文件。
	for _, storagePath := range oldPaths {
		if absolute, err := h.resolveStoragePath(storagePath); err == nil {
			_ = os.Remove(absolute)
		}
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}
