package controller

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- 周 / 月维度学习报告 ----------
// 按班级生成三类数据：能力使用（次数/点数按时间桶的趋势）、课堂完成率、点数消耗趋势。

type workspaceReportBucket struct {
	Bucket int64 `json:"bucket"`
	Count  int   `json:"count"`
	Points int   `json:"points"`
}

type workspaceReportCapability struct {
	CapabilityId string                 `json:"capability_id"`
	Total        int                    `json:"total"`
	Points       int                    `json:"points"`
	Trend        []workspaceReportBucket `json:"trend"`
}

type workspaceReportCompletionClass struct {
	ClassId       int     `json:"class_id"`
	ClassName     string  `json:"class_name"`
	StudentCount  int     `json:"student_count"`
	ActiveCount   int     `json:"active_count"`
	SubmitCount   int     `json:"submit_count"`
	CompletionPct float64 `json:"completion_pct"`
}

type workspaceReportResult struct {
	ClassId     int                           `json:"class_id"`
	ClassName   string                        `json:"class_name"`
	RangeStart  int64                         `json:"range_start"`
	RangeEnd    int64                         `json:"range_end"`
	BucketBy    string                        `json:"bucket_by"`
	Summary     gin.H                         `json:"summary"`
	Capabilities []workspaceReportCapability  `json:"capabilities"`
	PointsTrend []workspaceReportBucket       `json:"points_trend"`
	Completion  []workspaceReportCompletionClass `json:"completion"`
}

// GetWorkspaceReport 返回学习报告：能力使用 / 完成率 / 点数消耗趋势。
// 参数：class_id（必填班级）、start / end（unix 秒）、bucket_by=day|week|month。
func GetWorkspaceReport(c *gin.Context) {
	classId, _ := strconv.Atoi(c.Query("class_id"))
	if classId <= 0 {
		common.ApiErrorMsg(c, "请选择班级")
		return
	}
	class, err := model.GetWorkspaceClassById(classId)
	if err != nil {
		common.ApiErrorMsg(c, "班级不存在")
		return
	}
	start := parseInt64Query(c, "start")
	end := parseInt64Query(c, "end")
	if start <= 0 || end <= start {
		// 默认近 30 天。
		now := time.Now()
		end = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, 1).Unix()
		start = end - 30*86400
	}
	bucketBy := strings.TrimSpace(c.Query("bucket_by"))
	if bucketBy != "week" && bucketBy != "month" {
		bucketBy = "day"
	}

	// 能力使用与点数趋势：按班级过滤的区间聚合。
	usageRows, err := model.AggregateWorkspaceUsageBuckets(start, end, bucketBy, []int{classId})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	byCapability := map[string]*workspaceReportCapability{}
	bucketSet := map[int64]bool{}
	totalCount, totalPoints := 0, 0
	var totalAmount float64
	for _, row := range usageRows {
		item := byCapability[row.CapabilityId]
		if item == nil {
			item = &workspaceReportCapability{CapabilityId: row.CapabilityId, Trend: []workspaceReportBucket{}}
			byCapability[row.CapabilityId] = item
		}
		item.Total += row.Count
		item.Points += row.Points
		item.Trend = append(item.Trend, workspaceReportBucket{
			Bucket: row.Bucket,
			Count:  row.Count,
			Points: row.Points,
		})
		bucketSet[row.Bucket] = true
		totalCount += row.Count
		totalPoints += row.Points
		totalAmount += row.AmountYuan
	}
	// 补齐全部时间桶（无数据的桶为 0），前端画趋势线不需要二次补零。
	buckets := make([]int64, 0, len(bucketSet))
	for b := startBucket(start, bucketBy); b < end; b = nextBucket(b, bucketBy) {
		buckets = append(buckets, b)
	}
	for _, item := range byCapability {
		filled := make([]workspaceReportBucket, 0, len(buckets))
		trendByBucket := map[int64]workspaceReportBucket{}
		for _, point := range item.Trend {
			trendByBucket[point.Bucket] = point
		}
		for _, b := range buckets {
			if point, ok := trendByBucket[b]; ok {
				filled = append(filled, point)
			} else {
				filled = append(filled, workspaceReportBucket{Bucket: b})
			}
		}
		item.Trend = filled
	}
	capabilities := make([]workspaceReportCapability, 0, len(byCapability))
	for _, item := range byCapability {
		capabilities = append(capabilities, *item)
	}
	// 按总次数降序，便于一眼看出班级主要使用的能力。
	sort.Slice(capabilities, func(i, j int) bool {
		return capabilities[i].Total > capabilities[j].Total
	})
	pointsTrend := make([]workspaceReportBucket, 0, len(buckets))
	// 各桶点数合计：由能力维度回卷。
	pointsByBucket := map[int64]int{}
	for _, row := range usageRows {
		pointsByBucket[row.Bucket] += row.Points
	}
	for _, b := range buckets {
		pointsTrend = append(pointsTrend, workspaceReportBucket{Bucket: b, Points: pointsByBucket[b]})
	}

	// 完成率：区间内有任意提交的学生 / 班级在读学生数。
	completion := []workspaceReportCompletionClass{}
	studentIds, err := model.ListWorkspaceClassUserIds([]int{classId})
	if err == nil {
		activeSet := map[int]bool{}
		submitCount := 0
		if submissions, err := model.ListWorkspaceTaskSubmissionsInRange(start, end, studentIds); err == nil {
			for _, item := range submissions {
				activeSet[item.UserId] = true
				submitCount++
			}
		}
		row := workspaceReportCompletionClass{
			ClassId:      class.Id,
			ClassName:    class.Name,
			StudentCount: len(studentIds),
			ActiveCount:  len(activeSet),
			SubmitCount:  submitCount,
		}
		if row.StudentCount > 0 {
			row.CompletionPct = float64(row.ActiveCount) / float64(row.StudentCount) * 100
		}
		completion = append(completion, row)
	}

	common.ApiSuccess(c, workspaceReportResult{
		ClassId:      class.Id,
		ClassName:    class.Name,
		RangeStart:   start,
		RangeEnd:     end,
		BucketBy:     bucketBy,
		Summary: gin.H{
			"student_count": len(studentIds),
			"count":         totalCount,
			"points":        totalPoints,
			"amount_yuan":   totalAmount,
		},
		Capabilities: capabilities,
		PointsTrend:  pointsTrend,
		Completion:   completion,
	})
}

// startBucket 把区间起点对齐到桶起点。
func startBucket(unix int64, bucketBy string) int64 {
	t := time.Unix(unix, 0).In(time.Local)
	switch bucketBy {
	case "week":
		offset := (int(t.Weekday()) + 6) % 7
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, -offset).Unix()
	case "month":
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.Local).Unix()
	default:
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local).Unix()
	}
}

// nextBucket 返回下一个桶起点。
func nextBucket(unix int64, bucketBy string) int64 {
	t := time.Unix(unix, 0).In(time.Local)
	switch bucketBy {
	case "week":
		return t.AddDate(0, 0, 7).Unix()
	case "month":
		return time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, time.Local).Unix()
	default:
		return t.AddDate(0, 0, 1).Unix()
	}
}
