// Package models 定义与 docs/CONTRACT.md 第 5 节 JSON 契约一一对应的结构体。
//
// 约定：
//   - 所有 JSON 字段使用 camelCase；
//   - 时间一律为 RFC3339（UTC）字符串，可空时间用 *string（JSON null）；
//   - 可空的分数 / 评语用指针，保证 null 与 0 / "" 可区分；
//   - 所有列表字段在构造时初始化，避免序列化成 null，方便前端直接 map。
package models

// User 当前登录用户（/api/auth/login、/api/me）。
type User struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Email       string `json:"email"`
	Role        string `json:"role"`
	AvatarColor string `json:"avatarColor"`
}

// StudentBrief 教师工作台「最近提交」里的学生信息（不含邮箱）。
type StudentBrief struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AvatarColor string `json:"avatarColor"`
}

// StudentContact 班级成员 / 作业提交人 / 未提交名单里的学生信息。
type StudentContact struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Email       string `json:"email"`
	AvatarColor string `json:"avatarColor"`
}

// ClassStudent 班级详情的成员，附带加入时间。
type ClassStudent struct {
	StudentContact
	CreatedAt string `json:"createdAt"`
}

// TeacherBrief 班级里的教师信息。
type TeacherBrief struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// TeacherName 学生作业详情里的教师姓名。
type TeacherName struct {
	Name string `json:"name"`
}

// ClassName 班级名称。
type ClassName struct {
	Name string `json:"name"`
}

// ClassIDName 班级 id + 名称。
type ClassIDName struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ClassWithTeacher 学生作业详情里的班级（含教师姓名）。
type ClassWithTeacher struct {
	ID      string      `json:"id"`
	Name    string      `json:"name"`
	Teacher TeacherName `json:"teacher"`
}

// CourseTitleClass 课程标题 + 班级名称（工作台、学生成绩用）。
type CourseTitleClass struct {
	Title string    `json:"title"`
	Class ClassName `json:"class"`
}

// CourseTitleClassID 课程标题 + 班级 id/名称（学生作业列表用）。
type CourseTitleClassID struct {
	Title string      `json:"title"`
	Class ClassIDName `json:"class"`
}

// CourseBrief 班级列表里的课程概要。
type CourseBrief struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Color string `json:"color"`
}

/* ------------------------------------------------------------------ */
/* 健康检查                                                            */
/* ------------------------------------------------------------------ */

// Health GET /api/health 响应。
type Health struct {
	OK      bool   `json:"ok"`
	Service string `json:"service"`
	Time    string `json:"time"`
}

// OK 通用 { "ok": true } 响应。
type OK struct {
	OK bool `json:"ok"`
}

/* ------------------------------------------------------------------ */
/* 教师端                                                              */
/* ------------------------------------------------------------------ */

// TeacherOverview GET /api/teacher/overview 响应。
type TeacherOverview struct {
	ClassCount          int                  `json:"classCount"`
	CourseCount         int                  `json:"courseCount"`
	StudentCount        int                  `json:"studentCount"`
	PendingGrading      int                  `json:"pendingGrading"`
	RecentSubmissions   []RecentSubmission   `json:"recentSubmissions"`
	UpcomingAssignments []UpcomingAssignment `json:"upcomingAssignments"`
}

// RecentSubmission 最近一条提交。
type RecentSubmission struct {
	ID          string            `json:"id"`
	SubmittedAt string            `json:"submittedAt"`
	Score       *int              `json:"score"`
	Student     StudentBrief      `json:"student"`
	Assignment  AssignmentSummary `json:"assignment"`
}

// AssignmentSummary 最近提交所属作业的概要。
type AssignmentSummary struct {
	ID     string           `json:"id"`
	Title  string           `json:"title"`
	Points int              `json:"points"`
	Course CourseTitleClass `json:"course"`
}

