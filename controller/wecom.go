package controller

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 企业微信自建应用扫码登录。access_token 需要缓存，避免每次登录都取一遍。
var (
	weComTokenMu     sync.Mutex
	weComTokenValue  string
	weComTokenExpiry time.Time
)

type weComTokenResponse struct {
	ErrCode     int    `json:"errcode"`
	ErrMsg      string `json:"errmsg"`
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

type weComUserInfoResponse struct {
	ErrCode        int    `json:"errcode"`
	ErrMsg         string `json:"errmsg"`
	UserId         string `json:"userid"`
	OpenId         string `json:"openid"`
	ExternalUserId string `json:"external_userid"`
	ParentUserId   string `json:"parent_userid"`
}

func getWeComAccessToken(ctx context.Context) (string, error) {
	weComTokenMu.Lock()
	defer weComTokenMu.Unlock()
	if weComTokenValue != "" && time.Now().Before(weComTokenExpiry) {
		return weComTokenValue, nil
	}
	tokenURL := fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=%s&corpsecret=%s",
		url.QueryEscape(common.WeComCorpId), url.QueryEscape(common.WeComSecret))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, tokenURL, nil)
	if err != nil {
		return "", err
	}
	client := http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, common.LogText("[OAuth-WeCom] gettoken error: %s", err.Error()))
		return "", err
	}
	defer res.Body.Close()
	var tokenResponse weComTokenResponse
	if err := common.DecodeJson(res.Body, &tokenResponse); err != nil {
		logger.LogError(ctx, common.LogText("[OAuth-WeCom] gettoken decode error: %s", err.Error()))
		return "", err
	}
	if tokenResponse.ErrCode != 0 || tokenResponse.AccessToken == "" {
		logger.LogError(ctx, common.LogText("[OAuth-WeCom] gettoken failed: errcode=%d, errmsg=%s", tokenResponse.ErrCode, tokenResponse.ErrMsg))
		return "", common.NewMessage("Failed to get the WeCom access token, please check settings")
	}
	ttl := time.Duration(tokenResponse.ExpiresIn) * time.Second
	if ttl <= 0 {
		ttl = 7200 * time.Second
	}
	weComTokenValue = tokenResponse.AccessToken
	weComTokenExpiry = time.Now().Add(ttl - time.Minute)
	return weComTokenValue, nil
}

// getWeComUserIdByCode 用扫码 code 换取企业成员 userid。非企业成员（openid/家校）一律拒绝。
func getWeComUserIdByCode(ctx context.Context, code string) (string, error) {
	if code == "" {
		return "", common.NewMessage("Invalid parameters")
	}
	token, err := getWeComAccessToken(ctx)
	if err != nil {
		return "", err
	}
	userInfoURL := fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=%s&code=%s",
		url.QueryEscape(token), url.QueryEscape(code))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, userInfoURL, nil)
	if err != nil {
		return "", err
	}
	client := http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, common.LogText("[OAuth-WeCom] getuserinfo error: %s", err.Error()))
		return "", err
	}
	defer res.Body.Close()
	var userInfo weComUserInfoResponse
	if err := common.DecodeJson(res.Body, &userInfo); err != nil {
		logger.LogError(ctx, common.LogText("[OAuth-WeCom] getuserinfo decode error: %s", err.Error()))
		return "", err
	}
	if userInfo.ErrCode != 0 {
		logger.LogError(ctx, common.LogText("[OAuth-WeCom] getuserinfo failed: errcode=%d, errmsg=%s", userInfo.ErrCode, userInfo.ErrMsg))
		return "", common.NewMessage("Failed to get the WeCom user information, please check settings")
	}
	if userInfo.UserId == "" {
		logger.LogError(ctx, common.LogText("[OAuth-WeCom] getuserinfo returned no userid (openid=%s, external_userid=%s, parent_userid=%s)",
			userInfo.OpenId, userInfo.ExternalUserId, userInfo.ParentUserId))
		return "", common.NewMessage("Only WeCom enterprise members can sign in, please contact your administrator")
	}
	return userInfo.UserId, nil
}

// WeComAuth 企业微信扫码登录：只有已绑定的账号才能登录，未绑定不自动建号。
func WeComAuth(c *gin.Context) {
	if !common.WeComOAuthEnabled {
		common.ApiErrorT(c, "{{provider}} login and registration has not been enabled by administrator", providerParams("WeCom"))
		return
	}
	code := strings.TrimSpace(c.Query("code"))
	weComUserId, err := getWeComUserIdByCode(c.Request.Context(), code)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	user := model.User{WeComUserId: weComUserId}
	if !model.IsWeComUserIdAlreadyTaken(weComUserId) {
		common.ApiErrorT(c, "This {{provider}} account is not linked to any account yet, please link it from your profile first", providerParams("WeCom"))
		return
	}
	if err := user.FillUserByWeComUserId(); err != nil {
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

type weComBindRequest struct {
	Code string `json:"code"`
}

// WeComBind 绑定企业微信：仅教师及以上（role >= RoleAdminUser）可用，且复用 step-up 安全校验。
func WeComBind(c *gin.Context) {
	identity, ok := middleware.GetStepUpIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return
	}
	succeeded, notificationFailed := false, false
	defer func() {
		recordUserSecurityAudit(c, identity.UserID, "user.binding_bind", map[string]any{"provider": "wecom", "success": succeeded, "notification_failed": notificationFailed})
	}()
	if !common.WeComOAuthEnabled {
		common.ApiErrorT(c, "{{provider}} login and registration has not been enabled by administrator", providerParams("WeCom"))
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
	var req weComBindRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	code := strings.TrimSpace(req.Code)
	context, err := common.Marshal(service.AccountBindingContext{Provider: "wecom", Code: code})
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: context}) == nil {
		return
	}
	weComUserId, err := getWeComUserIdByCode(c.Request.Context(), code)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if model.IsWeComUserIdAlreadyTaken(weComUserId) {
		common.ApiErrorT(c, "This {{provider}} account has already been bound", providerParams("WeCom"))
		return
	}
	// 只更新绑定列，避免完整用户快照覆盖并发的封禁、降权或分组变更。
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		return model.UpdateUserBindColumnForSessionWithTx(tx, identity, "wecom_user_id", weComUserId)
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
	notificationFailed = service.NotifyAccountSecurityChange(service.AccountMailLanguage(c, user.Id), user.Email, i18n.MsgSecurityEventLoginLinked, map[string]any{"Provider": "WeCom"}) != nil
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"notification_warning": notificationFailed},
	})
}
