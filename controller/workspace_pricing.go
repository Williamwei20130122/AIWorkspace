package controller

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// workspaceExistingModelNames 返回「仍然可用」的具体模型名集合。
// 除模型管理中以精确名称登记的模型外，渠道里已启用的真实模型
// （abilities 表，如联调配置的测试模型）同样算存在，否则其能力声明
// 会被管理端接口误过滤，导致生成下拉中选不到该模型。
// 用于过滤能力声明与计价配置：模型被删除后其残留配置不再出现在管理端列表。
// 返回 nil 表示查询失败，调用方应按「不过滤」处理，避免异常时清空合法配置。
func workspaceExistingModelNames() map[string]struct{} {
	rows, _, err := model.SearchModelsWithChannels("", "", "", "", 0, -1)
	if err != nil {
		common.SysError("list existing models failed: " + err.Error())
		return nil
	}
	names := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		if row == nil || row.NameRule != model.NameRuleExact {
			continue
		}
		names[row.ModelName] = struct{}{}
	}
	// 渠道中实际启用的模型：前缀匹配规则登记的模型与仅在渠道里配置的测试模型
	// 都在 abilities 中有精确名称，这里一并并入，保证可正常声明能力并被下拉选中。
	for _, name := range model.GetEnabledModels() {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		names[name] = struct{}{}
	}
	// 用户显式删除过的模型（模型管理软删除记录）即使仍残留在渠道中也不再算存在：
	// 删除时若未勾选「从渠道移除」，abilities 仍会命中，导致已删除模型继续出现在
	// 学生端/教师端的生成下拉里。同名模型删除后又重建（存在存活行）时不受影响；
	// 查询失败时跳过排除（保守保留），避免误伤可用模型。
	var liveNames, deletedNames []string
	if err := model.DB.Unscoped().Model(&model.Model{}).Where("deleted_at IS NULL").Pluck("model_name", &liveNames).Error; err != nil {
		common.SysError("list live models failed: " + err.Error())
	} else if err := model.DB.Unscoped().Model(&model.Model{}).Where("deleted_at IS NOT NULL").Pluck("model_name", &deletedNames).Error; err != nil {
		common.SysError("list deleted models failed: " + err.Error())
	} else {
		live := make(map[string]struct{}, len(liveNames))
		for _, name := range liveNames {
			live[strings.TrimSpace(name)] = struct{}{}
		}
		for _, name := range deletedNames {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			if _, ok := live[name]; ok {
				continue
			}
			delete(names, name)
		}
	}
	return names
}

// filterExistingModelPricing 只保留模型仍存在的计价项。
func filterExistingModelPricing(models []setting.WorkspaceModelPricing) []setting.WorkspaceModelPricing {
	exist := workspaceExistingModelNames()
	if exist == nil {
		return models
	}
	kept := make([]setting.WorkspaceModelPricing, 0, len(models))
	for _, item := range models {
		if _, ok := exist[item.Model]; ok {
			kept = append(kept, item)
		}
	}
	return kept
}

// PruneStaleWorkspaceModelConfig 清理能力声明与计价配置里「模型已删除」的残留项。
// 服务启动时执行一次，历史删除留下的配置不会再出现在下拉与配置列表中。
// 返回清理掉的模型数量；模型表查询失败时不做任何处理，避免误删合法配置。
func PruneStaleWorkspaceModelConfig() (int, error) {
	exist := workspaceExistingModelNames()
	if exist == nil {
		return 0, nil
	}
	stale := make(map[string]struct{})
	for _, item := range setting.GetWorkspaceModelCapabilities() {
		if _, ok := exist[item.Model]; !ok {
			stale[item.Model] = struct{}{}
		}
	}
	for _, item := range setting.GetWorkspacePricing().Models {
		if _, ok := exist[item.Model]; !ok {
			stale[item.Model] = struct{}{}
		}
	}
	if len(stale) == 0 {
		return 0, nil
	}
	names := make([]string, 0, len(stale))
	for name := range stale {
		names = append(names, name)
	}
	encodedCaps, err := setting.RemoveWorkspaceModelCapabilities(names)
	if err != nil {
		return 0, err
	}
	if err := model.UpdateOption(setting.WorkspaceModelCapabilitiesKey, encodedCaps); err != nil {
		return 0, err
	}
	encodedPricing, err := setting.RemoveWorkspaceModelPricing(names)
	if err != nil {
		return 0, err
	}
	if encodedPricing != "" {
		if err := model.UpdateOption(setting.WorkspacePricingKey, encodedPricing); err != nil {
			return 0, err
		}
	}
	return len(names), nil
}

