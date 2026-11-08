package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"aiworkspace/server/internal/models"
)

/* ------------------------------------------------------------------ */
/* v4（班级 + 分组）共享辅助                                           */
/* ------------------------------------------------------------------ */

// validSubmitMode 判断提交模式是否合法。
func validSubmitMode(mode string) bool {
	return mode == submitModeIndividual || mode == submitModeGroup
}

// gradePtr 把可空年级转成 JSON / SQL 值。
func gradePtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// classRow 是 classes 表的原始行。
type classRow struct {
	ID        string
	Name      string
	Grade     *string
	TeacherID string
	CreatedAt string
	UpdatedAt string
}

// getClass 按 id 读取班级；不存在返回 sql.ErrNoRows。
func (h *API) getClass(ctx context.Context, id string) (*classRow, error) {
	var (
		class classRow
		grade sql.NullString
	)
	err := h.DB.QueryRowContext(ctx,
		`SELECT id, name, grade, teacher_id, created_at, updated_at FROM classes WHERE id = ?`, id,
	).Scan(&class.ID, &class.Name, &grade, &class.TeacherID, &class.CreatedAt, &class.UpdatedAt)
	if err != nil {
		return nil, err
	}
	class.Grade = strPtr(grade)
	return &class, nil
}

// requireOwnerClass 读取班级并校验「班级所属老师」；失败时已写好响应。
func (h *API) requireOwnerClass(w http.ResponseWriter, r *http.Request, classID string) (*classRow, bool) {
	user := currentUser(r)
	class, err := h.getClass(r.Context(), classID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "班级不存在")
		return nil, false
	}
	if err != nil {
		serverError(w, err)
		return nil, false
	}
	if class.TeacherID != user.ID {
		writeError(w, 403, "无权管理该班级")
		return nil, false
	}
	return class, true
}

// classMemberActive 判断学生是否为班级当前有效成员。
func (h *API) classMemberActive(ctx context.Context, classID, studentID string) (bool, error) {
	var count int
	err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM class_members WHERE class_id = ? AND student_id = ? AND removed_at IS NULL`,
		classID, studentID,
	).Scan(&count)
	return count > 0, err
}

// activeTopicMember 判断学生是否为课题当前有效成员。
func (h *API) activeTopicMember(ctx context.Context, topicID, studentID string) (bool, error) {
	var count int
	err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM topic_members WHERE topic_id = ? AND student_id = ? AND removed_at IS NULL`,
		topicID, studentID,
	).Scan(&count)
	return count > 0, err
}

/* ------------------------------------------------------------------ */
/* 小组辅助                                                            */
/* ------------------------------------------------------------------ */

// groupRow 是 topic_groups 表的原始行。
type groupRow struct {
	ID        string
	Name      string
	CreatedBy string
	CreatedAt string
}

