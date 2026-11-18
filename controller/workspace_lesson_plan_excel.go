package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/xuri/excelize/v2"
)

// AI Workspace 备课模式的 Excel 批量导入模板与解析。
//
// 单工作表「备课」，每行一个分项任务；单元 / 课时 / 任务列留空表示
// 「沿用上一行」，便于用一张表描述整棵 年级 → 单元 → 课时 → 任务 树：
//   - 学部（代码或名称）、年级（年级名或序号，如 一年级 / 1）
//   - 单元名称、单元说明（可选）
//   - 课时标题、课时说明（可选）、是否AI课程（是/否）
//   - 任务标题、任务要求（可选）、产出形式（大段文字/文件上传/AI作品，多个用；分隔）
//   - 允许后缀（可选，如 py,html）、上传上限（可选）、排序（可选）
//
// 单元 / 课时 / 任务按名称匹配：已存在则更新，不存在则创建，重复导入幂等。

const wsExcelLessonSheet = "备课"
const wsExcelLessonFile = "workspace-lesson-import-template.xlsx"

var wsExcelLessonHeader = []string{
	"学部（代码或名称）", "年级（年级名或序号）",
	"单元名称", "单元说明（可选）",
	"课时标题", "课时说明（可选）", "是否AI课程（是/否）",
	"任务标题", "任务要求（可选）", "产出形式（大段文字/文件上传/AI作品，多个用；分隔）",
	"允许后缀（可选）", "上传上限（可选）", "排序（可选）",
}