// workspacePricingModelRow 计价项附带由模型倍率自动换算出的上游单价。
type workspacePricingModelRow struct {
	setting.WorkspaceModelPricing
	Auto setting.WorkspaceAutoPricing `json:"auto_pricing"`
}

// workspacePricingPayload 定价规则接口的统一返回体。
func workspacePricingPayload() gin.H {
	cfg := setting.GetWorkspacePricing()
	filtered := filterExistingModelPricing(cfg.Models)
	rows := make([]workspacePricingModelRow, 0, len(filtered))
	for _, item := range filtered {
		rows = append(rows, workspacePricingModelRow{
			WorkspaceModelPricing: item,
			Auto:                  setting.WorkspaceAutoPricingFor(item.Kind, item.Model),
		})
	}
	return gin.H{
		"kinds":         cfg.Kinds,
		"models":        rows,
		"unit_options":  setting.WorkspaceUnitOptions(),
		"platform_name": setting.GetWorkspacePlatformName(),
		// HTML 实验室默认思考强度（空串表示跟随模型默认）。
		"html_thinking_effort": setting.GetWorkspaceHtmlThinkingEffort(),
		// 演示实验室默认思考强度（空串表示跟随模型默认）。
		"slide_thinking_effort":   setting.GetWorkspaceSlideThinkingEffort(),
		"thinking_effort_options": setting.WorkspaceThinkingEffortOptions(),
	}
}

// GetWorkspacePricingAdmin 返回定价规则（能力点数 + 各模型折算金额/计价单位/上游单价）与平台名称。
func GetWorkspacePricingAdmin(c *gin.Context) {
	common.ApiSuccess(c, workspacePricingPayload())
}