// getGroup 按 id 读取课题内的小组；不存在返回 sql.ErrNoRows。
func (h *API) getGroup(ctx context.Context, topicID, groupID string) (*groupRow, error) {
	var group groupRow
	err := h.DB.QueryRowContext(ctx,
		`SELECT id, name, created_by, created_at FROM topic_groups WHERE id = ? AND topic_id = ?`,
		groupID, topicID,
	).Scan(&group.ID, &group.Name, &group.CreatedBy, &group.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &group, nil
}

// studentGroupRow 读取学生在课题内所在的小组；不在任何小组时返回 sql.ErrNoRows。
func (h *API) studentGroupRow(ctx context.Context, topicID, studentID string) (*groupRow, error) {
	var group groupRow
	err := h.DB.QueryRowContext(ctx,
		`SELECT g.id, g.name, g.created_by, g.created_at
		 FROM group_members gm JOIN topic_groups g ON g.id = gm.group_id
		 WHERE g.topic_id = ? AND gm.student_id = ?
		 LIMIT 1`, topicID, studentID,
	).Scan(&group.ID, &group.Name, &group.CreatedBy, &group.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &group, nil
}

// studentInAnyGroup 判断学生是否已在课题的某个小组中。
func (h *API) studentInAnyGroup(ctx context.Context, topicID, studentID string) (bool, error) {
	var count int
	err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM group_members gm JOIN topic_groups g ON g.id = gm.group_id
		 WHERE g.topic_id = ? AND gm.student_id = ?`, topicID, studentID,
	).Scan(&count)
	return count > 0, err
}

// groupMemberCount 返回小组人数。
func (h *API) groupMemberCount(ctx context.Context, groupID string) (int, error) {
	var count int
	err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM group_members WHERE group_id = ?`, groupID,
	).Scan(&count)
	return count, err
}

// groupMembersDetail 返回小组成员（含 loginId，教师侧）。
func (h *API) groupMembersDetail(ctx context.Context, groupID string) ([]models.GroupMember, error) {
	rows, err := h.DB.QueryContext(ctx,
		`SELECT u.id, u.name, u.login_id
		 FROM group_members gm JOIN users u ON u.id = gm.student_id
		 WHERE gm.group_id = ? ORDER BY gm.joined_at, u.name, u.id`, groupID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	members := make([]models.GroupMember, 0)
	for rows.Next() {
		var item models.GroupMember
		if err := rows.Scan(&item.ID, &item.Name, &item.LoginID); err != nil {
			return nil, err
		}
		members = append(members, item)
	}
	return members, rows.Err()
}

// groupMemberNames 返回小组成员（只含 id / name，学生侧）。
func (h *API) groupMemberNames(ctx context.Context, groupID string) ([]models.GroupMemberName, error) {
	rows, err := h.DB.QueryContext(ctx,
		`SELECT u.id, u.name
		 FROM group_members gm JOIN users u ON u.id = gm.student_id
		 WHERE gm.group_id = ? ORDER BY gm.joined_at, u.name, u.id`, groupID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	members := make([]models.GroupMemberName, 0)
	for rows.Next() {
		var item models.GroupMemberName
		if err := rows.Scan(&item.ID, &item.Name); err != nil {
			return nil, err
		}
		members = append(members, item)
	}
	return members, rows.Err()
}

// loadTopicGroups 读取课题全部小组（教师侧，含成员）。
func (h *API) loadTopicGroups(ctx context.Context, topicID string) ([]models.TopicGroup, error) {
	type groupBrief struct {
		ID, Name, CreatedBy string
	}
	rows, err := h.DB.QueryContext(ctx,
		`SELECT id, name, created_by FROM topic_groups WHERE topic_id = ?
		 ORDER BY created_at, name, id`, topicID)
	if err != nil {
		return nil, err
	}
	groups := make([]groupBrief, 0)
	for rows.Next() {
		var item groupBrief
		if err := rows.Scan(&item.ID, &item.Name, &item.CreatedBy); err != nil {
			_ = rows.Close()
			return nil, err
		}
		groups = append(groups, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	result := make([]models.TopicGroup, 0, len(groups))
	for _, group := range groups {
		members, err := h.groupMembersDetail(ctx, group.ID)
		if err != nil {
			return nil, err
		}
		result = append(result, models.TopicGroup{
			ID:        group.ID,
			Name:      group.Name,
			CreatedBy: group.CreatedBy,
			Members:   members,
		})
	}
	return result, nil
}

// loadStudentGroups 读取课题全部小组（学生侧：id/name/memberCount/members）。
func (h *API) loadStudentGroups(ctx context.Context, topicID string) ([]models.StudentGroup, error) {
	type groupBrief struct {
		ID, Name string
	}
	rows, err := h.DB.QueryContext(ctx,
		`SELECT id, name FROM topic_groups WHERE topic_id = ?
		 ORDER BY created_at, name, id`, topicID)
	if err != nil {
		return nil, err
	}
	groups := make([]groupBrief, 0)
	for rows.Next() {
		var item groupBrief
		if err := rows.Scan(&item.ID, &item.Name); err != nil {
			_ = rows.Close()
			return nil, err
		}
		groups = append(groups, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	result := make([]models.StudentGroup, 0, len(groups))
	for _, group := range groups {
		members, err := h.groupMemberNames(ctx, group.ID)
		if err != nil {
			return nil, err
		}
		result = append(result, models.StudentGroup{
			ID:          group.ID,
			Name:        group.Name,
			MemberCount: len(members),
			Members:     members,
		})
	}
	return result, nil
}

// buildMyGroup 把小组行转换成学生侧 myGroup。
func (h *API) buildMyGroup(ctx context.Context, group *groupRow) (*models.MyGroup, error) {
	members, err := h.groupMemberNames(ctx, group.ID)
	if err != nil {
		return nil, err
	}
	return &models.MyGroup{ID: group.ID, Name: group.Name, Members: members}, nil
}

// nextGroupName 生成默认组名「第 N 组」。
func (h *API) nextGroupName(ctx context.Context, topicID string) (string, error) {
	var count int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM topic_groups WHERE topic_id = ?`, topicID,
	).Scan(&count); err != nil {
		return "", err
	}
	return "第" + strconv.Itoa(count+1) + "组", nil
}

// validateGroupAdd 校验学生能否加入小组；返回 ok / 状态码 / 文案 / 内部错误。
func (h *API) validateGroupAdd(ctx context.Context, topic *topicRow, studentID string) (bool, int, string, error) {
	active, err := h.activeTopicMember(ctx, topic.ID, studentID)
	if err != nil {
		return false, 0, "", err
	}
	if !active {
		return false, 400, "该学生不在课题中，无法加入小组", nil
	}
	inGroup, err := h.studentInAnyGroup(ctx, topic.ID, studentID)
	if err != nil {
		return false, 0, "", err
	}
	if inGroup {
		return false, 400, "该学生已在其他小组中", nil
	}
	return true, 0, "", nil
}

/* ------------------------------------------------------------------ */
/* 提交辅助（v4：个人 / 小组）                                         */
/* ------------------------------------------------------------------ */

// submissionRecord 是提交及其关联学生 / 小组 / 提交人的原始行。
type submissionRecord struct {
	ID           string
	TopicID      string
	StudentID    *string
	StudentName  *string
	StudentLogin *string
	GroupID      *string
	GroupName    *string
	SubmitterID  *string
	Submitter    *string
	SubmitterLID *string
	TextContent  string
	UpdatedAt    string
	CreatedAt    string
}

// getSubmissionRecord 按 id 读取提交记录（含个人 / 小组信息）；不存在返回 sql.ErrNoRows。
func (h *API) getSubmissionRecord(ctx context.Context, submissionID string) (*submissionRecord, error) {
	var (
		record      submissionRecord
		studentID   sql.NullString
		studentName sql.NullString
		studentLID  sql.NullString
		groupID     sql.NullString
		groupName   sql.NullString
		byID        sql.NullString
		byName      sql.NullString
		byLID       sql.NullString
	)
	err := h.DB.QueryRowContext(ctx,
		`SELECT s.id, s.topic_id, s.student_id, su.name, su.login_id,
		        s.group_id, g.name, s.submitted_by, sb.name, sb.login_id,
		        s.text_content, s.updated_at, s.created_at
		 FROM submissions s
		 LEFT JOIN users su ON su.id = s.student_id
		 LEFT JOIN topic_groups g ON g.id = s.group_id
		 LEFT JOIN users sb ON sb.id = s.submitted_by
		 WHERE s.id = ?`, submissionID,
	).Scan(&record.ID, &record.TopicID, &studentID, &studentName, &studentLID,
		&groupID, &groupName, &byID, &byName, &byLID,
		&record.TextContent, &record.UpdatedAt, &record.CreatedAt)
	if err != nil {
		return nil, err
	}
	record.StudentID = strPtr(studentID)
	record.StudentName = strPtr(studentName)
	record.StudentLogin = strPtr(studentLID)
	record.GroupID = strPtr(groupID)
	record.GroupName = strPtr(groupName)
	record.SubmitterID = strPtr(byID)
	record.Submitter = strPtr(byName)
	record.SubmitterLID = strPtr(byLID)
	return &record, nil
}

// studentBriefFrom 构造 *StudentBrief（任一字段缺失时返回 nil）。
func studentBriefFrom(id, name, login *string) *models.StudentBrief {
	if id == nil || name == nil {
		return nil
	}
	brief := &models.StudentBrief{ID: *id, Name: *name}
	if login != nil {
		brief.LoginID = *login
	}
	return brief
}

// recordStudent 返回提交的「学生」展示信息：个人提交用学生本人，小组提交优先用实际提交人。
func (r *submissionRecord) recordStudent() *models.StudentBrief {
	if r.StudentID != nil {
		return studentBriefFrom(r.StudentID, r.StudentName, r.StudentLogin)
	}
	return studentBriefFrom(r.SubmitterID, r.Submitter, r.SubmitterLID)
}

// recordGroup 返回提交的小组（个人提交返回 nil）。
func (r *submissionRecord) recordGroup() *models.IDName {
	if r.GroupID == nil {
		return nil
	}
	name := ""
	if r.GroupName != nil {
		name = *r.GroupName
	}
	return &models.IDName{ID: *r.GroupID, Name: name}
}

// studentSubmissionForTopic 按课题提交模式返回学生（或所在小组）在课题下的提交 id。
func (h *API) studentSubmissionForTopic(ctx context.Context, topic *topicRow, studentID string) (string, error) {
	if topic.SubmitMode == submitModeGroup {
		group, err := h.studentGroupRow(ctx, topic.ID, studentID)
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		var submissionID string
		err = h.DB.QueryRowContext(ctx,
			`SELECT id FROM submissions WHERE topic_id = ? AND group_id = ?`,
			topic.ID, group.ID,
		).Scan(&submissionID)
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		return submissionID, nil
	}
	return h.mySubmissionID(ctx, topic.ID, studentID)
}

// studentSubmissionIDForTopicID 是 studentSubmissionForTopic 的便捷版本（只给课题 id）。
func (h *API) studentSubmissionIDForTopicID(ctx context.Context, topicID, studentID string) (string, error) {
	topic, err := h.getTopic(ctx, topicID)
	if err != nil {
		return "", err
	}
	return h.studentSubmissionForTopic(ctx, topic, studentID)
}

// submissionAccessibleByStudent 判断学生能否查看某提交（本人或所在小组成员）。
func (h *API) submissionAccessibleByStudent(ctx context.Context, record *submissionRecord, studentID string) (bool, error) {
	if record.StudentID != nil && *record.StudentID == studentID {
		return true, nil
	}
	if record.GroupID == nil {
		return false, nil
	}
	var count int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM group_members WHERE group_id = ? AND student_id = ?`,
		*record.GroupID, studentID,
	).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

// topicSubmissionItem 把提交记录转换成课题详情里的提交列表项。
func (h *API) topicSubmissionItem(ctx context.Context, record *submissionRecord) (models.TeacherTopicSubmission, error) {
	var fileCount, evaluationCount int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM submission_files WHERE submission_id = ?`, record.ID,
	).Scan(&fileCount); err != nil {
		return models.TeacherTopicSubmission{}, err
	}
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM evaluations WHERE submission_id = ?`, record.ID,
	).Scan(&evaluationCount); err != nil {
		return models.TeacherTopicSubmission{}, err
	}
	latest, err := h.latestEvaluation(ctx, record.ID)
	if err != nil {
		return models.TeacherTopicSubmission{}, err
	}
	item := models.TeacherTopicSubmission{
		ID:               record.ID,
		Student:          record.recordStudent(),
		Submitter:        studentBriefFrom(record.SubmitterID, record.Submitter, record.SubmitterLID),
		Group:            record.recordGroup(),
		TextContent:      record.TextContent,
		UpdatedAt:        record.UpdatedAt,
		FileCount:        fileCount,
		EvaluationCount:  evaluationCount,
		LatestEvaluation: latest,
		Pending:          evaluationCount == 0,
	}
	// 个人提交时 submitter 与 student 一致。
	if item.Submitter == nil {
		item.Submitter = item.Student
	}
	return item, nil
}

// loadTopicSubmissionItems 读取课题提交列表（教师侧）。
func (h *API) loadTopicSubmissionItems(ctx context.Context, topicID string) ([]models.TeacherTopicSubmission, error) {
	rows, err := h.DB.QueryContext(ctx,
		`SELECT id FROM submissions WHERE topic_id = ? ORDER BY updated_at DESC, id`, topicID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	items := make([]models.TeacherTopicSubmission, 0, len(ids))
	for _, id := range ids {
		record, err := h.getSubmissionRecord(ctx, id)
		if err != nil {
			return nil, err
		}
		item, err := h.topicSubmissionItem(ctx, record)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}