// DownloadWorkspaceLessonTemplate 下载备课批量导入的示例 Excel 模板。
func DownloadWorkspaceLessonTemplate(c *gin.Context) {
	file := excelize.NewFile()
	if err := file.SetSheetName("Sheet1", wsExcelLessonSheet); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := writeWorkspaceExcelRow(file, wsExcelLessonSheet, 1, wsExcelLessonHeader); err != nil {
		common.ApiError(c, err)
		return
	}
	samples := [][]string{
		{"P", "1年级", "第一单元 图像初识", "认识图像生成的基本流程", "第1课时 体验文生图", "用一句话生成一张图", "是",
			"提交生成的图片", "把满意的作品截图或下载后提交", "AI作品", "", "1", "1"},
		{"", "", "", "", "", "", "", "记录提示词心得", "写下你使用过的 3 条有效提示词", "大段文字", "", "1", "2"},
		{"", "", "", "", "第2课时 提示词进阶", "学习提示词结构", "是",
			"上传提示词作业", "按模板填写并上传", "文件上传", "docx,pdf", "2", "1"},
	}
	for i, row := range samples {
		if err := writeWorkspaceExcelRow(file, wsExcelLessonSheet, i+2, row); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	buf, err := file.WriteToBuffer()
	_ = file.Close()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.Header("Content-Disposition", "attachment; filename="+wsExcelLessonFile)
	c.Data(http.StatusOK,
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		buf.Bytes())
}

// wsExcelLessonRow 「备课」工作表的一行。
type wsExcelLessonRow struct {
	Row         string
	SectionRef  string
	GradeRef    string
	UnitName    string
	UnitDesc    string
	LessonTitle string
	LessonDesc  string
	AiCourse    *bool
	TaskTitle   string
	Requirement string
	OutputForms string
	Extensions  string
	MaxUploads  *int
	SortOrder   *int
}

// ImportWorkspaceLessonPlans 解析上传的 Excel，按名称幂等批量创建/更新单元、课时与分项任务。
func ImportWorkspaceLessonPlans(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		common.ApiError(c, common.NewMessage("请上传 Excel 文件"))
		return
	}
	source, err := fileHeader.Open()
	if err != nil {
		common.ApiError(c, common.NewMessage("读取上传文件失败"))
		return
	}
	defer func() { _ = source.Close() }()

	book, err := excelize.OpenReader(source)
	if err != nil {
		common.ApiError(c, common.NewMessage("无法解析 Excel 文件，请使用模板填写"))
		return
	}
	defer func() { _ = book.Close() }()

	rows, failures := parseWsExcelLessons(book)
	if len(rows) == 0 {
		common.ApiError(c, common.NewMessage("Excel 中没有可导入的数据，请确认含「备课」工作表"))
		return
	}

	// 学部索引：代码 / 名称都能命中。
	sections, err := model.AllWorkspaceSections()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	sectionByRef := make(map[string]*model.WorkspaceSection, len(sections)*2)
	for _, section := range sections {
		sectionByRef[strings.ToUpper(strings.TrimSpace(section.Code))] = section
		sectionByRef[wsNormalizeClassName(section.Name)] = section
	}
	// 年级解析：支持序号（1）与年级名（一年级 / 高一 等，含归一化匹配）。
	resolveGrade := func(section *model.WorkspaceSection, ref string) (int, bool) {
		ref = strings.TrimSpace(ref)
		if ref == "" || section == nil {
			return 0, false
		}
		if idx, err := strconv.Atoi(ref); err == nil {
			if idx >= 1 && idx <= section.Years {
				return idx, true
			}
			return 0, false
		}
		for i := 1; i <= section.Years; i++ {
			name := model.WorkspaceSectionGradeName(section, i)
			if wsNormalizeClassName(name) == wsNormalizeClassName(ref) {
				return i, true
			}
		}
		// 兜底：数字开头（如「3年级」）按序号解析。
		digits := strings.TrimLeft(ref, "0123456789")
		if digits != ref {
			if idx, err := strconv.Atoi(strings.TrimSpace(ref[:len(ref)-len(digits)])); err == nil {
				if idx >= 1 && idx <= section.Years {
					return idx, true
				}
			}
		}
		return 0, false
	}
	// 产出形式归一化：中文别名 → 内部值。
	normalizeForms := func(raw string) string {
		mapping := map[string]string{
			"大段文字": model.WorkspaceTaskOutputText,
			"文字":   model.WorkspaceTaskOutputText,
			"文本":   model.WorkspaceTaskOutputText,
			"text": model.WorkspaceTaskOutputText,
			"文件上传": model.WorkspaceTaskOutputFile,
			"文件":   model.WorkspaceTaskOutputFile,
			"上传":   model.WorkspaceTaskOutputFile,
			"file": model.WorkspaceTaskOutputFile,
			"ai作品": model.WorkspaceTaskOutputAI,
			"ai":   model.WorkspaceTaskOutputAI,
		}
		parts := make([]string, 0, 3)
		for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
			return r == '；' || r == ';' || r == '、' || r == ','
		}) {
			key := strings.ToLower(strings.TrimSpace(part))
			if value, ok := mapping[key]; ok {
				parts = append(parts, value)
			}
		}
		return model.NormalizeWorkspaceTaskOutputForms(strings.Join(parts, ","))
	}

	createdUnits, updatedUnits := 0, 0
	createdLessons, updatedLessons := 0, 0
	createdTasks, updatedTasks := 0, 0

	type lessonCtx struct {
		id    *int
		title string
	}
	var lastSection *model.WorkspaceSection
	lastGrade := 0
	lastUnitId := 0
	var lastLesson *lessonCtx

	for _, row := range rows {
		label := row.Row
		// 学部：留空沿用上一行。
		if strings.TrimSpace(row.SectionRef) != "" || lastSection == nil {
			section := sectionByRef[strings.ToUpper(strings.TrimSpace(row.SectionRef))]
			if section == nil {
				section = sectionByRef[wsNormalizeClassName(row.SectionRef)]
			}
			if section == nil {
				failures = append(failures, wsExcelFailure{
					Row:    label,
					Reason: "学部「" + row.SectionRef + "」不存在，请先在学部管理中配置",
				})
				continue
			}
			lastSection = section
			lastGrade = 0
		}
		// 年级：留空沿用上一行。
		if strings.TrimSpace(row.GradeRef) != "" || lastGrade == 0 {
			grade, ok := resolveGrade(lastSection, row.GradeRef)
			if !ok {
				failures = append(failures, wsExcelFailure{
					Row:    label,
					Reason: "年级「" + row.GradeRef + "」无法解析，请填写如 一年级 / 1 的年级名或序号",
				})
				continue
			}
			lastGrade = grade
			// 年级变化后单元归属随之变化。
			if lastUnitId > 0 && strings.TrimSpace(row.UnitName) == "" {
				failures = append(failures, wsExcelFailure{Row: label, Reason: "年级变更后请重新填写「单元名称」"})
				continue
			}
		}
		// 单元：留空沿用上一行。
		unitName := wsNormalizeCell(row.UnitName)
		if unitName == "" {
			if lastUnitId <= 0 {
				failures = append(failures, wsExcelFailure{Row: label, Reason: "缺少「单元名称」且无上一行可沿用"})
				continue
			}
		} else {
			// 按（学部 + 年级 + 名称）匹配已有单元。
			var unit *model.WorkspaceUnit
			if plans, err := model.GetWorkspaceLessonPlans(lastSection.Id, lastGrade); err == nil {
				for _, item := range plans {
					if wsNormalizeClassName(item.Name) == wsNormalizeClassName(unitName) {
						unit = item
						break
					}
				}
			}
			if unit != nil {
				if desc := strings.TrimSpace(row.UnitDesc); desc != "" && desc != unit.Description {
					unit.Description = desc
					if err := unit.Update(); err == nil {
						updatedUnits++
					}
				}
				lastUnitId = unit.Id
			} else {
				unit = &model.WorkspaceUnit{
					SectionId:   lastSection.Id,
					GradeIndex:  lastGrade,
					Name:        unitName,
					Description: strings.TrimSpace(row.UnitDesc),
					SortOrder:   1,
				}
				if err := unit.Insert(); err != nil {
					failures = append(failures, wsExcelFailure{Row: label, Reason: "单元创建失败：" + err.Error()})
					continue
				}
				createdUnits++
				lastUnitId = unit.Id
			}
			lastLesson = nil
		}
		// 课时：留空沿用上一行。
		lessonTitle := wsNormalizeCell(row.LessonTitle)
		if lessonTitle == "" {
			if lastLesson == nil {
				failures = append(failures, wsExcelFailure{Row: label, Reason: "缺少「课时标题」且无上一行可沿用"})
				continue
			}
		} else {
			var lesson *model.WorkspaceLesson
			if plans, err := model.GetWorkspaceLessonPlans(lastSection.Id, lastGrade); err == nil {
				for _, unit := range plans {
					if unit.Id != lastUnitId {
						continue
					}
					for _, item := range unit.Lessons {
						if wsNormalizeClassName(item.Title) == wsNormalizeClassName(lessonTitle) {
							lesson = item
							break
						}
					}
				}
			}
			if lesson != nil {
				changed := false
				if desc := strings.TrimSpace(row.LessonDesc); desc != "" && desc != lesson.Description {
					lesson.Description = desc
					changed = true
				}
				if row.AiCourse != nil && *row.AiCourse != lesson.AiCourse {
					lesson.AiCourse = *row.AiCourse
					changed = true
				}
				if changed {
					if err := lesson.Update(); err == nil {
						updatedLessons++
					}
				}
			} else {
				lesson = &model.WorkspaceLesson{
					UnitId:      lastUnitId,
					Title:       lessonTitle,
					Description: strings.TrimSpace(row.LessonDesc),
					AiCourse:    row.AiCourse != nil && *row.AiCourse,
					SortOrder:   1,
				}
				if err := lesson.Insert(); err != nil {
					failures = append(failures, wsExcelFailure{Row: label, Reason: "课时创建失败：" + err.Error()})
					continue
				}
				createdLessons++
			}
			lastLesson = &lessonCtx{id: &lesson.Id, title: lessonTitle}
		}
		// 任务标题留空表示该行只定义课时，不带任务。
		taskTitle := wsNormalizeCell(row.TaskTitle)
		if taskTitle == "" {
			continue
		}
		lessonId := 0
		if lastLesson != nil && lastLesson.id != nil {
			lessonId = *lastLesson.id
		}
		if lessonId <= 0 {
			failures = append(failures, wsExcelFailure{Row: label, Reason: "课时未成功创建，任务已跳过"})
			continue
		}
		var task *model.WorkspaceLessonTask
		var tasks []*model.WorkspaceLessonTask
		if err := model.DB.Where("lesson_id = ?", lessonId).
			Order("sort_order asc, id asc").Find(&tasks).Error; err == nil {
			for _, item := range tasks {
				if wsNormalizeClassName(item.Title) == wsNormalizeClassName(taskTitle) {
					task = item
					break
				}
			}
		}
		forms := normalizeForms(row.OutputForms)
		exts := model.NormalizeWorkspaceTaskExtensions(row.Extensions)
		maxUploads := 0
		if row.MaxUploads != nil && *row.MaxUploads > 0 {
			maxUploads = *row.MaxUploads
		}
		sortOrder := 0
		if row.SortOrder != nil {
			sortOrder = *row.SortOrder
		}
		if task != nil {
			task.Requirement = strings.TrimSpace(row.Requirement)
			if row.OutputForms != "" {
				task.OutputForms = forms
			}
			if row.Extensions != "" {
				task.AllowedExtensions = exts
			}
			if maxUploads > 0 {
				task.MaxUploads = maxUploads
			}
			if sortOrder > 0 {
				task.SortOrder = sortOrder
			}
			if err := task.Update(); err != nil {
				failures = append(failures, wsExcelFailure{Row: label, Reason: "任务更新失败：" + err.Error()})
				continue
			}
			updatedTasks++
			continue
		}
		task = &model.WorkspaceLessonTask{
			LessonId:          lessonId,
			Title:             taskTitle,
			Requirement:       strings.TrimSpace(row.Requirement),
			OutputForms:       forms,
			AllowedExtensions: exts,
			MaxUploads:        1,
			SortOrder:         sortOrder,
		}
		if maxUploads > 0 {
			task.MaxUploads = maxUploads
		}
		if err := task.Insert(); err != nil {
			failures = append(failures, wsExcelFailure{Row: label, Reason: "任务创建失败：" + err.Error()})
			continue
		}
		createdTasks++
	}

	if failures == nil {
		failures = []wsExcelFailure{}
	}
	common.ApiSuccess(c, gin.H{
		"units_created":   createdUnits,
		"units_updated":   updatedUnits,
		"lessons_created": createdLessons,
		"lessons_updated": updatedLessons,
		"tasks_created":   createdTasks,
		"tasks_updated":   updatedTasks,
		"failed":          failures,
		"total_rows":      len(rows),
	})
}