// UpdateWorkspacePricingAdmin 保存定价规则与平台名称。
func UpdateWorkspacePricingAdmin(c *gin.Context) {
	var request struct {
		Kinds               []setting.WorkspaceCapabilityCost `json:"kinds"`
		Models              []setting.WorkspaceModelPricing   `json:"models"`
		PlatformName        *string                           `json:"platform_name"`
		HtmlThinkingEffort  *string                           `json:"html_thinking_effort"`
		SlideThinkingEffort *string                           `json:"slide_thinking_effort"`
	}
	if err := common.UnmarshalBodyReusable(c, &request); err != nil {
		common.ApiError(c, err)
		return
	}
	encoded, err := setting.NormalizeWorkspacePricing(setting.WorkspacePricingConfig{
		Kinds:  request.Kinds,
		Models: request.Models,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOption(setting.WorkspacePricingKey, encoded); err != nil {
		common.ApiError(c, err)
		return
	}
	if request.PlatformName != nil {
		name, err := setting.NormalizeWorkspacePlatformName(*request.PlatformName)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if err := model.UpdateOption(setting.WorkspacePlatformNameKey, name); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if request.HtmlThinkingEffort != nil {
		effort := setting.NormalizeWorkspaceThinkingEffort(*request.HtmlThinkingEffort)
		if err := model.UpdateOption(setting.WorkspaceHtmlThinkingEffortKey, effort); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if request.SlideThinkingEffort != nil {
		effort := setting.NormalizeWorkspaceThinkingEffort(*request.SlideThinkingEffort)
		if err := model.UpdateOption(setting.WorkspaceSlideThinkingEffortKey, effort); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	common.ApiSuccess(c, workspacePricingPayload())
}

// ---------- 月度对账 ----------

type reconcileUserRow struct {
	UserId     int     `json:"user_id"`
	Username   string  `json:"username"`
	ClassId    int     `json:"class_id"`
	ClassName  string  `json:"class_name"`
	Count      int     `json:"count"`
	Points     int     `json:"points"`
	AmountYuan float64 `json:"amount_yuan"`
	CostYuan   float64 `json:"cost_yuan"`
}

type reconcileClassRow struct {
	ClassId    int     `json:"class_id"`
	ClassName  string  `json:"class_name"`
	Count      int     `json:"count"`
	Points     int     `json:"points"`
	AmountYuan float64 `json:"amount_yuan"`
	CostYuan   float64 `json:"cost_yuan"`
}

type reconcileTotal struct {
	Count      int     `json:"count"`
	Points     int     `json:"points"`
	AmountYuan float64 `json:"amount_yuan"`
	CostYuan   float64 `json:"cost_yuan"`
	DiffYuan   float64 `json:"diff_yuan"`
}

type reconcileTeacherRow struct {
	TeacherId   int     `json:"teacher_id"`
	TeacherName string  `json:"teacher_name"`
	Count       int     `json:"count"`
	Points      int     `json:"points"`
	AmountYuan  float64 `json:"amount_yuan"`
	CostYuan    float64 `json:"cost_yuan"`
}

// workspaceReconciliation 月度对账结果。
type workspaceReconciliation struct {
	Month          string                `json:"month"`
	StartTimestamp int64                 `json:"start_timestamp"`
	EndTimestamp   int64                 `json:"end_timestamp"`
	Total          reconcileTotal        `json:"total"`
	ByUser         []reconcileUserRow    `json:"by_user"`
	ByClass        []reconcileClassRow   `json:"by_class"`
	ByTeacher      []reconcileTeacherRow `json:"by_teacher"`
}

// buildWorkspaceReconciliation 汇总指定时间范围内的按次计费数据。
// teacherId > 0 时只统计该教师名下的班级/学生（教师端查看自己的结算）。
func buildWorkspaceReconciliation(month string, teacherId int) (*workspaceReconciliation, error) {
	var start, end int64
	if strings.TrimSpace(month) == "" {
		month = model.CurrentWorkspaceMonth()
	}
	start, end = model.WorkspaceMonthRange(month)
	// 月格式非法时上面已回落当前月，这里统一以解析结果回写月份，避免回显非法入参。
	month = time.Unix(start, 0).In(time.Local).Format("2006-01")

	classNames := map[int]string{}
	if classes, err := model.GetAllWorkspaceClasses(); err == nil {
		for _, class := range classes {
			classNames[class.Id] = class.Name
		}
	}

	userAgg, err := model.AggregateWorkspaceUsageByUser(start, end, teacherId)
	if err != nil {
		return nil, err
	}
	classAgg, err := model.AggregateWorkspaceUsageByClass(start, end, teacherId)
	if err != nil {
		return nil, err
	}
	teacherAgg, err := model.AggregateWorkspaceUsageByTeacher(start, end)
	if err != nil {
		return nil, err
	}

	users := make([]reconcileUserRow, 0, len(userAgg))
	total := reconcileTotal{}
	for _, row := range userAgg {
		username, _ := model.GetUsernameById(row.UserId, false)
		users = append(users, reconcileUserRow{
			UserId:     row.UserId,
			Username:   username,
			ClassId:    row.ClassId,
			ClassName:  workspaceClassName(classNames, row.ClassId),
			Count:      row.Count,
			Points:     row.Points,
			AmountYuan: row.AmountYuan,
			CostYuan:   row.CostYuan,
		})
		total.Count += row.Count
		total.Points += row.Points
		total.AmountYuan += row.AmountYuan
		total.CostYuan += row.CostYuan
	}
	sort.Slice(users, func(i, j int) bool {
		if users[i].Points == users[j].Points {
			return users[i].UserId < users[j].UserId
		}
		return users[i].Points > users[j].Points
	})

	classes := make([]reconcileClassRow, 0, len(classAgg))
	for _, row := range classAgg {
		classes = append(classes, reconcileClassRow{
			ClassId:    row.ClassId,
			ClassName:  workspaceClassName(classNames, row.ClassId),
			Count:      row.Count,
			Points:     row.Points,
			AmountYuan: row.AmountYuan,
			CostYuan:   row.CostYuan,
		})
	}
	sort.Slice(classes, func(i, j int) bool { return classes[i].CostYuan > classes[j].CostYuan })

	teachers := make([]reconcileTeacherRow, 0, len(teacherAgg))
	for _, row := range teacherAgg {
		if row.UserId <= 0 {
			continue
		}
		username, _ := model.GetUsernameById(row.UserId, false)
		teachers = append(teachers, reconcileTeacherRow{
			TeacherId:   row.UserId,
			TeacherName: username,
			Count:       row.Count,
			Points:      row.Points,
			AmountYuan:  row.AmountYuan,
			CostYuan:    row.CostYuan,
		})
	}
	sort.Slice(teachers, func(i, j int) bool {
		if teachers[i].Points == teachers[j].Points {
			return teachers[i].TeacherId < teachers[j].TeacherId
		}
		return teachers[i].Points > teachers[j].Points
	})

	total.DiffYuan = total.CostYuan - total.AmountYuan

	return &workspaceReconciliation{
		Month:          month,
		StartTimestamp: start,
		EndTimestamp:   end,
		Total:          total,
		ByUser:         users,
		ByClass:        classes,
		ByTeacher:      teachers,
	}, nil
}

// GetWorkspaceReconciliation 月度对账看板：按学生 / 按班级 / 按教师 / 总额 vs 上游成本。
// 全部教师均可查看全站对账数据。
func GetWorkspaceReconciliation(c *gin.Context) {
	data, err := buildWorkspaceReconciliation(c.Query("month"), 0)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}

// ExportWorkspaceReconciliation 导出对账明细 CSV。
func ExportWorkspaceReconciliation(c *gin.Context) {
	month := c.Query("month")
	if strings.TrimSpace(month) == "" {
		month = model.CurrentWorkspaceMonth()
	}
	start, end := model.WorkspaceMonthRange(month)
	month = time.Unix(start, 0).In(time.Local).Format("2006-01")
	report, err := buildWorkspaceReconciliation(month, 0)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	usages, err := model.AllWorkspaceUsages(model.WorkspaceUsageQuery{
		StartTimestamp: start,
		EndTimestamp:   end,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}

	var builder strings.Builder
	builder.WriteString("\xEF\xBB\xBF") // BOM，便于 Excel 正确识别 UTF-8
	builder.WriteString("月份,时间,学生,班级,能力,模型,计量数量,消耗点数,学生折算金额(元),上游成本(元)\n")

	classNames := map[int]string{}
	if classes, err := model.GetAllWorkspaceClasses(); err == nil {
		for _, class := range classes {
			classNames[class.Id] = class.Name
		}
	}
	for _, usage := range usages {
		username, _ := model.GetUsernameById(usage.UserId, false)
		className := workspaceClassName(classNames, usage.ClassId)
		createdAt := time.Unix(usage.CreatedAt, 0).In(time.Local).Format("2006-01-02 15:04:05")
		builder.WriteString(fmt.Sprintf("%s,%s,%s,%s,%s,%s,%s,%d,%.4f,%.4f\n",
			month,
			createdAt,
			csvField(username),
			csvField(className),
			csvField(usage.CapabilityId),
			csvField(usage.Model),
			strconv.FormatFloat(usage.Units, 'f', -1, 64),
			usage.Points,
			usage.AmountYuan,
			usage.CostYuan,
		))
	}

	builder.WriteString("\n汇总,,,,,,,,\n")
	builder.WriteString(fmt.Sprintf("总消耗点数,%d\n", report.Total.Points))
	builder.WriteString(fmt.Sprintf("学生折算总额(元),%.4f\n", report.Total.AmountYuan))
	builder.WriteString(fmt.Sprintf("上游成本总额(元),%.4f\n", report.Total.CostYuan))
	builder.WriteString(fmt.Sprintf("差额(元),%.4f\n", report.Total.DiffYuan))

	filename := fmt.Sprintf("workspace-reconcile-%s.csv", month)
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
	c.String(200, builder.String())
}

// workspaceClassName 解析班级名称；未绑定班级显示「未分班」，班级已删除时回落到 id。
func workspaceClassName(classNames map[int]string, classId int) string {
	if name := classNames[classId]; name != "" {
		return name
	}
	if classId == 0 {
		return "未分班"
	}
	return fmt.Sprintf("班级#%d", classId)
}

// csvField 对含逗号/引号的字段做最小转义。
func csvField(value string) string {
	if strings.ContainsAny(value, ",\"\n") {
		return "\"" + strings.ReplaceAll(value, "\"", "\"\"") + "\""
	}
	return value
}
