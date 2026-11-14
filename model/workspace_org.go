package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/pkg/errors"
	"gorm.io/gorm"
)

// 教学组织主数据的账号部分：账号查找、用户名顺位编号与转班审计。
// 学部、年级换算与学年结转见 workspace_section.go。

// ---------- 账号查找 ----------

// GetUserByUsername 按登录名精确查找账号；不存在时返回 (nil, nil)。
func GetUserByUsername(username string) (*User, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, nil
	}
	var user User
	if err := DB.Where("username = ?", username).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &user, nil
}

// ListWorkspaceTeacherUsers 返回全部教师及以上角色的账号（不分页，避免漏掉超过 100 个的教师）。
func ListWorkspaceTeacherUsers() ([]*User, error) {
	var users []*User
	err := DB.Where("role >= ?", common.RoleAdminUser).Order("id asc").Find(&users).Error
	return users, err
}

// ---------- 用户名顺位编号 ----------

// WorkspaceUsernameSequence 用户名顺位编号分配器。
// 唯一键为（前缀, 届别）：学生前缀为学部代码，教师前缀固定为 T（届别固定 0）。
type WorkspaceUsernameSequence struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
	PrefixKey string `json:"prefix_key" gorm:"type:varchar(16);uniqueIndex:idx_ws_uname_seq"`
	EntryYear int    `json:"entry_year" gorm:"uniqueIndex:idx_ws_uname_seq"`
	NextSeq   int    `json:"next_seq"`
}

// ---------- 转班审计 ----------

// WorkspaceStudentTransferLog 学生班级归属变更审计（转班、转学部、留级、直升）。
type WorkspaceStudentTransferLog struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime;index"`
	UserId      int    `json:"user_id" gorm:"index"`
	FromClassId int    `json:"from_class_id"`
	ToClassId   int    `json:"to_class_id"`
	Reason      string `json:"reason" gorm:"type:varchar(255)"`
	OperatorId  int    `json:"operator_id"`
}