// UpcomingAssignment 即将截止的作业。
type UpcomingAssignment struct {
	ID             string           `json:"id"`
	Title          string           `json:"title"`
	DueAt          *string          `json:"dueAt"`
	Points         int              `json:"points"`
	Course         CourseTitleClass `json:"course"`
	SubmittedCount int              `json:"submittedCount"`
}

// TeacherClass 教师班级列表项（也用于创建班级的响应）。
type TeacherClass struct {
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	Grade           *string       `json:"grade"`
	JoinCode        string        `json:"joinCode"`
	CreatedAt       string        `json:"createdAt"`
	EnrollmentCount int           `json:"enrollmentCount"`
	CourseCount     int           `json:"courseCount"`
	Courses         []CourseBrief `json:"courses"`
}

// TeacherClassDetail GET /api/teacher/classes/{id} 响应。
type TeacherClassDetail struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Grade         *string        `json:"grade"`
	JoinCode      string         `json:"joinCode"`
	Teacher       TeacherBrief   `json:"teacher"`
	Students      []ClassStudent `json:"students"`
	Courses       []ClassCourse  `json:"courses"`
	Announcements []Announcement `json:"announcements"`
}

// ClassCourse 班级详情里的课程。
type ClassCourse struct {
	ID                string            `json:"id"`
	Title             string            `json:"title"`
	Description       *string           `json:"description"`
	Color             string            `json:"color"`
	AssignmentCount   int               `json:"assignmentCount"`
	RecentAssignments []AssignmentBrief `json:"recentAssignments"`
}

// AssignmentBrief 课程下最近的作业（id / 标题 / 截止时间）。
type AssignmentBrief struct {
	ID    string  `json:"id"`
	Title string  `json:"title"`
	DueAt *string `json:"dueAt"`
}

// Announcement 班级公告。
type Announcement struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

// CreatedCourse POST /api/teacher/classes/{id}/courses 的 201 响应。
type CreatedCourse struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	Color       string  `json:"color"`
	ClassID     string  `json:"classId"`
	CreatedAt   string  `json:"createdAt"`
}

// CreatedAnnouncement POST /api/teacher/classes/{id}/announcements 的 201 响应。
type CreatedAnnouncement struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	ClassID   string `json:"classId"`
	CreatedAt string `json:"createdAt"`
}

// CreatedAssignment POST /api/teacher/assignments 的 201 响应。
type CreatedAssignment struct {
	ID string `json:"id"`
}

// TeacherAssignment 教师作业列表项。
type TeacherAssignment struct {
	ID             string                  `json:"id"`
	Title          string                  `json:"title"`
	Points         int                     `json:"points"`
	DueAt          *string                 `json:"dueAt"`
	CreatedAt      string                  `json:"createdAt"`
	Course         TeacherAssignmentCourse `json:"course"`
	SubmittedCount int                     `json:"submittedCount"`
	GradedCount    int                     `json:"gradedCount"`
}

// TeacherAssignmentCourse 作业列表里的课程 / 班级。
type TeacherAssignmentCourse struct {
	ID    string      `json:"id"`
	Title string      `json:"title"`
	Class ClassIDName `json:"class"`
}

// TeacherAssignmentDetail GET /api/teacher/assignments/{id} 响应。
type TeacherAssignmentDetail struct {
	ID              string                 `json:"id"`
	Title           string                 `json:"title"`
	Description     *string                `json:"description"`
	Points          int                    `json:"points"`
	DueAt           *string                `json:"dueAt"`
	CreatedAt       string                 `json:"createdAt"`
	Course          AssignmentDetailCourse `json:"course"`
	SubmissionCount int                    `json:"submissionCount"`
	GradedCount     int                    `json:"gradedCount"`
	Submissions     []GradeSubmission      `json:"submissions"`
	MissingStudents []StudentContact       `json:"missingStudents"`
}

// AssignmentDetailCourse 作业详情里的课程 / 班级。
type AssignmentDetailCourse struct {
	Title string      `json:"title"`
	Class ClassIDName `json:"class"`
}

