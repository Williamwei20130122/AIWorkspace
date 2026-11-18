package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- 管理员：教师点数钱包 ----------

// GetWorkspaceTeacherWalletsAdmin 返回全部教师（含未配置者）的钱包视图。
func GetWorkspaceTeacherWalletsAdmin(c *gin.Context) {
	wallets, err := model.ListWorkspaceTeacherWallets()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, wallets)
}

type workspaceWalletConfigRequest struct {
	UserId      int  `json:"user_id"`
	GrantAmount int  `json:"grant_amount"`
	GrantDay    int  `json:"grant_day"`
	AutoGrant   bool `json:"auto_grant"`
}

// UpdateWorkspaceTeacherWalletAdmin 保存某教师的每月发放配置（发放日 / 数量 / 开关）。
func UpdateWorkspaceTeacherWalletAdmin(c *gin.Context) {
	var req workspaceWalletConfigRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	wallet, err := model.SaveWorkspaceTeacherWalletConfig(req.UserId, req.GrantAmount, req.GrantDay, req.AutoGrant)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, wallet)
}

type workspaceWalletGrantRequest struct {
	UserId int `json:"user_id"`
	Amount int `json:"amount"`
}

// GrantWorkspaceTeacherWalletAdmin 手动向某教师发放点数（同时加到中台钱包与 API 额度）。
func GrantWorkspaceTeacherWalletAdmin(c *gin.Context) {
	var req workspaceWalletGrantRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.GrantWorkspaceTeacherWallet(req.UserId, req.Amount); err != nil {
		common.ApiError(c, err)
		return
	}
	wallet, err := model.GetWorkspaceTeacherWallet(req.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, wallet)
}

// SetWorkspaceTeacherWalletBalanceAdmin 直接设置某教师的中台钱包余额。
func SetWorkspaceTeacherWalletBalanceAdmin(c *gin.Context) {
	var req workspaceWalletGrantRequest
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.SetWorkspaceTeacherWalletBalance(req.UserId, req.Amount); err != nil {
		common.ApiError(c, err)
		return
	}
	wallet, err := model.GetWorkspaceTeacherWallet(req.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, wallet)
}
