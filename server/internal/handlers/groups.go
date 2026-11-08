package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"strings"

	"aiworkspace/server/internal/models"
)

/* ------------------------------------------------------------------ */
/* 教师分组管理（v4）                                                  */
/* ------------------------------------------------------------------ */

// groupRequest 建组 / 改名请求体。
type groupRequest struct {
	Name string `json:"name"`
}

// CreateTopicGroup POST /api/teacher/topics/{id}/groups：创建者与助教可操作。
func (h *API) CreateTopicGroup(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	var req groupRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	ctx := r.Context()
	name := strings.TrimSpace(req.Name)
	if name == "" {
		generated, err := h.nextGroupName(ctx, topic.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		name = generated
	}
	if len([]rune(name)) > 50 {
		writeError(w, http.StatusBadRequest, "小组名称过长")
		return
	}
	groupID := newID("g")
	if _, err := h.DB.ExecContext(ctx,
		`INSERT INTO topic_groups (id, topic_id, name, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		groupID, topic.ID, name, createdByTeacher, now(),
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.CreatedID{ID: groupID})
}

// RenameTopicGroup PATCH /api/teacher/topics/{id}/groups/{groupId}。
func (h *API) RenameTopicGroup(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	group, ok := h.requireGroup(w, r, topic.ID)
	if !ok {
		return
	}
	var req groupRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "请输入小组名称")
		return
	}
	if len([]rune(name)) > 50 {
		writeError(w, http.StatusBadRequest, "小组名称过长")
		return
	}
	if _, err := h.DB.ExecContext(r.Context(),
		`UPDATE topic_groups SET name = ? WHERE id = ?`, name, group.ID,
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

// DeleteTopicGroup DELETE /api/teacher/topics/{id}/groups/{groupId}：组内有提交则 400。
func (h *API) DeleteTopicGroup(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	group, ok := h.requireGroup(w, r, topic.ID)
	if !ok {
		return
	}
	var submissionCount int
	if err := h.DB.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM submissions WHERE group_id = ?`, group.ID,
	).Scan(&submissionCount); err != nil {
		serverError(w, err)
		return
	}
	if submissionCount > 0 {
		writeError(w, http.StatusBadRequest, "该小组已有提交，不能删除")
		return
	}
	if _, err := h.DB.ExecContext(r.Context(),
		`DELETE FROM topic_groups WHERE id = ?`, group.ID,
	); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// addGroupMemberRequest POST /api/teacher/topics/{id}/groups/{groupId}/members 请求体。
type addGroupMemberRequest struct {
	StudentID string `json:"studentId"`
	LoginID   string `json:"loginId"`
}

// AddGroupMember POST /api/teacher/topics/{id}/groups/{groupId}/members。
func (h *API) AddGroupMember(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	group, ok := h.requireGroup(w, r, topic.ID)
	if !ok {
		return
	}
	var req addGroupMemberRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	student, ok := h.resolveStudentForGroup(w, r, req.StudentID, req.LoginID)
	if !ok {
		return
	}
	ctx := r.Context()
	allowed, status, message, err := h.validateGroupAdd(ctx, topic, student.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !allowed {
		writeError(w, status, message)
		return
	}
	var memberCount int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM group_members WHERE group_id = ?`, group.ID,
	).Scan(&memberCount); err != nil {
		serverError(w, err)
		return
	}
	if memberCount >= topic.GroupMax {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("小组人数已满（最多 %d 人）", topic.GroupMax))
		return
	}
	if _, err := h.DB.ExecContext(ctx,
		`INSERT INTO group_members (group_id, student_id, joined_at) VALUES (?, ?, ?)`,
		group.ID, student.ID, now(),
	); err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "该学生已在小组成员中")
			return
		}
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.OK{OK: true})
}

// RemoveGroupMember DELETE /api/teacher/topics/{id}/groups/{groupId}/members/{studentId}。
func (h *API) RemoveGroupMember(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	group, ok := h.requireGroup(w, r, topic.ID)
	if !ok {
		return
	}
	result, err := h.DB.ExecContext(r.Context(),
		`DELETE FROM group_members WHERE group_id = ? AND student_id = ?`,
		group.ID, r.PathValue("studentId"))
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
		writeError(w, http.StatusNotFound, "该学生不在小组中")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// randomGroupingRequest POST /api/teacher/topics/{id}/groups/random 请求体。
type randomGroupingRequest struct {
	GroupCount *int `json:"groupCount"`
}

// RandomGrouping POST /api/teacher/topics/{id}/groups/random：未分组学生尽量均匀随机分组。
func (h *API) RandomGrouping(w http.ResponseWriter, r *http.Request) {
	topic, _, ok := h.requireManageTopic(w, r, r.PathValue("id"))
	if !ok {
		return
	}
	var req randomGroupingRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	ctx := r.Context()

	rows, err := h.DB.QueryContext(ctx,
		`SELECT m.student_id
		 FROM topic_members m
		 WHERE m.topic_id = ? AND m.removed_at IS NULL
		   AND NOT EXISTS (
		     SELECT 1 FROM group_members gm JOIN topic_groups g ON g.id = gm.group_id
		     WHERE g.topic_id = m.topic_id AND gm.student_id = m.student_id
		   )
		 ORDER BY m.student_id`, topic.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	studentIDs := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			serverError(w, err)
			return
		}
		studentIDs = append(studentIDs, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		serverError(w, err)
		return
	}
	_ = rows.Close()

	groups, err := h.loadTopicGroups(ctx, topic.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if len(studentIDs) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
		return
	}
	if topic.GroupMax <= 0 {
		writeError(w, http.StatusBadRequest, "请先设置小组人数上限")
		return
	}

	groupCount := 0
	if req.GroupCount != nil {
		groupCount = *req.GroupCount
	} else {
		groupCount = (len(studentIDs) + topic.GroupMax - 1) / topic.GroupMax
	}
	if groupCount < 1 || groupCount > 100 {
		writeError(w, http.StatusBadRequest, "小组数量需在 1 到 100 之间")
		return
	}
	if len(studentIDs) > groupCount*topic.GroupMax {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("小组数量不足：%d 名学生每组最多 %d 人至少需要 %d 个小组",
				len(studentIDs), topic.GroupMax,
				(len(studentIDs)+topic.GroupMax-1)/topic.GroupMax))
		return
	}

	rand.Shuffle(len(studentIDs), func(i, j int) {
		studentIDs[i], studentIDs[j] = studentIDs[j], studentIDs[i]
	})

	timestamp := now()
	tx, err := h.DB.BeginTx(ctx, nil)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	base := len(groups)
	groupIDs := make([]string, 0, groupCount)
	for i := 0; i < groupCount; i++ {
		groupID := newID("g")
		name := fmt.Sprintf("第%d组", base+i+1)
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO topic_groups (id, topic_id, name, created_by, created_at)
			 VALUES (?, ?, ?, ?, ?)`,
			groupID, topic.ID, name, createdByTeacher, timestamp,
		); err != nil {
			serverError(w, err)
			return
		}
		groupIDs = append(groupIDs, groupID)
	}
	for index, studentID := range studentIDs {
		groupID := groupIDs[index%groupCount]
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO group_members (group_id, student_id, joined_at) VALUES (?, ?, ?)`,
			groupID, studentID, timestamp,
		); err != nil {
			serverError(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}

	groups, err = h.loadTopicGroups(ctx, topic.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

// requireGroup 读取路径中的小组；失败时已写好响应。
func (h *API) requireGroup(w http.ResponseWriter, r *http.Request, topicID string) (*groupRow, bool) {
	group, err := h.getGroup(r.Context(), topicID, r.PathValue("groupId"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "小组不存在")
		return nil, false
	}
	if err != nil {
		serverError(w, err)
		return nil, false
	}
	return group, true
}

// resolveStudentForGroup 解析请求里的学生（id 或 loginId）；失败时已写好响应。
func (h *API) resolveStudentForGroup(w http.ResponseWriter, r *http.Request, studentID, loginID string) (*models.User, bool) {
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
		writeError(w, http.StatusBadRequest, "只能选择学生账号")
		return nil, false
	}
	return student, true
}

/* ------------------------------------------------------------------ */
/* 学生分组（v4）                                                      */
/* ------------------------------------------------------------------ */

// requireStudentTopicForGroup 读取课题并校验当前学生是有效课题成员。
func (h *API) requireStudentTopicForGroup(w http.ResponseWriter, r *http.Request) (*topicRow, *models.User, bool) {
	user := currentUser(r)
	ctx := r.Context()
	topic, err := h.getTopic(ctx, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "课题不存在")
		return nil, nil, false
	}
	if err != nil {
		serverError(w, err)
		return nil, nil, false
	}
	membership, err := h.getMembership(ctx, topic.ID, user.ID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusForbidden, "无权访问该课题")
		return nil, nil, false
	}
	if err != nil {
		serverError(w, err)
		return nil, nil, false
	}
	if membership.RemovedAt != nil {
		writeError(w, http.StatusForbidden, "你已被移出该课题，只能查看")
		return nil, nil, false
	}
	return topic, user, true
}

// StudentCreateGroup POST /api/student/topics/{id}/groups：允许学生自组时创建小组并自动入组。
func (h *API) StudentCreateGroup(w http.ResponseWriter, r *http.Request) {
	topic, user, ok := h.requireStudentTopicForGroup(w, r)
	if !ok {
		return
	}
	if !topic.AllowStudentGroups {
		writeError(w, http.StatusForbidden, "该课题不允许学生自行分组")
		return
	}
	var req groupRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式不正确")
		return
	}
	ctx := r.Context()
	inGroup, err := h.studentInAnyGroup(ctx, topic.ID, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if inGroup {
		writeError(w, http.StatusBadRequest, "你已在小组中，不能重复创建")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		generated, err := h.nextGroupName(ctx, topic.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		name = generated
	}
	if len([]rune(name)) > 50 {
		writeError(w, http.StatusBadRequest, "小组名称过长")
		return
	}

	timestamp := now()
	groupID := newID("g")
	tx, err := h.DB.BeginTx(ctx, nil)
	if err != nil {
		serverError(w, err)
		return
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO topic_groups (id, topic_id, name, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		groupID, topic.ID, name, createdByStudent, timestamp,
	); err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO group_members (group_id, student_id, joined_at) VALUES (?, ?, ?)`,
		groupID, user.ID, timestamp,
	); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, models.CreatedID{ID: groupID})
}

