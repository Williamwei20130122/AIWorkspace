package controller

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 飞书 / Lark 自建应用扫码登录。域名由 LarkDomain 决定：空或 "feishu" = 飞书国内版，"lark" = Lark 国际版。
const (
	larkFeishuAPIBase    = "https://open.feishu.cn"
	larkLarksuiteAPIBase = "https://open.larksuite.com"
)

func larkAPIBase() string {
	if strings.EqualFold(strings.TrimSpace(common.LarkDomain), "lark") {
		return larkLarksuiteAPIBase
	}
	return larkFeishuAPIBase
}

type larkTokenResponse struct {
	Code         int    `json:"code"`
	Msg          string `json:"msg"`
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
}

type larkUserInfoResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		OpenId    string `json:"open_id"`
		UnionId   string `json:"union_id"`
		UserId    string `json:"user_id"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
	} `json:"data"`
}

func exchangeLarkUserToken(ctx context.Context, code string) (string, error) {
	if code == "" {
		return "", common.NewMessage("Invalid parameters")
	}
	// 回调统一落到前端静态页，由该页把 code/state 回传给前端。
	redirectURI := fmt.Sprintf("%s/oauth-callback.html", system_setting.ServerAddress)
	body, err := common.Marshal(map[string]string{
		"grant_type":    "authorization_code",
		"client_id":     common.LarkAppId,
		"client_secret": common.LarkAppSecret,
		"code":          code,
		"redirect_uri":  redirectURI,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, larkAPIBase()+"/open-apis/authen/v2/oauth/token", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, common.LogText("[OAuth-Lark] exchange token error: %s", err.Error()))
		return "", err
	}
	defer res.Body.Close()
	var tokenResponse larkTokenResponse
	if err := common.DecodeJson(res.Body, &tokenResponse); err != nil {
		logger.LogError(ctx, common.LogText("[OAuth-Lark] exchange token decode error: %s", err.Error()))
		return "", err
	}
	if tokenResponse.Code != 0 || tokenResponse.AccessToken == "" {
		logger.LogError(ctx, common.LogText("[OAuth-Lark] exchange token failed: code=%d, msg=%s", tokenResponse.Code, tokenResponse.Msg))
		return "", common.NewMessage("Failed to get token from Lark, please check settings")
	}
	return tokenResponse.AccessToken, nil
}

// getLarkOpenIdByCode 用扫码 code 换取用户 open_id。
func getLarkOpenIdByCode(ctx context.Context, code string) (string, error) {
	userAccessToken, err := exchangeLarkUserToken(ctx, code)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, larkAPIBase()+"/open-apis/authen/v1/user_info", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+userAccessToken)
	client := http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, common.LogText("[OAuth-Lark] get user info error: %s", err.Error()))
		return "", err
	}
	defer res.Body.Close()
	var userInfo larkUserInfoResponse
	if err := common.DecodeJson(res.Body, &userInfo); err != nil {
		logger.LogError(ctx, common.LogText("[OAuth-Lark] get user info decode error: %s", err.Error()))
		return "", err
	}
	if userInfo.Code != 0 {
		logger.LogError(ctx, common.LogText("[OAuth-Lark] get user info failed: code=%d, msg=%s", userInfo.Code, userInfo.Msg))
		return "", common.NewMessage("Failed to get the Lark user information, please check settings")
	}
	if userInfo.Data.OpenId == "" {
		logger.LogError(ctx, common.LogText("[OAuth-Lark] get user info returned no open_id"))
		return "", common.NewMessage("Lark returned empty user info, please check settings")
	}
	return userInfo.Data.OpenId, nil
}

// LarkAuth 飞书扫码登录：只有已绑定的账号才能登录，未绑定不自动建号。
func LarkAuth(c *gin.Context) {
	if !common.LarkOAuthEnabled {
		common.ApiErrorT(c, "{{provider}} login and registration has not been enabled by administrator", providerParams("Lark"))
		return
	}
	code := strings.TrimSpace(c.Query("code"))
	openId, err := getLarkOpenIdByCode(c.Request.Context(), code)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	user := model.User{LarkOpenId: openId}
	if !model.IsLarkOpenIdAlreadyTaken(openId) {
		common.ApiErrorT(c, "This {{provider}} account is not linked to any account yet, please link it from your profile first", providerParams("Lark"))
		return
	}
	if err := user.FillUserByLarkOpenId(); err != nil {
		common.ApiError(c, err)
		return
	}
	if user.Id == 0 {
		common.ApiErrorT(c, "User has been deleted")
		return
	}
	if user.Status != common.UserStatusEnabled {
		common.ApiErrorT(c, "User has been banned")
		return
	}
	setupLogin(&user, nil, c)
}

type larkBindRequest struct {
	Code string `json:"code"`
}

// LarkBind 绑定飞书：仅教师及以上（role >= RoleAdminUser）可用，且复用 step-up 安全校验。
func LarkBind(c *gin.Context) {
	identity, ok := middleware.GetStepUpIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return
	}
	succeeded, notificationFailed := false, false
	defer func() {
		recordUserSecurityAudit(c, identity.UserID, "user.binding_bind", map[string]any{"provider": "lark", "success": succeeded, "notification_failed": notificationFailed})
	}()
	if !common.LarkOAuthEnabled {
		common.ApiErrorT(c, "{{provider}} login and registration has not been enabled by administrator", providerParams("Lark"))
		return
	}
	operator, err := model.GetUserById(identity.UserID, false)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	if operator.Role < common.RoleAdminUser {
		writeAccountStatusError(c, http.StatusForbidden, "Only teachers and administrators can bind a single sign-on account")
		return
	}
	var req larkBindRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	code := strings.TrimSpace(req.Code)
	context, err := common.Marshal(service.AccountBindingContext{Provider: "lark", Code: code})
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: context}) == nil {
		return
	}
	openId, err := getLarkOpenIdByCode(c.Request.Context(), code)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if model.IsLarkOpenIdAlreadyTaken(openId) {
		common.ApiErrorT(c, "This {{provider}} account has already been bound", providerParams("Lark"))
		return
	}
	// 只更新绑定列，避免完整用户快照覆盖并发的封禁、降权或分组变更。
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		return model.UpdateUserBindColumnForSessionWithTx(tx, identity, "lark_open_id", openId)
	}); err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	succeeded = true
	user, err := model.GetUserById(identity.UserID, false)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	notificationFailed = service.NotifyAccountSecurityChange(service.AccountMailLanguage(c, user.Id), user.Email, i18n.MsgSecurityEventLoginLinked, map[string]any{"Provider": "Lark"}) != nil
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"notification_warning": notificationFailed},
	})
}