// parseWsExcelLessons 解析「备课」工作表：空单元格沿用上一行的学部/年级/单元/课时。
func parseWsExcelLessons(book *excelize.File) ([]wsExcelLessonRow, []wsExcelFailure) {
	sheet := wsFindSheet(book, wsExcelLessonSheet, "备课", "课程", "课时")
	if sheet == "" {
		return nil, nil
	}
	rawRows, err := book.GetRows(sheet)
	if err != nil || len(rawRows) < 2 {
		return nil, nil
	}
	index := wsHeaderIndex(rawRows[0])
	sectionIdx := wsFirstIndex(index, "学部（代码或名称）", "学部", "年级（代码或名称）")
	gradeIdx := wsFirstIndex(index, "年级（年级名或序号）", "年级", "年级（如一年级）")
	unitIdx := wsFirstIndex(index, "单元名称", "单元")
	unitDescIdx := wsFirstIndex(index, "单元说明（可选）", "单元说明")
	lessonIdx := wsFirstIndex(index, "课时标题", "课时", "课时名称")
	lessonDescIdx := wsFirstIndex(index, "课时说明（可选）", "课时说明")
	aiIdx := wsFirstIndex(index, "是否AI课程（是/否）", "是否AI课程", "AI课程")
	taskIdx := wsFirstIndex(index, "任务标题", "任务")
	reqIdx := wsFirstIndex(index, "任务要求（可选）", "任务要求")
	formsIdx := wsFirstIndex(index, "产出形式（大段文字/文件上传/AI作品，多个用；分隔）", "产出形式", "产物类型")
	extIdx := wsFirstIndex(index, "允许后缀（可选）", "允许后缀", "后缀")
	uploadsIdx := wsFirstIndex(index, "上传上限（可选）", "上传上限")
	sortIdx := wsFirstIndex(index, "排序（可选）", "排序")
	if unitIdx < 0 && lessonIdx < 0 && taskIdx < 0 {
		return nil, []wsExcelFailure{{Row: sheet, Reason: "缺少「单元名称」「课时标题」「任务标题」列"}}
	}

	lastSectionRef := ""
	lastGradeRef := ""
	lastUnitName := ""
	lastUnitDesc := ""
	lastLessonTitle := ""
	lastLessonDesc := ""
	var lastAi *bool

	result := make([]wsExcelLessonRow, 0, len(rawRows)-1)
	for i, raw := range rawRows[1:] {
		item := wsExcelLessonRow{Row: strconv.Itoa(i + 2)}
		if sectionIdx >= 0 {
			item.SectionRef = wsNormalizeCell(wsCell(raw, sectionIdx))
		}
		if item.SectionRef == "" {
			item.SectionRef = lastSectionRef
		} else {
			lastSectionRef = item.SectionRef
		}
		if gradeIdx >= 0 {
			item.GradeRef = wsNormalizeCell(wsCell(raw, gradeIdx))
		}
		if item.GradeRef == "" {
			item.GradeRef = lastGradeRef
		} else {
			lastGradeRef = item.GradeRef
		}
		item.UnitName = wsNormalizeCell(wsCell(raw, unitIdx))
		if item.UnitName == "" {
			item.UnitName = lastUnitName
		} else {
			lastUnitName = item.UnitName
			lastLessonTitle = ""
			lastLessonDesc = ""
			lastAi = nil
		}
		if unitDescIdx >= 0 {
			item.UnitDesc = wsNormalizeCell(wsCell(raw, unitDescIdx))
		}
		if item.UnitDesc == "" {
			item.UnitDesc = lastUnitDesc
		} else {
			lastUnitDesc = item.UnitDesc
		}
		item.LessonTitle = wsNormalizeCell(wsCell(raw, lessonIdx))
		if item.LessonTitle == "" {
			item.LessonTitle = lastLessonTitle
		} else {
			lastLessonTitle = item.LessonTitle
		}
		if lessonDescIdx >= 0 {
			item.LessonDesc = wsNormalizeCell(wsCell(raw, lessonDescIdx))
		}
		if item.LessonDesc == "" {
			item.LessonDesc = lastLessonDesc
		} else {
			lastLessonDesc = item.LessonDesc
		}
		if aiIdx >= 0 {
			item.AiCourse = parseWsExcelBoolPtr(wsCell(raw, aiIdx))
		}
		if item.AiCourse == nil {
			item.AiCourse = lastAi
		} else {
			lastAi = item.AiCourse
		}
		if taskIdx >= 0 {
			item.TaskTitle = wsNormalizeCell(wsCell(raw, taskIdx))
		}
		if reqIdx >= 0 {
			item.Requirement = strings.TrimSpace(wsCell(raw, reqIdx))
		}
		if formsIdx >= 0 {
			item.OutputForms = wsNormalizeCell(wsCell(raw, formsIdx))
		}
		if extIdx >= 0 {
			item.Extensions = wsNormalizeCell(wsCell(raw, extIdx))
		}
		if uploadsIdx >= 0 {
			if value := strings.TrimSpace(wsCell(raw, uploadsIdx)); value != "" {
				if num, err := strconv.Atoi(value); err == nil && num > 0 {
					item.MaxUploads = &num
				}
			}
		}
		if sortIdx >= 0 {
			if value := strings.TrimSpace(wsCell(raw, sortIdx)); value != "" {
				if num, err := strconv.Atoi(value); err == nil {
					item.SortOrder = &num
				}
			}
		}
		if item.UnitName == "" && item.LessonTitle == "" && item.TaskTitle == "" {
			continue
		}
		result = append(result, item)
	}
	if len(result) == 0 {
		return nil, []wsExcelFailure{{Row: sheet, Reason: "工作表中没有任何数据行"}}
	}
	return result, nil
}