// StudentJoinGroup POST /api/student/topics/{id}/groups/{groupId}/join。
func (h *API) StudentJoinGroup(w http.ResponseWriter, r *http.Request) {
	topic, user, ok := h.requireStudentTopicForGroup(w, r)
	if !ok {
		return
	}
	if !topic.AllowStudentGroups {
		writeError(w, http.StatusForbidden, "该课题不允许学生自行分组")
		return
	}
	ctx := r.Context()
	group, err := h.getGroup(ctx, topic.ID, r.PathValue("groupId"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "小组不存在")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	inGroup, err := h.studentInAnyGroup(ctx, topic.ID, user.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if inGroup {
		writeError(w, http.StatusBadRequest, "你已在小组中，不能重复加入")
		return
	}
	memberCount, err := h.groupMemberCount(ctx, group.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if memberCount >= topic.GroupMax {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("小组人数已满（最多 %d 人）", topic.GroupMax))
		return
	}
	if _, err := h.DB.ExecContext(ctx,
		`INSERT INTO group_members (group_id, student_id, joined_at) VALUES (?, ?, ?)`,
		group.ID, user.ID, now(),
	); err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "你已在该小组中")
			return
		}
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}

// StudentLeaveGroup POST /api/student/topics/{id}/groups/leave：退出当前小组。
func (h *API) StudentLeaveGroup(w http.ResponseWriter, r *http.Request) {
	topic, user, ok := h.requireStudentTopicForGroup(w, r)
	if !ok {
		return
	}
	if !topic.AllowStudentGroups {
		writeError(w, http.StatusForbidden, "该课题不允许学生自行分组")
		return
	}
	ctx := r.Context()
	group, err := h.studentGroupRow(ctx, topic.ID, user.ID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusBadRequest, "你不在小组中")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	var submissionCount int
	if err := h.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM submissions WHERE group_id = ?`, group.ID,
	).Scan(&submissionCount); err != nil {
		serverError(w, err)
		return
	}
	if submissionCount > 0 {
		writeError(w, http.StatusBadRequest, "小组已有提交，不能退出小组")
		return
	}
	if _, err := h.DB.ExecContext(ctx,
		`DELETE FROM group_members WHERE group_id = ? AND student_id = ?`,
		group.ID, user.ID,
	); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, models.OK{OK: true})
}
