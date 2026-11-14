package controller

import (
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- 学情管理 ----------
// 按学生聚合指定时间范围内的生成数据：次数、点数、消费金额与各能力分布，
// 帮助教师快速看出谁在用、用得多不多、偏向哪种能力。

type workspaceInsightBreakdown struct {
	CapabilityId string `json:"capability_id"`
	Count        int    `json:"count"`
	Points       int    `json:"points"`
}

type workspaceInsightRow struct {
	UserId       int                         `json:"user_id"`
	StudentId    int                         `json:"student_id"`
	StudentNo    string                      `json:"student_no"`
	DisplayName  string                      `json:"display_name"`
	Username     string                      `json:"username"`
	ClassId      int                         `json:"class_id"`
	ClassName    string                      `json:"class_name"`
	GradeName    string                      `json:"grade_name"`
	Count        int                         `json:"count"`
	Points       int                         `json:"points"`
	AmountYuan   float64                     `json:"amount_yuan"`
	LastActiveAt int64                       `json:"last_active_at"`
	Breakdown    []workspaceInsightBreakdown `json:"breakdown"`
}

type workspaceInsightSummary struct {
	StudentCount int     `json:"student_count"`
	ActiveCount  int     `json:"active_count"`
	Count        int     `json:"count"`
	Points       int     `json:"points"`
	AmountYuan   float64 `json:"amount_yuan"`
}

type workspaceInsightsResult struct {
	Page     int                     `json:"page"`
	PageSize int                     `json:"page_size"`
	Total    int                     `json:"total"`
	Summary  workspaceInsightSummary `json:"summary"`
	Items    []workspaceInsightRow   `json:"items"`
}

// GetWorkspaceInsights 返回学情管理：按学生聚合的生成次数/点数/金额与能力分布。
// 支持 start/end 时间范围、学部/年级/班级级联筛选与学生姓名关键词，带分页。
func GetWorkspaceInsights(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)

	start := parseInt64Query(c, "start")
	end := parseInt64Query(c, "end")
	classId, _ := strconv.Atoi(c.Query("class_id"))
	sectionId, _ := strconv.Atoi(c.Query("section_id"))
	gradeIndex, _ := strconv.Atoi(c.Query("grade_index"))
	keyword := strings.TrimSpace(c.Query("keyword"))
	includeGraduated := c.Query("include_graduated") == "1" || strings.EqualFold(c.Query("include_graduated"), "true")

	// 时间范围缺省：不限制，由前端传入默认区间。
	usageRows, err := model.AggregateWorkspaceUsageByUserCapability(start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// 聚合结果按 user_id 分组。
	type userAgg struct {
		Count      int
		Points     int
		AmountYuan float64
		LastActive int64
		Breakdown  map[string]workspaceInsightBreakdown
	}
	aggByUser := make(map[int]*userAgg, len(usageRows))
	for _, row := range usageRows {
		agg := aggByUser[row.UserId]
		if agg == nil {
			agg = &userAgg{Breakdown: map[string]workspaceInsightBreakdown{}}
			aggByUser[row.UserId] = agg
		}
		agg.Count += row.Count
		agg.Points += row.Points
		agg.AmountYuan += row.AmountYuan
		if row.LastActiveAt > agg.LastActive {
			agg.LastActive = row.LastActiveAt
		}
		item := agg.Breakdown[row.CapabilityId]
		item.CapabilityId = row.CapabilityId
		item.Count += row.Count
		item.Points += row.Points
		agg.Breakdown[row.CapabilityId] = item
	}

	// 基础名单：按筛选条件取学生（含没有任何生成记录的学生，便于发现零使用）。
	status := 0
	if !includeGraduated {
		status = model.WorkspaceStudentStatusActive
	}
	students, err := model.GetWorkspaceStudentsFiltered(classId, status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	classesById := map[int]*model.WorkspaceClass{}
	if sectionId > 0 || gradeIndex > 0 {
		if classes, err := model.GetAllWorkspaceClasses(); err == nil {
			for _, item := range classes {
				classesById[item.Id] = item
			}
		}
	}

	summary := workspaceInsightSummary{}
	items := make([]workspaceInsightRow, 0, len(students))
	for _, student := range students {
		if student.UserId <= 0 {
			continue
		}
		// 学部/年级筛选经由所属班级判定。
		if sectionId > 0 || gradeIndex > 0 {
			class := classesById[student.ClassId]
			if class == nil {
				continue
			}
			if sectionId > 0 && class.SectionId != sectionId {
				continue
			}
			if gradeIndex > 0 && class.GradeIndex != gradeIndex {
				continue
			}
		}
		if keyword != "" {
			like := strings.ToLower(keyword)
			compact := strings.ToLower(strings.Join(strings.Fields(keyword), ""))
			if !strings.Contains(strings.ToLower(student.DisplayName), like) &&
				!strings.Contains(strings.ToLower(student.PinyinUsername), compact) &&
				!strings.Contains(strings.ToLower(student.StudentNo), like) &&
				!strings.Contains(strings.ToLower(student.Username), like) {
				continue
			}
		}

		row := workspaceInsightRow{
			UserId:      student.UserId,
			StudentId:   student.Id,
			StudentNo:   student.StudentNo,
			DisplayName: student.DisplayName,
			Username:    student.Username,
			ClassId:     student.ClassId,
			ClassName:   student.ClassName,
			GradeName:   student.GradeName,
			Breakdown:   []workspaceInsightBreakdown{},
		}
		if agg := aggByUser[student.UserId]; agg != nil {
			row.Count = agg.Count
			row.Points = agg.Points
			row.AmountYuan = agg.AmountYuan
			row.LastActiveAt = agg.LastActive
			for _, item := range agg.Breakdown {
				row.Breakdown = append(row.Breakdown, item)
			}
			sort.Slice(row.Breakdown, func(i, j int) bool {
				return row.Breakdown[i].Count > row.Breakdown[j].Count
			})
		}
		summary.StudentCount++
		if row.Count > 0 {
			summary.ActiveCount++
		}
		summary.Count += row.Count
		summary.Points += row.Points
		summary.AmountYuan += row.AmountYuan
		items = append(items, row)
	}

	// 活跃度排序：生成次数多的靠前，其次点数，最后按姓名。
	sort.Slice(items, func(i, j int) bool {
		if items[i].Count != items[j].Count {
			return items[i].Count > items[j].Count
		}
		if items[i].Points != items[j].Points {
			return items[i].Points > items[j].Points
		}
		return items[i].StudentNo < items[j].StudentNo
	})

	page := pageInfo.Page
	pageSize := pageInfo.PageSize
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 20
	}
	total := len(items)
	from := (page - 1) * pageSize
	if from > total {
		from = total
	}
	to := from + pageSize
	if to > total {
		to = total
	}

	common.ApiSuccess(c, workspaceInsightsResult{
		Page:     page,
		PageSize: pageSize,
		Total:    total,
		Summary:  summary,
		Items:    items[from:to],
	})
}

// parseInt64Query 解析查询串里的 int64（unix 秒），非法值按 0 处理。
func parseInt64Query(c *gin.Context, key string) int64 {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return 0
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0
	}
	return value
}
