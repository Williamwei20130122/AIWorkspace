package model

import (
	"sort"
	"time"

	"gorm.io/gorm"
)

// GetWorkspaceClassIdByUserId 返回学生所在班级 id，未绑定班级返回 0。
func GetWorkspaceClassIdByUserId(userId int) int {
	var student WorkspaceStudent
	if err := DB.Where("user_id = ?", userId).First(&student).Error; err != nil {
		return 0
	}
	return student.ClassId
}

// GetWorkspaceUserQuota 查某用户在指定能力上的额度分配。
func GetWorkspaceUserQuota(userId int, capabilityId string) (*WorkspaceUserQuota, error) {
	var quota WorkspaceUserQuota
	err := DB.Where("user_id = ? AND capability_id = ?", userId, capabilityId).First(&quota).Error
	if err != nil {
		return nil, err
	}
	return &quota, nil
}

// IncWorkspaceUserQuotaUsed 成功生成后把该能力的已用量加一。
func IncWorkspaceUserQuotaUsed(userId int, capabilityId string) error {
	return DB.Model(&WorkspaceUserQuota{}).
		Where("user_id = ? AND capability_id = ?", userId, capabilityId).
		UpdateColumn("used", gorm.Expr("used + 1")).Error
}

// WorkspaceUsage 记录每一次成功生成的按次计费明细，是月度对账的原始数据。
// Points 为学生实扣点数；AmountYuan 为按上游单价与实际用量算出的学生消费金额（元）；
// CostYuan 为按定价规则折算的上游成本（元）。
type WorkspaceUsage struct {
	Id           int     `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt    int64   `json:"created_at" gorm:"autoCreateTime;index:idx_ws_usage_created"`
	UserId       int     `json:"user_id" gorm:"index:idx_ws_usage_user"`
	ClassId      int     `json:"class_id" gorm:"index:idx_ws_usage_class"`
	TeacherId    int     `json:"teacher_id" gorm:"index:idx_ws_usage_teacher"`
	CapabilityId string  `json:"capability_id" gorm:"type:varchar(32)"`
	Kind         string  `json:"kind" gorm:"type:varchar(16)"`
	Model        string  `json:"model" gorm:"type:varchar(128)"`
	Units        float64 `json:"units"`
	Points       int     `json:"points"`
	AmountYuan   float64 `json:"amount_yuan"`
	CostYuan     float64 `json:"cost_yuan"`
	Status       string  `json:"status" gorm:"type:varchar(16)"`
	// LessonId 该次生成归属的上课模式课程 id；0 表示非上课模式时段。
	LessonId int `json:"lesson_id" gorm:"index:idx_ws_usage_lesson"`
	// Prompt 学生本次生成提交的提示词（截断保存，供教师实时看板展示）。
	Prompt string `json:"prompt" gorm:"type:varchar(500)"`
	// ResultPreview AI 生成内容的预览（截断保存，供教师实时看板展示）。
	ResultPreview string `json:"result_preview" gorm:"type:varchar(1000)"`
	// RequestId 本次生成的请求 id，与 new-api 的消费日志（logs.request_id）一一对应，
	// 使用记录据此把 new-api 侧的记录与中台的真实扣点、请求/响应内容关联起来。
	RequestId string `json:"request_id" gorm:"type:varchar(64);index"`
	// DurationMs 本次生成的耗时（毫秒），由计费中间件在生成完成后写入。
	DurationMs int `json:"duration_ms"`
}

func (u *WorkspaceUsage) Insert() error {
	return DB.Create(u).Error
}

// WorkspaceUsageQuery 使用记录查询条件。
type WorkspaceUsageQuery struct {
	UserId         int
	ClassId        int
	TeacherId      int
	StartTimestamp int64
	EndTimestamp   int64
}

// WorkspaceUsageAggregateRow 一条聚合结果（按学生或按班级）。
type WorkspaceUsageAggregateRow struct {
	UserId     int     `json:"user_id"`
	ClassId    int     `json:"class_id"`
	Count      int     `json:"count"`
	Points     int     `json:"points"`
	AmountYuan float64 `json:"amount_yuan"`
	CostYuan   float64 `json:"cost_yuan"`
}

// AggregateWorkspaceUsageByUser 按学生（userId）聚合；teacherId > 0 时仅统计该教师名下。
func AggregateWorkspaceUsageByUser(start, end int64, teacherId int) ([]WorkspaceUsageAggregateRow, error) {
	var rows []WorkspaceUsageAggregateRow
	tx := DB.Model(&WorkspaceUsage{}).
		Select("user_id, max(class_id) as class_id, count(*) as count, sum(points) as points, sum(amount_yuan) as amount_yuan, sum(cost_yuan) as cost_yuan").
		Where("created_at >= ? AND created_at < ?", start, end)
	if teacherId > 0 {
		tx = tx.Where("teacher_id = ?", teacherId)
	}
	err := tx.Group("user_id").Scan(&rows).Error
	return rows, err
}

// AggregateWorkspaceUsageByClass 按班级聚合；teacherId > 0 时仅统计该教师名下。
func AggregateWorkspaceUsageByClass(start, end int64, teacherId int) ([]WorkspaceUsageAggregateRow, error) {
	var rows []WorkspaceUsageAggregateRow
	tx := DB.Model(&WorkspaceUsage{}).
		Select("class_id, count(*) as count, sum(points) as points, sum(amount_yuan) as amount_yuan, sum(cost_yuan) as cost_yuan").
		Where("created_at >= ? AND created_at < ?", start, end)
	if teacherId > 0 {
		tx = tx.Where("teacher_id = ?", teacherId)
	}
	err := tx.Group("class_id").Scan(&rows).Error
	return rows, err
}

// AggregateWorkspaceUsageByTeacher 按归属教师聚合（教师留痕与按教师结算）。
func AggregateWorkspaceUsageByTeacher(start, end int64) ([]WorkspaceUsageAggregateRow, error) {
	var rows []WorkspaceUsageAggregateRow
	err := DB.Model(&WorkspaceUsage{}).
		Select("teacher_id as user_id, count(*) as count, sum(points) as points, sum(amount_yuan) as amount_yuan, sum(cost_yuan) as cost_yuan").
		Where("created_at >= ? AND created_at < ?", start, end).
		Group("teacher_id").
		Scan(&rows).Error
	return rows, err
}

// SumWorkspaceUsageAmountByUser 汇总某学生累计消费金额（元），供学生数据看板展示折算金额。
func SumWorkspaceUsageAmountByUser(userId int) (float64, error) {
	var total float64
	err := DB.Model(&WorkspaceUsage{}).
		Select("COALESCE(sum(amount_yuan), 0)").
		Where("user_id = ?", userId).
		Scan(&total).Error
	return total, err
}

// WorkspaceUsageByUserCapability 学情管理：按「学生 × 能力」聚合的一行。
// Breakdown 用于统计每个学生在文生文/文生图/视频等各能力上的次数与点数分布。
type WorkspaceUsageByUserCapability struct {
	UserId       int     `json:"user_id"`
	CapabilityId string  `json:"capability_id"`
	Count        int     `json:"count"`
	Points       int     `json:"points"`
	AmountYuan   float64 `json:"amount_yuan"`
	// LastActiveAt 该学生在该能力上的最近一次生成时间戳。
	LastActiveAt int64 `json:"last_active_at"`
}

// AggregateWorkspaceUsageByUserCapability 按「学生 × 能力」聚合指定时间范围内的生成数据。
// classIds 非空时仅统计这些班级；keyword 命中姓名/拼音/学号时可进一步收窄到指定学生。
func AggregateWorkspaceUsageByUserCapability(start, end int64) ([]WorkspaceUsageByUserCapability, error) {
	var rows []WorkspaceUsageByUserCapability
	err := DB.Model(&WorkspaceUsage{}).
		Select("user_id, capability_id, count(*) as count, sum(points) as points, sum(amount_yuan) as amount_yuan, max(created_at) as last_active_at").
		Where("created_at >= ? AND created_at < ?", start, end).
		Group("user_id, capability_id").
		Scan(&rows).Error
	return rows, err
}

// WorkspaceUsageBucketRow 学习报告时间桶：一段周期（周/月内某天或某周）的聚合。
type WorkspaceUsageBucketRow struct {
	// Bucket 起始时间（unix 秒），按 bucket 粒度对齐（周对齐到周一、月对齐到 1 日、日对齐到 0 点）。
	Bucket      int64   `json:"bucket"`
	CapabilityId string `json:"capability_id"`
	Count       int     `json:"count"`
	Points      int     `json:"points"`
	AmountYuan  float64 `json:"amount_yuan"`
}

// AggregateWorkspaceUsageBuckets 按时间桶 × 能力聚合生成数据（学习报告趋势图）。
// bucketBy 为 "day"（按天）/ "week"（按周一）/ "month"（按 1 日）；
// 分桶在 Go 内完成，兼容 SQLite / PostgreSQL / MySQL 三种数据库。
func AggregateWorkspaceUsageBuckets(start, end int64, bucketBy string, classIds []int) ([]WorkspaceUsageBucketRow, error) {
	type rawRow struct {
		CreatedAt    int64
		CapabilityId string
		Count        int
		Points       int
		AmountYuan   float64
	}
	var raws []rawRow
	tx := DB.Model(&WorkspaceUsage{}).
		Select("created_at, capability_id, count(*) as count, sum(points) as points, sum(amount_yuan) as amount_yuan").
		Where("created_at >= ? AND created_at < ?", start, end)
	if len(classIds) > 0 {
		tx = tx.Where("class_id in (?)", classIds)
	}
	// 按「时间戳 × 能力」在 SQL 内先聚合（同刻同能力合并），桶对齐交给 Go 本地时区逻辑，
	// 避免 SQL 按 UTC 天分组跨本地日/周边界导致的错桶。
	if err := tx.Group("created_at, capability_id").Scan(&raws).Error; err != nil {
		return nil, err
	}
	type key struct {
		bucket int64
		cap    string
	}
	agg := map[key]*WorkspaceUsageBucketRow{}
	order := make([]key, 0, len(raws))
	for _, row := range raws {
		k := key{
			bucket: workspaceUsageBucketStart(row.CreatedAt, bucketBy),
			cap:    row.CapabilityId,
		}
		item := agg[k]
		if item == nil {
			item = &WorkspaceUsageBucketRow{Bucket: k.bucket, CapabilityId: k.cap}
			agg[k] = item
			order = append(order, k)
		}
		item.Count += row.Count
		item.Points += row.Points
		item.AmountYuan += row.AmountYuan
	}
	rows := make([]WorkspaceUsageBucketRow, 0, len(order))
	for _, k := range order {
		rows = append(rows, *agg[k])
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Bucket != rows[j].Bucket {
			return rows[i].Bucket < rows[j].Bucket
		}
		return rows[i].CapabilityId < rows[j].CapabilityId
	})
	return rows, nil
}

// workspaceUsageBucketStart 把时间戳对齐到桶起点（本地时区）：
// day=当天 0 点，week=所在周的周一 0 点，month=当月 1 日 0 点。
func workspaceUsageBucketStart(unix int64, bucketBy string) int64 {
	t := time.Unix(unix, 0).In(time.Local)
	switch bucketBy {
	case "week":
		// Go weekday：0=周日；换算为「距本周一的天数」（周日归上一周）。
		offset := (int(t.Weekday()) + 6) % 7
		day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, -offset)
		return day.Unix()
	case "month":
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.Local).Unix()
	default:
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local).Unix()
	}
}

// ListWorkspaceClassUserIds 列出属于这些班级的全部学生 userId（学习报告完成率用）。
func ListWorkspaceClassUserIds(classIds []int) ([]int, error) {
	ids := make([]int, 0)
	if len(classIds) == 0 {
		return ids, nil
	}
	var students []*WorkspaceStudent
	if err := DB.Where("class_id in (?)", classIds).Find(&students).Error; err != nil {
		return nil, err
	}
	for _, item := range students {
		if item.UserId > 0 {
			ids = append(ids, item.UserId)
		}
	}
	return ids, nil
}

// ListWorkspaceUsages 分页查询使用记录（供对账明细与导出）。
func ListWorkspaceUsages(query WorkspaceUsageQuery, page, pageSize int) ([]*WorkspaceUsage, int64, error) {
	tx := DB.Model(&WorkspaceUsage{})
	if query.UserId > 0 {
		tx = tx.Where("user_id = ?", query.UserId)
	}
	if query.ClassId > 0 {
		tx = tx.Where("class_id = ?", query.ClassId)
	}
	if query.TeacherId > 0 {
		tx = tx.Where("teacher_id = ?", query.TeacherId)
	}
	if query.StartTimestamp > 0 {
		tx = tx.Where("created_at >= ?", query.StartTimestamp)
	}
	if query.EndTimestamp > 0 {
		tx = tx.Where("created_at < ?", query.EndTimestamp)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 50
	}
	var items []*WorkspaceUsage
	err := tx.Order("id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error
	return items, total, err
}

// AllWorkspaceUsages 导出用：不分页拉取指定时间范围内的全部记录。
func AllWorkspaceUsages(query WorkspaceUsageQuery) ([]*WorkspaceUsage, error) {
	tx := DB.Model(&WorkspaceUsage{})
	if query.UserId > 0 {
		tx = tx.Where("user_id = ?", query.UserId)
	}
	if query.ClassId > 0 {
		tx = tx.Where("class_id = ?", query.ClassId)
	}
	if query.TeacherId > 0 {
		tx = tx.Where("teacher_id = ?", query.TeacherId)
	}
	if query.StartTimestamp > 0 {
		tx = tx.Where("created_at >= ?", query.StartTimestamp)
	}
	if query.EndTimestamp > 0 {
		tx = tx.Where("created_at < ?", query.EndTimestamp)
	}
	var items []*WorkspaceUsage
	err := tx.Order("id asc").Find(&items).Error
	return items, err
}

// ListWorkspaceUsagesByRequestIds 按请求 id 批量取计费明细，供使用记录回填真实扣点与生成内容。
func ListWorkspaceUsagesByRequestIds(requestIds []string) ([]*WorkspaceUsage, error) {
	items := make([]*WorkspaceUsage, 0)
	if len(requestIds) == 0 {
		return items, nil
	}
	err := DB.Where("request_id in (?)", requestIds).Find(&items).Error
	return items, err
}

// WorkspaceMonthRange 返回某月（YYYY-MM）的起止时间戳，月格式非法时回落当前月。
func WorkspaceMonthRange(month string) (int64, int64) {
	start, err := time.ParseInLocation("2006-01", month, time.Local)
	if err != nil {
		now := time.Now()
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
	}
	end := start.AddDate(0, 1, 0)
	return start.Unix(), end.Unix()
}

// CurrentWorkspaceMonth 当前月（YYYY-MM）。
func CurrentWorkspaceMonth() string {
	return time.Now().In(time.Local).Format("2006-01")
}
