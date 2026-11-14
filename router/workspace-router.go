package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// SetWorkspaceRouter 注册 AI Workspace 多模态生成中台的学生端入口。
//
// 生成通路仿 /pg 组单独挂载（不走 /api 组的 gzip，避免影响 SSE 流式输出）：
// 先用仪表盘会话鉴权（UserAuth），再由 WorkspaceSessionToken 映射为一次性
// 会话令牌上下文，从而完整复用 new-api 的限流、渠道路由与计费机制。
func SetWorkspaceRouter(router *gin.Engine) {
	workspaceRouter := router.Group("/api/workspace")
	workspaceRouter.Use(middleware.RouteTag("relay"))
	workspaceRouter.Use(middleware.SystemPerformanceCheck())

	// 学生独立登录入口：班级 + 姓名（可选学号）登录，无密码；班级下拉为公开只读。
	// 必须在鉴权子分组之前注册，否则会被 UserAuth 拦截。
	workspaceRouter.POST("/student/login", middleware.CriticalRateLimit(), controller.WorkspaceStudentLogin)
	workspaceRouter.GET("/student/classes", middleware.CriticalRateLimit(), controller.GetWorkspaceStudentLoginClasses)

	// 任务结果查询：沿用 new-api 的任务读写契约，按本人过滤。
	queryRouter := workspaceRouter.Group("")
	queryRouter.Use(middleware.UserAuth())
	{
		queryRouter.GET("/task/:key", controller.GetTask)
		queryRouter.GET("/task/:key/artifacts", controller.GetTaskArtifacts)
		queryRouter.GET("/tasks", controller.GetUserTask)
		queryRouter.GET("/capabilities", controller.GetWorkspaceCapabilities)
		// 点数总览：学生端与数据看板以点数展示剩余/已用。
		queryRouter.GET("/points", controller.GetWorkspacePoints)
		// 我的记录：学生仅返回本人，教师/管理员可带 user_id 参数筛选。
		queryRouter.GET("/records", controller.GetWorkspaceRecords)
		// 参考素材上传：图生图源图 / 视频参考图先写入本地磁盘，再由生成请求引用。
		queryRouter.POST("/uploads", controller.UploadWorkspaceAsset)
		// 参考素材回显（本地存储未配置直链时使用，仅归属者与可见范围内的教师可读）。
		queryRouter.GET("/artifacts/:id/content", controller.GetWorkspaceArtifactContent)
		// 班级共享素材：同班学生与教师共享的素材库（云端素材按班级共享）。
		queryRouter.GET("/shared-artifacts", controller.GetWorkspaceSharedArtifacts)
		// 学生账户管理：查看本人档案与自助设置登录密码。
		queryRouter.GET("/student/profile", controller.GetWorkspaceStudentProfile)
		queryRouter.POST("/student/password", controller.UpdateWorkspaceStudentPassword)

		// 课堂任务：当前进行中的课堂会话、任务面板与提交（文字 / 文件 / AI 作品）。
		queryRouter.GET("/class-session", controller.GetWorkspaceClassSession)
		queryRouter.POST("/class-session/submissions", controller.CreateWorkspaceTaskSubmission)
		queryRouter.POST("/class-session/submissions/file", controller.UploadWorkspaceTaskSubmissionFile)

		// HTML 编程实验室：可用模型/单次点数、我的项目列表与项目详情。
		queryRouter.GET("/html/config", controller.GetWorkspaceHtmlLabConfig)
		queryRouter.GET("/html/projects", controller.ListWorkspaceHtmlProjects)
		queryRouter.GET("/html/projects/:id", controller.GetWorkspaceHtmlProject)
		queryRouter.PUT("/html/projects/:id", controller.RenameWorkspaceHtmlProject)

		// 演示实验室（Slide Lab）：可用模型/单次点数、我的项目列表与项目详情。
		queryRouter.GET("/slide/config", controller.GetWorkspaceSlideLabConfig)
		queryRouter.GET("/slide/projects", controller.ListWorkspaceSlideProjects)
		queryRouter.GET("/slide/projects/:id", controller.GetWorkspaceSlideProject)
		queryRouter.PUT("/slide/projects/:id", controller.RenameWorkspaceSlideProject)
	}

	// 教师端：教师（role>=10）可查看全部班级与学生；控制器内部按角色做兜底校验。
	teacherRouter := workspaceRouter.Group("/teacher")
	teacherRouter.Use(middleware.AdminAuth())
	{
		teacherRouter.GET("/records", controller.GetWorkspaceRecords)
		teacherRouter.GET("/reconciliation", controller.GetWorkspaceReconciliation)
		teacherRouter.GET("/reconciliation/export", controller.ExportWorkspaceReconciliation)
		// 学情管理：按学生聚合生成次数/点数/金额与能力分布（支持时间范围与班级筛选）。
		teacherRouter.GET("/insights", controller.GetWorkspaceInsights)
		// 学习报告：按班级的周/月能力使用、完成率与点数消耗趋势图。
		teacherRouter.GET("/report", controller.GetWorkspaceReport)

		// 班级管理：教师可新建 / 编辑 / 删除班级，并批量导入建班建号。
		teacherRouter.GET("/classes", controller.GetWorkspaceClasses)
		teacherRouter.POST("/classes", controller.CreateWorkspaceClass)
		teacherRouter.PUT("/classes", controller.UpdateWorkspaceClass)
		teacherRouter.DELETE("/classes/:id", controller.DeleteWorkspaceClass)
		teacherRouter.GET("/classes/import-template", controller.DownloadWorkspaceClassTemplate)
		teacherRouter.POST("/classes/import", controller.ImportWorkspaceClasses)

		// 上课小班（授课分班）：编码、绑教师、正课/选修、AI 权限开关与成员管理。
		teacherRouter.GET("/small-classes", controller.GetWorkspaceSmallClasses)
		teacherRouter.POST("/small-classes", controller.CreateWorkspaceSmallClass)
		teacherRouter.PUT("/small-classes", controller.UpdateWorkspaceSmallClass)
		teacherRouter.DELETE("/small-classes/:id", controller.DeleteWorkspaceSmallClass)
		// 一键开启/关闭小班全部 AI 生成权限。
		teacherRouter.PUT("/small-classes/ai", controller.SetWorkspaceSmallClassAIEnabled)
		teacherRouter.GET("/small-classes/:id/members", controller.GetWorkspaceSmallClassMembers)
		teacherRouter.POST("/small-classes/:id/members", controller.AddWorkspaceSmallClassMembers)
		teacherRouter.DELETE("/small-classes/:id/members/:student_id", controller.RemoveWorkspaceSmallClassMember)
		teacherRouter.POST("/small-classes/:id/members/batch-delete", controller.RemoveWorkspaceSmallClassMembers)
		teacherRouter.POST("/small-classes/:id/import-parent-students", controller.ImportWorkspaceSmallClassParentStudents)
		// 小班导入学生：按 姓名+届次+年级 模糊匹配，未匹配返回清单供手动配对。
		teacherRouter.GET("/small-classes/import-template", controller.DownloadWorkspaceSmallClassImportTemplate)
		teacherRouter.POST("/small-classes/:id/import", controller.ImportWorkspaceSmallClassStudents)
		// 导出小班学生账户信息 Excel（学号/登录名/点数/状态），供学生核对账户。
		teacherRouter.GET("/small-classes/:id/accounts/export", controller.ExportWorkspaceSmallClassAccounts)

		// 备课模式：年级 → 单元 → 课时 → 分项任务，支持整课时复制复用。
		teacherRouter.GET("/lesson-plans", controller.GetWorkspaceLessonPlans)
		// 备课批量导入：下载 Excel 模板 / 上传解析。
		teacherRouter.GET("/lesson-plans/import-template", controller.DownloadWorkspaceLessonTemplate)
		teacherRouter.POST("/lesson-plans/import", controller.ImportWorkspaceLessonPlans)
		teacherRouter.POST("/units", controller.CreateWorkspaceUnit)
		teacherRouter.PUT("/units", controller.UpdateWorkspaceUnit)
		teacherRouter.DELETE("/units/:id", controller.DeleteWorkspaceUnit)
		teacherRouter.POST("/lessons", controller.CreateWorkspaceLesson)
		teacherRouter.PUT("/lessons", controller.UpdateWorkspaceLesson)
		teacherRouter.DELETE("/lessons/:id", controller.DeleteWorkspaceLesson)
		teacherRouter.POST("/lessons/:id/copy", controller.CopyWorkspaceLesson)
		teacherRouter.POST("/lesson-tasks", controller.CreateWorkspaceLessonTask)
		teacherRouter.PUT("/lesson-tasks", controller.UpdateWorkspaceLessonTask)
		teacherRouter.DELETE("/lesson-tasks/:id", controller.DeleteWorkspaceLessonTask)

		// 授课分发：课时一键分发到小班，查看课堂会话与学生提交。
		teacherRouter.GET("/class-sessions", controller.GetWorkspaceClassSessions)
		teacherRouter.POST("/class-sessions/distribute", controller.DistributeWorkspaceLesson)
		teacherRouter.POST("/class-sessions/temp", controller.CreateTempWorkspaceClassSession)
		teacherRouter.GET("/class-sessions/:id", controller.GetWorkspaceClassSessionDetail)
		teacherRouter.GET("/class-sessions/:id/progress", controller.GetWorkspaceClassSessionProgress)
		teacherRouter.POST("/class-sessions/:id/close", controller.CloseWorkspaceClassSession)
		teacherRouter.GET("/class-sessions/:id/package", controller.PackageWorkspaceClassSession)

		// 学生管理：教师可新建 / 删除 / 批量新建 / 转班学生。
		teacherRouter.GET("/students", controller.GetWorkspaceStudents)
		teacherRouter.POST("/students", controller.CreateWorkspaceStudent)
		teacherRouter.PUT("/students", controller.UpdateWorkspaceStudent)
		teacherRouter.DELETE("/students/:id", controller.DeleteWorkspaceStudent)
		teacherRouter.POST("/students/batch-create", controller.BatchCreateWorkspaceStudents)
		teacherRouter.POST("/students/transfer", controller.TransferWorkspaceStudent)
		teacherRouter.POST("/students/points", controller.SetWorkspaceStudentPoints)
		teacherRouter.POST("/students/points/batch", controller.BatchSetWorkspaceStudentPoints)
		teacherRouter.POST("/students/account", controller.UpdateWorkspaceStudentAccount)
		// 重置学生密码：清除已设置密码标记，恢复免密登录。
		teacherRouter.POST("/students/password/reset", controller.ResetWorkspaceStudentPassword)
		// 按中文姓名自动转拼音，供名单表格自动填充。
		teacherRouter.GET("/students/pinyin", controller.GetWorkspacePinyin)

		teacherRouter.GET("/users", controller.GetWorkspaceUsers)
		teacherRouter.GET("/accounts", controller.GetWorkspaceAccounts)
		teacherRouter.PUT("/accounts/quotas", controller.UpdateWorkspaceAccountQuotas)
		teacherRouter.POST("/accounts/reset", controller.ResetWorkspaceAccountUsage)
		teacherRouter.POST("/accounts/usage/clear", controller.ClearWorkspaceAccountUsedQuota)

		// 教学组织只读视图：教师选择授课对象时需要。
		teacherRouter.GET("/sections", controller.GetWorkspaceSections)
		teacherRouter.GET("/section-options", controller.GetWorkspaceSectionGrades)
		teacherRouter.GET("/teachers", controller.GetWorkspaceTeachers)

		// 云端素材：生成产物按时间段筛选、预览与删除。
		teacherRouter.GET("/artifacts", controller.GetWorkspaceArtifacts)
		teacherRouter.GET("/artifacts/:id/content", controller.GetWorkspaceArtifactContent)
		teacherRouter.DELETE("/artifacts/:id", controller.DeleteWorkspaceArtifact)
		// 素材班级共享：设为共享 / 取消共享（share_class_id=0 取消）。
		teacherRouter.POST("/artifacts/share", controller.ShareWorkspaceArtifact)
		// 打包下载：把选中的素材打为 zip 流式返回。
		teacherRouter.POST("/artifacts/package", controller.PackageWorkspaceArtifacts)
	}

	// 超级管理员端：全站配置与账户管理，仅 role=100 可进入。
	adminRouter := workspaceRouter.Group("/admin")
	adminRouter.Use(middleware.RootAuth())
	{
		adminRouter.GET("/capabilities", controller.GetWorkspaceCapabilitiesAdmin)

		// 模型生成能力声明：在模型管理里按模型勾选支持的模态。
		adminRouter.GET("/model-capabilities", controller.GetWorkspaceModelCapabilitiesAdmin)
		adminRouter.PUT("/model-capabilities", controller.UpdateWorkspaceModelCapabilitiesAdmin)

		// 使用记录（全量 / 指定用户）
		adminRouter.GET("/records", controller.GetWorkspaceRecords)

		// 定价规则（按次售价 + 上游成本计价）
		adminRouter.GET("/pricing", controller.GetWorkspacePricingAdmin)
		adminRouter.PUT("/pricing", controller.UpdateWorkspacePricingAdmin)

		// 月度对账
		adminRouter.GET("/reconciliation", controller.GetWorkspaceReconciliation)
		adminRouter.GET("/reconciliation/export", controller.ExportWorkspaceReconciliation)
		// 学情管理：按学生聚合生成次数/点数/金额与能力分布（支持时间范围与班级筛选）。
		adminRouter.GET("/insights", controller.GetWorkspaceInsights)
		// 学习报告：按班级的周/月能力使用、完成率与点数消耗趋势图。
		adminRouter.GET("/report", controller.GetWorkspaceReport)

		// 账户与能力额度
		adminRouter.GET("/users", controller.GetWorkspaceUsers)
		adminRouter.GET("/accounts", controller.GetWorkspaceAccounts)
		adminRouter.PUT("/accounts/quotas", controller.UpdateWorkspaceAccountQuotas)
		adminRouter.POST("/accounts/reset", controller.ResetWorkspaceAccountUsage)
		// 一键清零累计已用点数（不影响剩余点数）。
		adminRouter.POST("/accounts/usage/clear", controller.ClearWorkspaceAccountUsedQuota)
		// 用户管理页（new-api 原生）一键清零已用点数。
		adminRouter.POST("/users/usage/clear", controller.ClearWorkspaceAccountUsedQuota)

		// 班级管理
		adminRouter.GET("/classes", controller.GetWorkspaceClasses)
		adminRouter.POST("/classes", controller.CreateWorkspaceClass)
		adminRouter.PUT("/classes", controller.UpdateWorkspaceClass)
		adminRouter.DELETE("/classes/:id", controller.DeleteWorkspaceClass)
		// 批量导入：下载示例模板 + 上传 Excel 建班建号。
		adminRouter.GET("/classes/import-template", controller.DownloadWorkspaceClassTemplate)
		adminRouter.POST("/classes/import", controller.ImportWorkspaceClasses)

		// 上课小班（授课分发的分班单位）：与教师端同一套控制器。
		adminRouter.GET("/small-classes", controller.GetWorkspaceSmallClasses)
		adminRouter.POST("/small-classes", controller.CreateWorkspaceSmallClass)
		adminRouter.PUT("/small-classes", controller.UpdateWorkspaceSmallClass)
		adminRouter.DELETE("/small-classes/:id", controller.DeleteWorkspaceSmallClass)
		adminRouter.PUT("/small-classes/ai", controller.SetWorkspaceSmallClassAIEnabled)
		adminRouter.GET("/small-classes/:id/members", controller.GetWorkspaceSmallClassMembers)
		adminRouter.POST("/small-classes/:id/members", controller.AddWorkspaceSmallClassMembers)
		adminRouter.DELETE("/small-classes/:id/members/:student_id", controller.RemoveWorkspaceSmallClassMember)
		adminRouter.POST("/small-classes/:id/members/batch-delete", controller.RemoveWorkspaceSmallClassMembers)
		adminRouter.POST("/small-classes/:id/import-parent-students", controller.ImportWorkspaceSmallClassParentStudents)
		adminRouter.GET("/small-classes/import-template", controller.DownloadWorkspaceSmallClassImportTemplate)
		adminRouter.POST("/small-classes/:id/import", controller.ImportWorkspaceSmallClassStudents)
		// 导出小班学生账户信息 Excel（学号/登录名/点数/状态），供学生核对账户。
		adminRouter.GET("/small-classes/:id/accounts/export", controller.ExportWorkspaceSmallClassAccounts)

		// 备课模式（超管同教师端能力，便于跨教师维护方案）。
		adminRouter.GET("/lesson-plans", controller.GetWorkspaceLessonPlans)
		adminRouter.GET("/lesson-plans/import-template", controller.DownloadWorkspaceLessonTemplate)
		adminRouter.POST("/lesson-plans/import", controller.ImportWorkspaceLessonPlans)
		adminRouter.POST("/units", controller.CreateWorkspaceUnit)
		adminRouter.PUT("/units", controller.UpdateWorkspaceUnit)
		adminRouter.DELETE("/units/:id", controller.DeleteWorkspaceUnit)
		adminRouter.POST("/lessons", controller.CreateWorkspaceLesson)
		adminRouter.PUT("/lessons", controller.UpdateWorkspaceLesson)
		adminRouter.DELETE("/lessons/:id", controller.DeleteWorkspaceLesson)
		adminRouter.POST("/lessons/:id/copy", controller.CopyWorkspaceLesson)
		adminRouter.POST("/lesson-tasks", controller.CreateWorkspaceLessonTask)
		adminRouter.PUT("/lesson-tasks", controller.UpdateWorkspaceLessonTask)
		adminRouter.DELETE("/lesson-tasks/:id", controller.DeleteWorkspaceLessonTask)
		// 授课分发：超管同教师端能力。
		adminRouter.GET("/class-sessions", controller.GetWorkspaceClassSessions)
		adminRouter.POST("/class-sessions/distribute", controller.DistributeWorkspaceLesson)
		adminRouter.POST("/class-sessions/temp", controller.CreateTempWorkspaceClassSession)
		adminRouter.GET("/class-sessions/:id", controller.GetWorkspaceClassSessionDetail)
		adminRouter.GET("/class-sessions/:id/progress", controller.GetWorkspaceClassSessionProgress)
		adminRouter.POST("/class-sessions/:id/close", controller.CloseWorkspaceClassSession)
		adminRouter.GET("/class-sessions/:id/package", controller.PackageWorkspaceClassSession)

		// 教师点数钱包：每月发放配置 + 手动发放。
		adminRouter.GET("/teacher-wallets", controller.GetWorkspaceTeacherWalletsAdmin)
		adminRouter.PUT("/teacher-wallets", controller.UpdateWorkspaceTeacherWalletAdmin)
		adminRouter.POST("/teacher-wallets/grant", controller.GrantWorkspaceTeacherWalletAdmin)
		adminRouter.POST("/teacher-wallets/balance", controller.SetWorkspaceTeacherWalletBalanceAdmin)

		// 学生管理
		adminRouter.GET("/students", controller.GetWorkspaceStudents)
		adminRouter.POST("/students", controller.CreateWorkspaceStudent)
		adminRouter.PUT("/students", controller.UpdateWorkspaceStudent)
		adminRouter.DELETE("/students/:id", controller.DeleteWorkspaceStudent)
		adminRouter.POST("/students/points", controller.SetWorkspaceStudentPoints)
		adminRouter.POST("/students/points/batch", controller.BatchSetWorkspaceStudentPoints)
		adminRouter.POST("/students/batch-create", controller.BatchCreateWorkspaceStudents)
		adminRouter.POST("/students/account", controller.UpdateWorkspaceStudentAccount)
		// 重置学生密码：清除已设置密码标记，恢复免密登录。
		adminRouter.POST("/students/password/reset", controller.ResetWorkspaceStudentPassword)
		// 按中文姓名自动转拼音，供名单表格自动填充。
		adminRouter.GET("/students/pinyin", controller.GetWorkspacePinyin)
		// 转班 / 转年级 / 留级 / 直升。
		adminRouter.POST("/students/transfer", controller.TransferWorkspaceStudent)

		// 学部管理：学部内配置学制年限、年级阶梯与升级规则，年级按届别自动换算。
		adminRouter.GET("/sections", controller.GetWorkspaceSections)
		adminRouter.POST("/sections", controller.CreateWorkspaceSection)
		adminRouter.PUT("/sections", controller.UpdateWorkspaceSection)
		adminRouter.DELETE("/sections/:id", controller.DeleteWorkspaceSection)
		// 年级阶梯选项：由学部学制实时推导，供班级与使用记录筛选使用。
		adminRouter.GET("/section-options", controller.GetWorkspaceSectionGrades)
		adminRouter.GET("/section-overview", controller.GetWorkspaceSectionOverview)
		// 学年结转：超出学部学制年限的在读学生自动冻结为「已毕业」（幂等）。
		adminRouter.POST("/school-year/rollover", controller.RolloverWorkspaceSchoolYear)

		// 教师账号
		adminRouter.GET("/teachers", controller.GetWorkspaceTeachers)
		adminRouter.POST("/teachers", controller.CreateWorkspaceTeacher)

		adminRouter.GET("/artifacts", controller.GetWorkspaceArtifacts)
		adminRouter.GET("/artifacts/:id/content", controller.GetWorkspaceArtifactContent)
		adminRouter.DELETE("/artifacts/:id", controller.DeleteWorkspaceArtifact)
		adminRouter.POST("/artifacts/share", controller.ShareWorkspaceArtifact)
		// 批量清理：{from,to} / {mode:"class", class_id}。
		adminRouter.POST("/artifacts/purge", controller.PurgeWorkspaceArtifacts)
		// 打包下载：把选中的素材打为 zip 流式返回。
		adminRouter.POST("/artifacts/package", controller.PackageWorkspaceArtifacts)
	}

	generateRouter := workspaceRouter.Group("/generate")
	generateRouter.Use(middleware.UserAuth())
	generateRouter.Use(middleware.WorkspaceSessionToken())
	generateRouter.Use(middleware.WorkspaceGenerateRoute())
	// 按次计费：生成前校验点数，成功生成后扣点数并记录对账明细。
	generateRouter.Use(middleware.WorkspaceMetering())
	// 云端素材：采集中台入口的产物并落盘为可用文件。
	generateRouter.Use(middleware.WorkspaceArtifactCapture())

	// 同步能力：文生文 / 文生图 / 图生图 / 声音合成。
	syncRouter := generateRouter.Group("")
	syncRouter.Use(middleware.ModelRequestRateLimit())
	syncRouter.Use(middleware.Distribute())
	{
		syncRouter.POST("/text", controller.WorkspaceRelay)
		syncRouter.POST("/image", controller.WorkspaceRelay)
		syncRouter.POST("/edit", controller.WorkspaceRelay)
		syncRouter.POST("/tts", controller.WorkspaceRelay)
		// HTML 编程实验室：提示词工程 → 聊天补全 → 提取代码块并落库项目/对话。
		syncRouter.POST("/html",
			middleware.WorkspaceHTMLPrepare(),
			middleware.WorkspaceHTMLCapture(),
			controller.WorkspaceRelay,
		)
		// 演示实验室：提示词工程 → 聊天补全 → 提取 slides JSON 并落库项目/对话。
		syncRouter.POST("/slide",
			middleware.WorkspaceSlidePrepare(),
			middleware.WorkspaceSlideCapture(),
			controller.WorkspaceRelay,
		)
	}

	// 视频生成：复用 /v1/video/generations 的任务提交链路（含共享端点认领）。
	videoRouter := generateRouter.Group("")
	{
		videoRouter.POST("/video",
			middleware.PinTaskPluginEndpoint(),
			middleware.TaskPluginEndpointOnly(middleware.ModelRequestRateLimit()),
			middleware.PrepareTaskPluginEndpoint(),
			middleware.Distribute(),
			func(c *gin.Context) {
				controller.RelayTaskPluginEndpoint(c, controller.RelayTask)
			},
		)
	}

	// 音乐生成：走任务插件提交链路，插件 key 由能力配置注入。
	musicRouter := generateRouter.Group("")
	{
		musicRouter.POST("/music",
			middleware.ModelRequestRateLimit(),
			middleware.PrepareTaskPluginSubmit(),
			middleware.Distribute(),
			controller.RelayTask,
		)
	}
}
