// Package models 定义与 docs/CONTRACT.md v3 第 4–6 节 JSON 契约一一对应的结构体。
//
// 约定：
//   - 所有 JSON 字段使用 camelCase；
//   - 时间一律为 RFC3339（UTC）字符串，可空时间用 *string（JSON null）；
//   - 所有列表字段在构造时初始化为空切片，避免序列化成 null，方便前端直接 map。
package models

/* ------------------------------------------------------------------ */
/* 通用                                                                */
/* ------------------------------------------------------------------ */

// User 用户 JSON（登录 / /api/me / 教师学生列表）：绝不包含密码哈希。
type User struct {
	ID          string `json:"id"`
	LoginID     string `json:"loginId"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	AvatarColor string `json:"avatarColor"`
	HasPassword bool   `json:"hasPassword"`
}

// ManagedStudent 教师学生管理列表项（含创建时间，绝不包含密码哈希）。
type ManagedStudent struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	LoginID     string `json:"loginId"`
	Role        string `json:"role"`
	AvatarColor string `json:"avatarColor"`
	HasPassword bool   `json:"hasPassword"`
	CreatedAt   string `json:"createdAt"`
}

/* ------------------------------------------------------------------ */
/* 班级（v4）                                                          */
/* ------------------------------------------------------------------ */

// TeacherClass GET /api/teacher/classes 列表项。
type TeacherClass struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Grade       *string `json:"grade"`
	MemberCount int     `json:"memberCount"`
	TopicCount  int     `json:"topicCount"`
	CreatedAt   string  `json:"createdAt"`
}

// ClassStudent 班级学生（removedAt 非空表示已移出但保留历史）。
type ClassStudent struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	LoginID   string  `json:"loginId"`
	RemovedAt *string `json:"removedAt"`
}

// ClassTopic 班级详情里的课题概要。
type ClassTopic struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

// TeacherClassDetail GET /api/teacher/classes/{id} 响应。
type TeacherClassDetail struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Grade    *string        `json:"grade"`
	Students []ClassStudent `json:"students"`
	Topics   []ClassTopic   `json:"topics"`
}

// StudentClass GET /api/student/classes 列表项。
type StudentClass struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Grade       *string  `json:"grade"`
	Teacher     NameOnly `json:"teacher"`
	MemberCount int      `json:"memberCount"`
	TopicCount  int      `json:"topicCount"`
}

/* ------------------------------------------------------------------ */
/* 分组（v4）                                                          */
/* ------------------------------------------------------------------ */

// GroupMember 小组成员（教师侧）。
type GroupMember struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	LoginID string `json:"loginId"`
}

// TopicGroup 课题小组（教师侧详情）。
type TopicGroup struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	CreatedBy string        `json:"createdBy"`
	Members   []GroupMember `json:"members"`
}

// GroupMemberName 小组成员（学生侧，只含 id / name）。
type GroupMemberName struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// MyGroup 学生当前所在小组。
type MyGroup struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Members []GroupMemberName `json:"members"`
}

// StudentGroup 学生端可见的小组（allowStudentGroups=1 时给全部组）。
type StudentGroup struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	MemberCount int               `json:"memberCount"`
	Members     []GroupMemberName `json:"members"`
}

// IDName 只含 id + name 的简要对象。
type IDName struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// NameOnly 只含姓名的简要对象（学生端课题创建者 / 助教）。
type NameOnly struct {
	Name string `json:"name"`
}

// OK 通用 {"ok":true} 响应。
type OK struct {
	OK bool `json:"ok"`
}

// CreatedID 创建资源时的 201 响应 {"id":...}。
type CreatedID struct {
	ID string `json:"id"`
}

// Health GET /api/health 响应。
type Health struct {
	OK      bool   `json:"ok"`
	Service string `json:"service"`
	Time    string `json:"time"`
}

/* ------------------------------------------------------------------ */
/* 教师端                                                              */
/* ------------------------------------------------------------------ */

// TeacherOverview GET /api/teacher/overview 响应。
type TeacherOverview struct {
	TopicCount             int                 `json:"topicCount"`
	StudentCount           int                 `json:"studentCount"`
	PendingEvaluationCount int                 `json:"pendingEvaluationCount"`
	RecentEvaluations      []RecentEvaluation  `json:"recentEvaluations"`
	PendingSubmissions     []PendingSubmission `json:"pendingSubmissions"`
	Topics                 []OverviewTopic     `json:"topics"`
}

// PendingSubmission 工作台「待评价队列」。
type PendingSubmission struct {
	ID          string `json:"id"`
	TopicID     string `json:"topicId"`
	TopicTitle  string `json:"topicTitle"`
	Student     IDName `json:"student"`
	SubmittedAt string `json:"submittedAt"`
}

// RecentEvaluation 工作台「最近评价」。
type RecentEvaluation struct {
	ID        string `json:"id"`
	CreatedAt string `json:"createdAt"`
	Comment   string `json:"comment"`
	Student   IDName `json:"student"`
	Topic     IDName `json:"topic"`
}

// OverviewTopic 工作台「我的课题」概要。
type OverviewTopic struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	Status          string `json:"status"`
	MemberCount     int    `json:"memberCount"`
	SubmissionCount int    `json:"submissionCount"`
	PendingCount    int    `json:"pendingCount"`
}

// TeacherTopic GET /api/teacher/topics 列表项。
type TeacherTopic struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	Status          string `json:"status"`
	JoinMode        string `json:"joinMode"`
	ClassName       string `json:"className"`
	Owner           IDName `json:"owner"`
	IsOwner         bool   `json:"isOwner"`
	MemberCount     int    `json:"memberCount"`
	SubmissionCount int    `json:"submissionCount"`
	PendingCount    int    `json:"pendingCount"`
	UpdatedAt       string `json:"updatedAt"`
}

// AdminOverview GET /api/admin/overview 管理员总览统计。
type AdminOverview struct {
	TeacherCount    int `json:"teacherCount"`
	StudentCount    int `json:"studentCount"`
	ClassCount      int `json:"classCount"`
	TopicCount      int `json:"topicCount"`
	SubmissionCount int `json:"submissionCount"`
	EvaluationCount int `json:"evaluationCount"`
}

// TeacherTopicPage GET /api/teacher/topics 分页响应。
type TeacherTopicPage struct {
	Items    []TeacherTopic `json:"items"`
	Total    int            `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"pageSize"`
	Stats    TopicStats     `json:"stats"`
}

// TopicStats 课题管理仪表盘统计（不随筛选条件变化）。
type TopicStats struct {
	Active       int `json:"active"`
	Closed       int `json:"closed"`
	PendingTotal int `json:"pendingTotal"`
}

// TeacherTopicDetail GET /api/teacher/topics/{id} 响应。
type TeacherTopicDetail struct {
	ID                 string                   `json:"id"`
	Title              string                   `json:"title"`
	DescriptionMD      string                   `json:"descriptionMd"`
	Status             string                   `json:"status"`
	JoinMode           string                   `json:"joinMode"`
	Owner              IDName                   `json:"owner"`
	Class              *IDName                  `json:"class"`
	SubmitMode         string                   `json:"submitMode"`
	GroupMin           int                      `json:"groupMin"`
	GroupMax           int                      `json:"groupMax"`
	AllowStudentGroups bool                     `json:"allowStudentGroups"`
	Assistants         []TopicAssistant         `json:"assistants"`
	Students           []TopicStudent           `json:"students"`
	Dimensions         []Dimension              `json:"dimensions"`
	Groups             []TopicGroup             `json:"groups"`
	Submissions        []TeacherTopicSubmission `json:"submissions"`
}

// TopicAssistant 课题助教。
type TopicAssistant struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	LoginID string `json:"loginId"`
}

// TopicStudent 课题成员（removedAt 非空表示已移出但保留历史）。
type TopicStudent struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	LoginID     string  `json:"loginId"`
	HasPassword bool    `json:"hasPassword"`
	RemovedAt   *string `json:"removedAt"`
}

// Dimension 评价维度。
type Dimension struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MaxScore  int    `json:"maxScore"`
	SortOrder int    `json:"sortOrder"`
}

// StudentBrief 提交里的学生信息。
type StudentBrief struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	LoginID string `json:"loginId"`
}

// TeacherTopicSubmission 课题详情里的提交列表项。
// 个人提交 student 非空、group 为空；小组提交 group 非空，student 记录实际提交人。
type TeacherTopicSubmission struct {
	ID               string             `json:"id"`
	Student          *StudentBrief      `json:"student"`
	Submitter        *StudentBrief      `json:"submitter"`
	Group            *IDName            `json:"group"`
	TextContent      string             `json:"textContent"`
	UpdatedAt        string             `json:"updatedAt"`
	FileCount        int                `json:"fileCount"`
	EvaluationCount  int                `json:"evaluationCount"`
	LatestEvaluation *EvaluationSummary `json:"latestEvaluation"`
	Pending          bool               `json:"pending"`
}

// EvaluationSummary 提交列表里的最近一次评价。
type EvaluationSummary struct {
	ID      string        `json:"id"`
	Comment string        `json:"comment"`
	Scores  []ScoreDetail `json:"scores"`
}

// ScoreDetail 带维度 id / 名称 / 满分的分数（教师侧）。
type ScoreDetail struct {
	DimensionID   string `json:"dimensionId"`
	DimensionName string `json:"dimensionName"`
	Score         int    `json:"score"`
	MaxScore      int    `json:"maxScore"`
}

// TeacherSubmissionDetail GET /api/teacher/submissions/{id} 响应。
type TeacherSubmissionDetail struct {
	ID          string              `json:"id"`
	Topic       IDName              `json:"topic"`
	Student     *StudentBrief       `json:"student"`
	Submitter   *StudentBrief       `json:"submitter"`
	Group       *IDName             `json:"group"`
	TextContent string              `json:"textContent"`
	Files       []SubmissionFile    `json:"files"`
	UpdatedAt   string              `json:"updatedAt"`
	Evaluations []TeacherEvaluation `json:"evaluations"`
}

// SubmissionFile 提交附件（教师侧，含 MIME）。
type SubmissionFile struct {
	ID           string `json:"id"`
	OriginalName string `json:"originalName"`
	MimeType     string `json:"mimeType"`
	SizeBytes    int64  `json:"sizeBytes"`
}

// TeacherEvaluation 提交详情里的一次评价。
type TeacherEvaluation struct {
	ID        string        `json:"id"`
	CreatedAt string        `json:"createdAt"`
	Teacher   IDName        `json:"teacher"`
	Comment   string        `json:"comment"`
	Scores    []ScoreDetail `json:"scores"`
}

// EvaluationListItem GET /api/teacher/evaluations 列表项。
type EvaluationListItem struct {
	ID           string       `json:"id"`
	CreatedAt    string       `json:"createdAt"`
	Comment      string       `json:"comment"`
	Teacher      IDName       `json:"teacher"`
	Student      IDName       `json:"student"`
	Topic        IDName       `json:"topic"`
	Group        *IDName      `json:"group"`
	SubmissionID string       `json:"submissionId"`
	Scores       []ScoreBrief `json:"scores"`
}

// ScoreBrief 只含维度 id / 名称 / 分数 / 满分的分数（汇总页与学生侧）。
type ScoreBrief struct {
	DimensionID   string `json:"dimensionId"`
	DimensionName string `json:"dimensionName"`
	Score         int    `json:"score"`
	MaxScore      int    `json:"maxScore"`
}

/* ------------------------------------------------------------------ */
/* 学生端                                                              */
/* ------------------------------------------------------------------ */

// StudentOverview GET /api/student/overview 响应。
type StudentOverview struct {
	TopicCount             int                     `json:"topicCount"`
	PendingSubmissionCount int                     `json:"pendingSubmissionCount"`
	SubmittedCount         int                     `json:"submittedCount"`
	LatestEvaluations      []StudentEvaluationItem `json:"latestEvaluations"`
	Topics                 []StudentOverviewTopic  `json:"topics"`
}

// StudentOverviewTopic 学生工作台「我的课题」概要（与学生课题列表项一致）。
type StudentOverviewTopic struct {
	ID              string   `json:"id"`
	Title           string   `json:"title"`
	Status          string   `json:"status"`
	Owner           NameOnly `json:"owner"`
	SubmissionMode  string   `json:"submitMode"`
	EvaluationCount int      `json:"evaluationCount"`
	Submitted       bool     `json:"submitted"`
	UpdatedAt       string   `json:"updatedAt"`
	RemovedAt       *string  `json:"removedAt"`
}

// StudentEvaluationItem 学生评价（工作台最近评价 / 我的全部评价）。
type StudentEvaluationItem struct {
	ID        string       `json:"id"`
	CreatedAt string       `json:"createdAt"`
	Comment   string       `json:"comment"`
	Topic     IDName       `json:"topic"`
	Scores    []ScoreBrief `json:"scores"`
}

// StudentTopic GET /api/student/topics 列表项（含历史课题）。
type StudentTopic struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Status     string   `json:"status"`
	Owner      NameOnly `json:"owner"`
	Submitted  bool     `json:"submitted"`
	SubmitMode string   `json:"submitMode"`
	UpdatedAt  string   `json:"updatedAt"`
	RemovedAt  *string  `json:"removedAt"`
}

// StudentTopicDetail GET /api/student/topics/{id} 响应。
type StudentTopicDetail struct {
	ID                 string                   `json:"id"`
	Title              string                   `json:"title"`
	DescriptionMD      string                   `json:"descriptionMd"`
	Status             string                   `json:"status"`
	Owner              NameOnly                 `json:"owner"`
	Class              *IDName                  `json:"class"`
	SubmitMode         string                   `json:"submitMode"`
	GroupMin           int                      `json:"groupMin"`
	GroupMax           int                      `json:"groupMax"`
	AllowStudentGroups bool                     `json:"allowStudentGroups"`
	Assistants         []NameOnly               `json:"assistants"`
	MyGroup            *MyGroup                 `json:"myGroup"`
	Groups             []StudentGroup           `json:"groups"`
	MySubmission       *StudentSubmission       `json:"mySubmission"`
	MyEvaluations      []StudentEvaluationBrief `json:"myEvaluations"`
}

// StudentSubmission 学生自己的提交。
type StudentSubmission struct {
	ID          string        `json:"id"`
	TextContent string        `json:"textContent"`
	UpdatedAt   string        `json:"updatedAt"`
	Files       []StudentFile `json:"files"`
}

// StudentFile 学生自己的附件（下载走 /api/student/files/{fileId}）。
type StudentFile struct {
	ID           string `json:"id"`
	OriginalName string `json:"originalName"`
	MimeType     string `json:"mimeType"`
	SizeBytes    int64  `json:"sizeBytes"`
}

// StudentEvaluationBrief 学生课题详情里的评价（含评价教师）。
type StudentEvaluationBrief struct {
	ID        string       `json:"id"`
	CreatedAt string       `json:"createdAt"`
	Teacher   IDName       `json:"teacher"`
	Comment   string       `json:"comment"`
	Scores    []ScoreBrief `json:"scores"`
}
