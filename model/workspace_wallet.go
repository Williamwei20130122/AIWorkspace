package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// DefaultWorkspaceWalletGrantDay 教师钱包每月默认发放日。
const DefaultWorkspaceWalletGrantDay = 15

// WorkspaceTeacherWallet 教师点数钱包。
//
// 管理员可为每位教师配置「每月固定日期自动发放的点数」，发放时同时给中台教学钱包
// （Balance）与账户 API 额度（users.quota）加点数。教师在教学场景中优先消耗该钱包
// 余额，不占用自身的 API 额度。
type WorkspaceTeacherWallet struct {
	Id             int    `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt      int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt      int64  `json:"updated_at" gorm:"autoUpdateTime"`
	UserId         int    `json:"user_id" gorm:"uniqueIndex"`
	Balance        int    `json:"balance"`                                 // 中台教学点数余额
	GrantAmount    int    `json:"grant_amount"`                            // 每月发放点数
	GrantDay       int    `json:"grant_day"`                               // 每月发放日（1-28），默认 15
	AutoGrant      bool   `json:"auto_grant"`                              // 是否开启每月自动发放
	LastGrantMonth string `json:"last_grant_month" gorm:"type:varchar(7)"` // 上次发放月份 YYYY-MM

	// 展示用，不入库
	Username string `json:"username" gorm:"-"`
	ApiQuota int    `json:"api_quota" gorm:"-"`
}

func normalizeWorkspaceWallet(w *WorkspaceTeacherWallet) {
	if w.GrantDay < 1 || w.GrantDay > 28 {
		w.GrantDay = DefaultWorkspaceWalletGrantDay
	}
	if w.GrantAmount < 0 {
		w.GrantAmount = 0
	}
	if w.Balance < 0 {
		w.Balance = 0
	}
}

// defaultWorkspaceWallet 返回带默认值的空钱包（不落库）。
func defaultWorkspaceWallet(userId int) *WorkspaceTeacherWallet {
	return &WorkspaceTeacherWallet{UserId: userId, GrantDay: DefaultWorkspaceWalletGrantDay}
}

// GetWorkspaceTeacherWallet 读取教师钱包；不存在时返回默认空钱包。
func GetWorkspaceTeacherWallet(userId int) (*WorkspaceTeacherWallet, error) {
	wallet := defaultWorkspaceWallet(userId)
	if userId <= 0 {
		return wallet, nil
	}
	err := DB.Where("user_id = ?", userId).First(wallet).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		wallet = defaultWorkspaceWallet(userId)
	} else if err != nil {
		return nil, err
	}
	normalizeWorkspaceWallet(wallet)
	if user, uErr := GetUserById(userId, false); uErr == nil && user != nil {
		wallet.Username = user.Username
		wallet.ApiQuota = user.Quota
	}
	return wallet, nil
}

// GetOrCreateWorkspaceTeacherWallet 读取（必要时创建）教师钱包记录。
func GetOrCreateWorkspaceTeacherWallet(userId int) (*WorkspaceTeacherWallet, error) {
	if userId <= 0 {
		return nil, common.NewMessage("教师不能为空")
	}
	wallet := &WorkspaceTeacherWallet{}
	err := DB.Where("user_id = ?", userId).First(wallet).Error
	if err == nil {
		normalizeWorkspaceWallet(wallet)
		return wallet, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	wallet = defaultWorkspaceWallet(userId)
	if err := DB.Create(wallet).Error; err != nil {
		return nil, err
	}
	return wallet, nil
}

// ListWorkspaceTeacherWallets 返回全部教师（含未配置钱包者）的钱包视图。
func ListWorkspaceTeacherWallets() ([]*WorkspaceTeacherWallet, error) {
	var teachers []User
	if err := DB.Where("role >= ? AND role < ?", common.RoleAdminUser, common.RoleRootUser).
		Order("id asc").Find(&teachers).Error; err != nil {
		return nil, err
	}
	var wallets []*WorkspaceTeacherWallet
	if err := DB.Find(&wallets).Error; err != nil {
		return nil, err
	}
	byUser := make(map[int]*WorkspaceTeacherWallet, len(wallets))
	for _, wallet := range wallets {
		normalizeWorkspaceWallet(wallet)
		byUser[wallet.UserId] = wallet
	}
	result := make([]*WorkspaceTeacherWallet, 0, len(teachers))
	for i := range teachers {
		teacher := teachers[i]
		wallet := byUser[teacher.Id]
		if wallet == nil {
			wallet = defaultWorkspaceWallet(teacher.Id)
		}
		wallet.Username = teacher.Username
		wallet.ApiQuota = teacher.Quota
		result = append(result, wallet)
	}
	return result, nil
}

// SaveWorkspaceTeacherWalletConfig 保存教师钱包的每月发放配置。
func SaveWorkspaceTeacherWalletConfig(userId, grantAmount, grantDay int, autoGrant bool) (*WorkspaceTeacherWallet, error) {
	if userId <= 0 {
		return nil, common.NewMessage("教师不能为空")
	}
	if _, err := GetOrCreateWorkspaceTeacherWallet(userId); err != nil {
		return nil, err
	}
	if grantAmount < 0 {
		grantAmount = 0
	}
	if grantDay < 1 || grantDay > 28 {
		grantDay = DefaultWorkspaceWalletGrantDay
	}
	if err := DB.Model(&WorkspaceTeacherWallet{}).Where("user_id = ?", userId).
		Updates(map[string]any{
			"grant_amount": grantAmount,
			"grant_day":    grantDay,
			"auto_grant":   autoGrant,
		}).Error; err != nil {
		return nil, err
	}
	return GetWorkspaceTeacherWallet(userId)
}

// GrantWorkspaceTeacherWallet 向教师钱包发放点数：同时增加中台钱包余额与账户 API 额度。
func GrantWorkspaceTeacherWallet(userId, amount int) error {
	if userId <= 0 {
		return common.NewMessage("教师不能为空")
	}
	if amount <= 0 {
		return common.NewMessage("发放点数必须大于 0")
	}
	if _, err := GetOrCreateWorkspaceTeacherWallet(userId); err != nil {
		return err
	}
	if err := DB.Model(&WorkspaceTeacherWallet{}).Where("user_id = ?", userId).
		Update("balance", gorm.Expr("balance + ?", amount)).Error; err != nil {
		return err
	}
	return IncreaseUserQuota(userId, amount, false)
}

// SetWorkspaceTeacherWalletBalance 直接设置中台教学钱包余额（管理员手动校正）。
func SetWorkspaceTeacherWalletBalance(userId, balance int) error {
	if userId <= 0 {
		return common.NewMessage("教师不能为空")
	}
	if balance < 0 {
		balance = 0
	}
	if _, err := GetOrCreateWorkspaceTeacherWallet(userId); err != nil {
		return err
	}
	return DB.Model(&WorkspaceTeacherWallet{}).Where("user_id = ?", userId).
		Update("balance", balance).Error
}

// DeductWorkspaceTeacherWallet 扣减中台教学钱包余额，余额不足返回错误。
func DeductWorkspaceTeacherWallet(userId, points int) error {
	if userId <= 0 || points <= 0 {
		return nil
	}
	result := DB.Model(&WorkspaceTeacherWallet{}).
		Where("user_id = ? AND balance >= ?", userId, points).
		Update("balance", gorm.Expr("balance - ?", points))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return common.NewMessage("教学点数不足")
	}
	return nil
}

// RunWorkspaceTeacherWalletAutoGrant 执行一次「到发放日自动发放」检查，返回本次发放的教师数。
// 已达发放日且当月未发放过的钱包会被发放，并记录发放月份避免重复。
func RunWorkspaceTeacherWalletAutoGrant(now time.Time) int {
	month := now.Format("2006-01")
	day := now.Day()
	var wallets []*WorkspaceTeacherWallet
	if err := DB.Where("auto_grant = ? AND grant_amount > 0", true).Find(&wallets).Error; err != nil {
		common.SysError(common.LogText("workspace wallet auto grant query failed: %s", err.Error()))
		return 0
	}
	granted := 0
	for _, wallet := range wallets {
		normalizeWorkspaceWallet(wallet)
		if day < wallet.GrantDay || wallet.LastGrantMonth == month {
			continue
		}
		if err := GrantWorkspaceTeacherWallet(wallet.UserId, wallet.GrantAmount); err != nil {
			common.SysError(common.LogText("workspace wallet auto grant failed: userId=%d err=%s", wallet.UserId, err.Error()))
			continue
		}
		if err := DB.Model(&WorkspaceTeacherWallet{}).Where("user_id = ?", wallet.UserId).
			Update("last_grant_month", month).Error; err != nil {
			common.SysError(common.LogText("workspace wallet auto grant mark failed: userId=%d err=%s", wallet.UserId, err.Error()))
		}
		granted++
	}
	return granted
}
