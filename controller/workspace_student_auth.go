package controller

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

type workspaceStudentLoginRequest struct {
	ClassId int `json:"class_id"`
	// GradeName 年级名：登录页只选年级不选班级，用于缩小账号命中范围。
	GradeName string `json:"grade_name"`
	Name      string `json:"name"`
	StudentNo string `json:"student_no"`
	// Account 学号 / 登录账号 / 小写拼音用户名，三种均可用于登录。
	Account  string `json:"account"`
	Password string `json:"password"`
}

// WorkspaceStudentLogin 学生独立登录入口：
// 优先使用「账号（学号 / 登录账号 / 小写拼音） + 密码」登录；
// 兼容旧的「班级 + 姓名（可选学号）」免密登录模式。
func WorkspaceStudentLogin(c *gin.Context) {
	var req workspaceStudentLoginRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}

	var (
		student *model.WorkspaceStudent
		err     error
	)
	account := strings.TrimSpace(req.Account)
	if account != "" {
		student, err = model.FindWorkspaceStudentByAccount(account, req.ClassId, req.GradeName)
	} else {
		name := strings.TrimSpace(req.Name)
		studentNo := strings.TrimSpace(req.StudentNo)
		if req.ClassId <= 0 || name == "" {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		student, err = model.FindWorkspaceStudentForLogin(req.ClassId, name, studentNo)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}

	user, err := model.GetUserById(student.UserId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if user.Status != common.UserStatusEnabled {
		common.ApiError(c, common.NewMessage("账号已被停用"))
		return
	}
	// 学生本人或教师主动设置过密码后，必须校验密码；未设置密码时保持免密登录。
	// 新建账号时写入的随机占位密码不算「已设置」，因此以 student.PasswordSet 为准。
	if student.PasswordSet {
		password := strings.TrimSpace(req.Password)
		if password == "" {
			common.ApiError(c, common.NewMessage("该账号已设置登录密码，请输入密码"))
			return
		}
		if user.Password == "" || !common.ValidatePasswordAndHash(password, user.Password) {
			common.ApiError(c, common.NewMessage("账号或密码错误"))
			return
		}
	}

	bundle, err := service.CreateLoginSession(
		user.Id,
		"workspace_student",
		c.ClientIP(),
		c.Request.UserAgent(),
	)
	if err != nil {
		writeAuthSessionError(c, err)
		return
	}
	c.Set("login_method", bundle.Session.LoginMethod)
	model.UpdateUserLastLoginAt(user.Id)
	service.WriteRefreshCookie(c, bundle.RefreshToken)
	setAuthNoStore(c)
	recordLoginAudit(user, c)
	c.JSON(http.StatusOK, gin.H{
		"message": "",
		"success": true,
		"data": gin.H{
			"access_token":      bundle.AccessToken,
			"token_type":        bundle.TokenType,
			"access_expires_at": bundle.AccessExpiresAt,
			"session":           bundle.Session,
			"user":              buildSelfUserData(user),
			"student": gin.H{
				"id":           student.Id,
				"display_name": student.DisplayName,
				"class_id":     student.ClassId,
				"student_no":   student.StudentNo,
				"pinyin":       student.PinyinUsername,
			},
		},
	})
}

// GetWorkspaceStudentLoginClasses 公开只读返回「启用中的班级」列表，供学生登录下拉使用。
func GetWorkspaceStudentLoginClasses(c *gin.Context) {
	classes, err := model.GetAllWorkspaceClasses()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]gin.H, 0, len(classes))
	for _, class := range classes {
		if !class.Enabled {
			continue
		}
		result = append(result, gin.H{
			"id":           class.Id,
			"name":         class.Name,
			"section_name": class.SectionName,
			"grade_index":  class.GradeIndex,
			"grade_name":   class.GradeName,
		})
	}
	common.ApiSuccess(c, result)
}

// GetWorkspaceStudentProfile 返回当前登录学生自己的账号档案（学生端「账户管理」使用）。
func GetWorkspaceStudentProfile(c *gin.Context) {
	userId := c.GetInt("id")
	student, err := model.GetWorkspaceStudentByUserId(userId)
	if err != nil {
		common.ApiError(c, common.NewMessage("仅学生账号可查看账户信息"))
		return
	}
	user, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	class, err := model.GetWorkspaceClassById(student.ClassId)
	classInfo := gin.H{}
	if err == nil && class != nil {
		classInfo = gin.H{
			"class_id":   class.Id,
			"class_name": class.Name,
			"grade_name": class.GradeName,
		}
	}
	common.ApiSuccess(c, gin.H{
		"student_id":      student.Id,
		"display_name":    student.DisplayName,
		"student_no":      student.StudentNo,
		"username":        user.Username,
		"pinyin_username": student.PinyinUsername,
		"password_set":    student.PasswordSet,
		"class":           classInfo,
	})
}

// UpdateWorkspaceStudentPassword 学生自助设置登录密码；已设置过密码时需校验旧密码。
func UpdateWorkspaceStudentPassword(c *gin.Context) {
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	userId := c.GetInt("id")
	student, err := model.GetWorkspaceStudentByUserId(userId)
	if err != nil || student.UserId <= 0 {
		common.ApiError(c, common.NewMessage("仅学生账号可设置登录密码"))
		return
	}
	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiError(c, common.NewMessage("账号不存在"))
		return
	}
	newPassword := strings.TrimSpace(req.NewPassword)
	if len(newPassword) < 6 {
		common.ApiError(c, common.NewMessage("密码长度不能少于 6 位"))
		return
	}
	if student.PasswordSet {
		if user.Password == "" || !common.ValidatePasswordAndHash(strings.TrimSpace(req.OldPassword), user.Password) {
			common.ApiError(c, common.NewMessage("原密码不正确"))
			return
		}
	}
	hashed, err := common.HashAccountPassword(newPassword)
	if err != nil {
		common.ApiError(c, common.NewMessage("密码设置失败"))
		return
	}
	// 直接改密码列：不提升 auth_version，避免学生设置完密码后被强制退出登录。
	if err := model.DB.Model(&model.User{}).Where("id = ?", userId).Update("password", hashed).Error; err != nil {
		common.ApiError(c, common.NewMessage("密码设置失败"))
		return
	}
	// 标记「已设置密码」，之后该学生登录必须输入密码。
	if err := model.DB.Model(&model.WorkspaceStudent{}).Where("id = ?", student.Id).
		Update("password_set", true).Error; err != nil {
		common.ApiError(c, common.NewMessage("密码设置失败"))
		return
	}
	common.ApiSuccess(c, gin.H{"password_set": true})
}