// GradeSubmission 作业详情里的一条提交（含批改信息）。
type GradeSubmission struct {
	ID          string         `json:"id"`
	Student     StudentContact `json:"student"`
	Content     string         `json:"content"`
	SubmittedAt string         `json:"submittedAt"`
	Score       *int           `json:"score"`
	Feedback    *string        `json:"feedback"`
	GradedAt    *string        `json:"gradedAt"`
}

/* ------------------------------------------------------------------ */
/* 学生端                                                              */
/* ------------------------------------------------------------------ */

// StudentOverview GET /api/student/overview 响应。
type StudentOverview struct {
	ClassCount          int                     `json:"classCount"`
	CourseCount         int                     `json:"courseCount"`
	PendingCount        int                     `json:"pendingCount"`
	SubmittedCount      int                     `json:"submittedCount"`
	AveragePercent      *int                    `json:"averagePercent"` // 无已批改作业时为 null
	DueSoon             []DueSoonAssignment     `json:"dueSoon"`
	RecentAnnouncements []AnnouncementWithClass `json:"recentAnnouncements"`
}

// DueSoonAssignment 学生工作台「即将截止」。
type DueSoonAssignment struct {
	ID     string           `json:"id"`
	Title  string           `json:"title"`
	DueAt  *string          `json:"dueAt"`
	Points int              `json:"points"`
	Course CourseTitleClass `json:"course"`
}

// AnnouncementWithClass 学生端公告（带班级名称）。
type AnnouncementWithClass struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	CreatedAt string    `json:"createdAt"`
	Class     ClassName `json:"class"`
}

// StudentClass 学生班级列表项。
type StudentClass struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Teacher      TeacherBrief    `json:"teacher"`
	StudentCount int             `json:"studentCount"`
	Courses      []StudentCourse `json:"courses"`
}

// StudentCourse 学生班级里的课程（含作业数）。
type StudentCourse struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	AssignmentCount int    `json:"assignmentCount"`
}

// JoinResult POST /api/student/classes/join 的响应。
type JoinResult struct {
	OK        bool   `json:"ok"`
	ClassName string `json:"className"`
}

// StudentAssignment 学生作业列表项。
type StudentAssignment struct {
	ID           string             `json:"id"`
	Title        string             `json:"title"`
	Points       int                `json:"points"`
	DueAt        *string            `json:"dueAt"`
	Course       CourseTitleClassID `json:"course"`
	MySubmission *MySubmission      `json:"mySubmission"`
}

// MySubmission 学生自己的提交摘要。
type MySubmission struct {
	ID          string  `json:"id"`
	SubmittedAt string  `json:"submittedAt"`
	Content     string  `json:"content"`
	Score       *int    `json:"score"`
	Feedback    *string `json:"feedback"`
	GradedAt    *string `json:"gradedAt"`
}

// StudentAssignmentDetail GET /api/student/assignments/{id} 响应。
type StudentAssignmentDetail struct {
	ID           string              `json:"id"`
	Title        string              `json:"title"`
	Description  *string             `json:"description"`
	Points       int                 `json:"points"`
	DueAt        *string             `json:"dueAt"`
	Course       StudentCourseDetail `json:"course"`
	MySubmission *MySubmission       `json:"mySubmission"`
}

// StudentCourseDetail 学生作业详情里的课程 / 班级。
type StudentCourseDetail struct {
	Title string           `json:"title"`
	Class ClassWithTeacher `json:"class"`
}

// Grade 学生成绩单条目（仅已批改的提交）。
type Grade struct {
	ID          string          `json:"id"`
	Score       int             `json:"score"`
	Feedback    *string         `json:"feedback"`
	SubmittedAt string          `json:"submittedAt"`
	Assignment  GradeAssignment `json:"assignment"`
}

// GradeAssignment 成绩单里的作业信息。
type GradeAssignment struct {
	ID     string           `json:"id"`
	Title  string           `json:"title"`
	Points int              `json:"points"`
	DueAt  *string          `json:"dueAt"`
	Course CourseTitleClass `json:"course"`
}
