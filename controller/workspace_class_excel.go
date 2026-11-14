package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/xuri/excelize/v2"
)

// AI Workspace 班级、学生与上课小班批量导入的 Excel 模板与解析。
//
// 行政大班与上课小班共用同一份模板，**只有一个工作表**，每行表达
// 「一个行政班 +（可选）一个小班 +（可选）一个学生」的归属关系：
//   - 「行政班」：必填；同名重复出现表示同一班级，首次出现行填写学部与届
//   - 「学部」「届」：仅该班级第一次出现时填写，后续行留空即可
//   - 「小班」「授课教师」「类型」「AI课堂」「HTML实验室」：该小班首次出现
//     时填写；小班的所属行政班 = 所有出现过该小班名的行政班列去重合并
//   - 「学生姓名」：留空表示该行只定义班级/小班，不创建学生；学生填写
//     拼音与密码自动生成（免密登录），届别与学部从所属班级继承
//
// 旧版多工作表文件（班级/学生/小班/小班学生 四表）仍保持兼容解析，
// 「小班学生」表同样支持。
//
// 学生账号由「学部代码 + 届(2位) + 顺位编号(5位)」自动生成，导入流程为
// 「解析 → 预校验 → 执行」，逐行返回失败原因。

const (
	wsExcelClassSheet        = "班级"
	wsExcelStudentSheet      = "学生"
	wsExcelSmallClassSheet   = "小班"
	wsExcelSmallStudentSheet = "小班学生"
	wsExcelUnifiedSheet      = "导入"
	wsExcelClassFile         = "workspace-import-template.xlsx"
	// wsExcelStudentDefaultPassword 学生名单导入的默认初始密码。
	wsExcelStudentDefaultPassword = "123456"
)

var wsExcelClassHeader = []string{
	"班级名称", "班级编码（留空自动生成）", "学部（代码或名称）", "届（如2024）",
}

// wsExcelUnifiedHeader 单工作表合并模板的表头：一行表达
// 「行政班 +（可选）小班 +（可选）学生」，重复出现的行政班/小班自动归并。
var wsExcelUnifiedHeader = []string{
	"行政班", "学部（代码或名称）", "届（如2024）", "小班",
	"授课教师（多个用；分隔）", "类型（正课/选修）", "AI课堂（是/否）", "HTML实验室（是/否）",
	"学生姓名",
}

var wsExcelStudentHeader = []string{
	"班级编码（编码或名称）", "届（如2024）", "姓名", "姓名拼音（全拼，用于登录）", "初始密码（留空为 123456）", "小班编码（编码或名称，留空不入小班）",
}

var wsExcelSmallClassHeader = []string{
	"小班名称", "小班编码（留空自动生成）", "所属行政班（多个用；分隔）", "授课教师（多个用；分隔）", "类型（正课/选修）",
	"AI课堂（是/否）", "HTML实验室（是/否）",
}

var wsExcelSmallStudentHeader = []string{
	"小班名称", "姓名", "届（如2024）", "年级（代码或名称）",
}

// ---------- 模板下载 ----------

// buildWorkspaceImportTemplate 构建**单工作表**合并模板：
// 一个表即可同时完成行政班、上课小班与学生的全部设置。
func buildWorkspaceImportTemplate() (*excelize.File, error) {
	file := excelize.NewFile()
	sampleGrade := "P"
	if labels := workspaceSectionLabels(); len(labels) > 0 {
		sampleGrade = labels[0]
	}

	if err := file.SetSheetName("Sheet1", wsExcelUnifiedSheet); err != nil {
		return file, err
	}
	if err := writeWorkspaceExcelRow(file, wsExcelUnifiedSheet, 1, wsExcelUnifiedHeader); err != nil {
		return file, err
	}
	// 示例：第 2 行定义行政班一班；第 3-4 行为一班学生（学部/届留空沿用）；
	// 第 5-6 行定义小班「一班-A组」及其两名学生；第 7 行展示跨班小班。
	rows := [][]string{
		{"一班", sampleGrade, "2024", "", "", "", "", "", ""},
		{"", "", "", "", "", "", "", "", "张三"},
		{"", "", "", "", "", "", "", "", "李四"},
		{"", "", "", "一班-A组", "王老师", "正课", "是", "否", "王五"},
		{"", "", "", "", "", "", "", "", "赵六"},
		{"二班", sampleGrade, "2024", "机器人社", "陈老师", "选修", "是", "是", ""},
	}
	for i, values := range rows {
		if err := writeWorkspaceExcelRow(file, wsExcelUnifiedSheet, i+2, values); err != nil {
			return file, err
		}
	}
	return file, nil
}

// DownloadWorkspaceClassTemplate 下载行政大班与上课小班合并的批量导入 Excel 模板。
// 该模板同时服务于行政大班与上课小班两个入口，保证全校只用同一份文件。
func DownloadWorkspaceClassTemplate(c *gin.Context) {
	file, err := buildWorkspaceImportTemplate()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	defer func() { _ = file.Close() }()

	buf, err := file.WriteToBuffer()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.Header("Content-Disposition", "attachment; filename="+wsExcelClassFile)
	c.Data(http.StatusOK,
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		buf.Bytes())
}

// workspaceSectionLabels 返回可用于模板示例的学部代码。
func workspaceSectionLabels() []string {
	sections, err := model.AllWorkspaceSections()
	if err != nil || len(sections) == 0 {
		return nil
	}
	labels := make([]string, 0, len(sections))
	for _, section := range sections {
		labels = append(labels, section.Code)
	}
	return labels
}

func writeWorkspaceExcelRow(file *excelize.File, sheet string, row int, values []string) error {
	for i, value := range values {
		cell, err := excelize.CoordinatesToCellName(i+1, row)
		if err != nil {
			return err
		}
		if err := file.SetCellValue(sheet, cell, value); err != nil {
			return err
		}
	}
	return nil
}

// ---------- 导入 ----------

type wsExcelFailure struct {
	Row    string `json:"row"`
	Reason string `json:"reason"`
}

type wsExcelClassRow struct {
	Name string
	// Code 班级编码（留空时自动生成 C{1000+id}）。
	Code       string
	SectionRef string
	EntryYear  int
}

type wsExcelStudentRow struct {
	Row        string
	SectionRef string
	EntryYear  int
	// ClassName 班级引用：优先按班级编码匹配，匹配不到再按班级名称匹配（兼容旧模板）。
	ClassName string
	// SmallClassRef 小班引用（编码或名称），留空表示不入小班。
	SmallClassRef string
	DisplayName   string
	// Pinyin 姓名全拼，学生可直接用全拼作为登录账号。
	Pinyin   string
	Password string
}

// wsExcelSmallClassRow 「小班」工作表的一行：行政班与授课教师支持多选（；分隔）。
type wsExcelSmallClassRow struct {
	Name     string
	Code     string
	Parents  []string
	Teachers []string
	Type     string
	// AiEnabled / HtmlEnabled 指针表示对应列是否填写：nil = 列缺失或留空，保持默认值。
	AiEnabled   *bool
	HtmlEnabled *bool
}

// wsExcelSmallStudentRow 「小班学生」工作表的一行。
type wsExcelSmallStudentRow struct {
	Row         string
	SmallName   string
	DisplayName string
	EntryYear   int
	GradeRef    string
}

// ImportWorkspaceClasses 解析上传的 Excel，批量创建/更新班级与学生账号。
func ImportWorkspaceClasses(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		common.ApiError(c, common.NewMessage("请上传 Excel 文件"))
		return
	}
	defaultPassword := strings.TrimSpace(c.PostForm("default_password"))
	if defaultPassword == "" {
		defaultPassword = wsExcelStudentDefaultPassword
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

	// 单工作表合并模板优先（行政班 + 小班 + 学生一张表）；
	// 未命中单表结构时回退旧版多工作表解析，保证历史文件仍可导入。
	var classRows []wsExcelClassRow
	var studentRows []wsExcelStudentRow
	var smallClassRows []wsExcelSmallClassRow
	var smallStudentRows []wsExcelSmallStudentRow
	var failures []wsExcelFailure
	if unifiedRows, _ := parseWsExcelUnifiedRows(book); unifiedRows != nil {
		var expandFailures []wsExcelFailure
		classRows, smallClassRows, studentRows, expandFailures = expandWsUnifiedRows(unifiedRows)
		failures = append(failures, expandFailures...)
	} else {
		var classFailures, studentFailures, smallClassFailures, smallStudentFailures []wsExcelFailure
		classRows, classFailures = parseWsExcelClasses(book)
		studentRows, studentFailures = parseWsExcelStudents(book)
		smallClassRows, smallClassFailures = parseWsExcelSmallClasses(book)
		smallStudentRows, smallStudentFailures = parseWsExcelSmallStudents(book)
		failures = append(failures, classFailures...)
		failures = append(failures, studentFailures...)
		failures = append(failures, smallClassFailures...)
		failures = append(failures, smallStudentFailures...)
		if len(classRows) == 0 && len(studentRows) == 0 && len(smallClassRows) == 0 && len(smallStudentRows) == 0 {
			common.ApiError(c, common.NewMessage("Excel 中没有可导入的数据，请确认使用下载的模板填写"))
			return
		}
	}
	if len(classRows) == 0 && len(studentRows) == 0 && len(smallClassRows) == 0 {
		if len(failures) > 0 {
			common.ApiSuccess(c, gin.H{"failed": failures})
			return
		}
		common.ApiError(c, common.NewMessage("Excel 中没有可导入的数据，请确认使用下载的模板填写"))
		return
	}

	sections, err := model.AllWorkspaceSections()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	sectionByRef := make(map[string]*model.WorkspaceSection, len(sections)*2)
	for _, section := range sections {
		sectionByRef[strings.ToUpper(strings.TrimSpace(section.Code))] = section
		sectionByRef[strings.TrimSpace(section.Name)] = section
	}
	resolveSection := func(ref string) *model.WorkspaceSection {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			return nil
		}
		return sectionByRef[ref]
	}

	// 班级按名称归组：同名班级可能分布在不同学部或届别，需结合学部与届别挑选。
	classIds := make(map[string]int)
	classIdsByCode := make(map[string]int)
	existingByName := make(map[string][]*model.WorkspaceClass)
	existing, _ := model.GetAllWorkspaceClasses()
	for _, class := range existing {
		key := wsNormalizeClassName(class.Name)
		classIds[key] = class.Id
		existingByName[key] = append(existingByName[key], class)
		if code := strings.TrimSpace(class.Code); code != "" {
			classIdsByCode[strings.ToUpper(code)] = class.Id
		}
	}
	resolveClass := func(name string, section *model.WorkspaceSection, entryYear int) *model.WorkspaceClass {
		candidates := existingByName[wsNormalizeClassName(name)]
		if len(candidates) == 0 {
			return nil
		}
		if len(candidates) == 1 {
			return candidates[0]
		}
		// 优先匹配「学部 + 届别」完全一致的同名班级。
		for _, class := range candidates {
			if entryYear > 0 && class.EntryYear != entryYear {
				continue
			}
			if section != nil && class.SectionId != section.Id {
				continue
			}
			return class
		}
		// 退化为仅按届别匹配。
		if entryYear > 0 {
			for _, class := range candidates {
				if class.EntryYear == entryYear {
					return class
				}
			}
		}
		return candidates[0]
	}

	// ---- 执行：班级表 ----
	createdClasses := 0
	updatedClasses := 0
	for _, row := range classRows {
		section := resolveSection(row.SectionRef)
		if section == nil {
			failures = append(failures, wsExcelFailure{Row: row.Name, Reason: "学部「" + row.SectionRef + "」不存在，请先在学部管理中配置"})
			continue
		}
		if row.EntryYear < 1000 || row.EntryYear > 2999 {
			failures = append(failures, wsExcelFailure{
				Row:    row.Name,
				Reason: "届别「" + strconv.Itoa(row.EntryYear) + "」不是有效的 4 位年份，请填写入学年份（如 2024）",
			})
			continue
		}
		classKey := wsNormalizeClassName(row.Name)
		// 班级编码：填写时校验是否与其他班级冲突。
		code := strings.TrimSpace(row.Code)
		if code != "" {
			codeKey := strings.ToUpper(code)
			if owner, ok := classIdsByCode[codeKey]; ok {
				if id, exists := classIds[classKey]; !exists || owner != id {
					failures = append(failures, wsExcelFailure{Row: row.Name, Reason: "班级编码「" + code + "」已被其他班级占用，请更换"})
					continue
				}
			}
		}
		if id, ok := classIds[classKey]; ok {
			class, err := model.GetWorkspaceClassById(id)
			if err != nil {
				failures = append(failures, wsExcelFailure{Row: row.Name, Reason: "班级读取失败"})
				continue
			}
			class.SectionId = section.Id
			class.EntryYear = row.EntryYear
			if code != "" {
				class.Code = code
			}
			if err := class.Update(); err != nil {
				failures = append(failures, wsExcelFailure{Row: row.Name, Reason: "班级更新失败"})
				continue
			}
			// 同步内存中的候选班级，保证后续学生行按更新后的学部/届别匹配。
			for _, candidate := range existingByName[classKey] {
				if candidate.Id == class.Id {
					candidate.SectionId = class.SectionId
					candidate.EntryYear = class.EntryYear
					candidate.Code = class.Code
				}
			}
			if class.Code != "" {
				classIdsByCode[strings.ToUpper(class.Code)] = class.Id
			}
			updatedClasses++
			continue
		}
		class := &model.WorkspaceClass{
			Name:      row.Name,
			Code:      code,
			SectionId: section.Id,
			EntryYear: row.EntryYear,
			Enabled:   true,
		}
		if err := class.Insert(); err != nil {
			failures = append(failures, wsExcelFailure{Row: row.Name, Reason: "班级创建失败，名称可能重复"})
			continue
		}
		// 未填写编码时按自增序号自动生成，保证学生表可直接引用。
		if class.Code == "" {
			class.Code = "C" + strconv.Itoa(1000+class.Id)
			if err := class.Update(); err != nil {
				common.SysError(common.LogText("auto class code failed: id=%d err=%s", class.Id, err.Error()))
			}
		}
		classIds[classKey] = class.Id
		if class.Code != "" {
			classIdsByCode[strings.ToUpper(class.Code)] = class.Id
		}
		existingByName[classKey] = append(existingByName[classKey], class)
		createdClasses++
	}

	// ---- 执行：小班表（行政班与授课教师多选，按名称解析为 id） ----
	createdSmallClasses := 0
	updatedSmallClasses := 0
	// 行政班名称 → id（含本次班级表新建的）。
	classIdByName := make(map[string]int)
	for key, id := range classIds {
		classIdByName[key] = id
	}
	// 授课教师索引：仅教师及以上角色可被绑定（按显示名 / 用户名 / 拼音匹配）。
	teacherByName := make(map[string]int)
	if teachers, err := model.ListWorkspaceTeacherUsers(); err == nil {
		for _, teacher := range teachers {
			names := []string{teacher.DisplayName, teacher.Username}
			for _, name := range names {
				name = wsNormalizeClassName(name)
				if name == "" {
					continue
				}
				if _, exists := teacherByName[name]; !exists {
					teacherByName[name] = teacher.Id
				}
			}
		}
	}
	// splitExcelMultiCell 拆分逻辑见 parseWsExcelSmallClasses（；/;/、 分隔）。
	smallClassIdByName := make(map[string]int)
	smallClassIdByCode := make(map[string]int)
	existingSmallClasses, _ := model.GetAllWorkspaceSmallClasses(0, 0)
	for _, item := range existingSmallClasses {
		smallClassIdByName[wsNormalizeClassName(item.Name)] = item.Id
		if code := strings.TrimSpace(item.Code); code != "" {
			smallClassIdByCode[strings.ToUpper(code)] = item.Id
		}
	}
	for _, row := range smallClassRows {
		// 所属行政班（多选）：按名称解析，未知名称报错跳过。
		parentIds := make([]int, 0, len(row.Parents))
		parentMissing := ""
		for _, parentName := range row.Parents {
			id, ok := classIdByName[wsNormalizeClassName(parentName)]
			if !ok {
				parentMissing = parentName
				break
			}
			parentIds = append(parentIds, id)
		}
		if parentMissing != "" {
			failures = append(failures, wsExcelFailure{
				Row:    row.Name,
				Reason: "所属行政班「" + parentMissing + "」不存在，请先在「班级」工作表或班级管理中登记",
			})
			continue
		}
		// 授课教师（多选）：按显示名/用户名解析，未知教师报错跳过。
		teacherIds := make([]int, 0, len(row.Teachers))
		teacherMissing := ""
		for _, teacherName := range row.Teachers {
			id, ok := teacherByName[wsNormalizeClassName(teacherName)]
			if !ok {
				teacherMissing = teacherName
				break
			}
			teacherIds = append(teacherIds, id)
		}
		if teacherMissing != "" {
			failures = append(failures, wsExcelFailure{
				Row:    row.Name,
				Reason: "授课教师「" + teacherMissing + "」不存在，请先创建教师账号",
			})
			continue
		}
		// 小班编码校验（留空自动生成）。
		code := strings.TrimSpace(row.Code)
		if code != "" {
			if exists, err := model.WorkspaceSmallClassCodeExists(code, smallClassIdByName[wsNormalizeClassName(row.Name)]); err == nil && exists {
				failures = append(failures, wsExcelFailure{Row: row.Name, Reason: "小班编码「" + code + "」已被占用，请更换"})
				continue
			}
		}
		smallKey := wsNormalizeClassName(row.Name)
		if id, ok := smallClassIdByName[smallKey]; ok {
			item, err := model.GetWorkspaceSmallClassById(id)
			if err != nil {
				failures = append(failures, wsExcelFailure{Row: row.Name, Reason: "小班读取失败"})
				continue
			}
			item.Code = code
			item.ParentClassIds = normalizeWorkspaceIdList(parentIds)
			item.TeacherIds = normalizeWorkspaceIdList(teacherIds)
			item.Type = normalizeWorkspaceSmallClassType(row.Type)
			if row.AiEnabled != nil {
				item.AiEnabled = *row.AiEnabled
			}
			if row.HtmlEnabled != nil {
				item.HtmlEnabled = *row.HtmlEnabled
			}
			if err := item.Update(); err != nil {
				failures = append(failures, wsExcelFailure{Row: row.Name, Reason: "小班更新失败"})
				continue
			}
			if item.Code != "" {
				smallClassIdByCode[strings.ToUpper(item.Code)] = item.Id
			}
			updatedSmallClasses++
			continue
		}
		item := &model.WorkspaceSmallClass{
			Name:           row.Name,
			Code:           code,
			ParentClassIds: normalizeWorkspaceIdList(parentIds),
			TeacherIds:     normalizeWorkspaceIdList(teacherIds),
			Type:           normalizeWorkspaceSmallClassType(row.Type),
			Enabled:        true,
			AiEnabled:      true,
			HtmlEnabled:    false,
		}
		if row.AiEnabled != nil {
			item.AiEnabled = *row.AiEnabled
		}
		if row.HtmlEnabled != nil {
			item.HtmlEnabled = *row.HtmlEnabled
		}
		if err := item.Insert(); err != nil {
			failures = append(failures, wsExcelFailure{Row: row.Name, Reason: "小班创建失败，名称可能重复"})
			continue
		}
		if item.Code == "" {
			item.Code = "S" + strconv.Itoa(1000+item.Id)
			if err := item.Update(); err != nil {
				common.SysError(common.LogText("auto small class code failed: id=%d err=%s", item.Id, err.Error()))
			}
		}
		smallClassIdByName[smallKey] = item.Id
		if item.Code != "" {
			smallClassIdByCode[strings.ToUpper(item.Code)] = item.Id
		}
		createdSmallClasses++
	}

	// ---- 执行：学生表（班级编码 + 小班编码，小班归属并入本表） ----
	createdStudents := 0
	skippedStudents := 0
	addedSmallMembers := 0
	skippedSmallStudents := 0
	// 班级花名册缓存：用于识别同一班级内重复上传的学生，避免重复建号。
	rosterCache := make(map[int]map[string][]string)
	loadRoster := func(classId int) map[string][]string {
		if roster, ok := rosterCache[classId]; ok {
			return roster
		}
		roster := make(map[string][]string)
		if students, err := model.GetAllWorkspaceStudents(classId); err == nil {
			for _, student := range students {
				name := wsNormalizeClassName(student.DisplayName)
				roster[name] = append(roster[name], normalizeWorkspacePinyin(student.PinyinUsername))
			}
		}
		rosterCache[classId] = roster
		return roster
	}
	for _, row := range studentRows {
		label := row.DisplayName
		if label == "" {
			label = row.ClassName
		}
		rowSection := resolveSection(row.SectionRef)
		// 班级解析：优先按班级编码匹配，匹配不到再按班级名称（兼容旧模板）。
		var class *model.WorkspaceClass
		if ref := strings.TrimSpace(row.ClassName); ref != "" {
			if id, ok := classIdsByCode[strings.ToUpper(ref)]; ok && id > 0 {
				if class, err = model.GetWorkspaceClassById(id); err != nil {
					class = nil
				}
			}
		}
		if class == nil {
			if id, ok := classIds[wsNormalizeClassName(row.ClassName)]; ok && id > 0 {
				if class, err = model.GetWorkspaceClassById(id); err != nil {
					class = nil
				}
			}
		}
		// 班级已存在时可直接把新学生加进去；同名班级按学部 + 届别挑选。
		if class == nil {
			class = resolveClass(row.ClassName, rowSection, row.EntryYear)
		}
		if class == nil {
			failures = append(failures, wsExcelFailure{Row: label, Reason: "班级「" + row.ClassName + "」不存在，请先创建班级或在上传表格的「班级」表登记"})
			continue
		}
		// 小班归属：按编码或名称解析，留空表示不入小班；未知小班直接报错，避免误建学生。
		smallClassId := 0
		if ref := strings.TrimSpace(row.SmallClassRef); ref != "" {
			if id, ok := smallClassIdByCode[strings.ToUpper(ref)]; ok {
				smallClassId = id
			} else if id, ok := smallClassIdByName[wsNormalizeClassName(ref)]; ok {
				smallClassId = id
			} else {
				failures = append(failures, wsExcelFailure{Row: label, Reason: "小班「" + ref + "」不存在，请先在「小班」工作表或小班管理中创建"})
				continue
			}
		}
		section := rowSection
		if section == nil {
			if section, err = model.GetWorkspaceSectionById(class.SectionId); err != nil {
				failures = append(failures, wsExcelFailure{Row: label, Reason: "班级未绑定学部，无法生成账号"})
				continue
			}
		}
		entryYear := row.EntryYear
		if entryYear <= 0 {
			entryYear = class.EntryYear
		}
		if entryYear < 1000 || entryYear > 2999 {
			failures = append(failures, wsExcelFailure{Row: label, Reason: "届别不是有效的 4 位年份"})
			continue
		}
		// 导入时写入的密码只是占位，学生保持默认免密登录，之后可自行设置密码。
		password := strings.TrimSpace(row.Password)
		if password == "" {
			password = defaultPassword
		}
		if password == "" {
			// 学生登录不依赖密码，这里写入随机密码仅用于占位。
			password = common.GetRandomString(16)
		}
		displayName := strings.TrimSpace(row.DisplayName)
		if displayName == "" {
			displayName = row.ClassName
		}
		pinyin := normalizeWorkspacePinyin(row.Pinyin)
		// 拼音留空时按中文姓名自动转拼音，并在班级内自动去重。
		if pinyin == "" {
			pinyin = workspacePinyinForName(displayName)
		}
		pinyin = allocateWorkspacePinyin(class.Id, pinyin, 0)
		// 同一班级内「姓名」相同的行视为重复上传，跳过而不是报错。
		duplicated := false
		if _, ok := loadRoster(class.Id)[wsNormalizeClassName(displayName)]; ok {
			duplicated = true
		}
		if duplicated {
			skippedStudents++
			// 已存在的学生：只同步小班归属。
			if smallClassId > 0 {
				if list, err := model.GetAllWorkspaceStudents(class.Id); err == nil {
					for _, exist := range list {
						if wsNormalizeClassName(exist.DisplayName) != wsNormalizeClassName(displayName) {
							continue
						}
						added, err := model.AddWorkspaceSmallClassMembers(smallClassId, []int{exist.Id})
						if err == nil && added > 0 {
							addedSmallMembers++
						} else if err == nil {
							skippedSmallStudents++
						}
						break
					}
				}
			}
			continue
		}
		username, err := model.AllocateWorkspaceUsername(section.Code, entryYear)
		if err != nil {
			failures = append(failures, wsExcelFailure{Row: label, Reason: err.Error()})
			continue
		}
		user := &model.User{
			Username:    username,
			Password:    password,
			DisplayName: displayName,
			Role:        common.RoleCommonUser,
		}
		if err := user.Insert(0); err != nil {
			failures = append(failures, wsExcelFailure{Row: label, Reason: "创建账号失败：" + err.Error()})
			continue
		}
		student := &model.WorkspaceStudent{
			UserId:         user.Id,
			ClassId:        class.Id,
			EntryYear:      entryYear,
			StudentNo:      username,
			PinyinUsername: pinyin,
			DisplayName:    displayName,
			Enabled:        true,
			Status:         model.WorkspaceStudentStatusActive,
		}
		if err := student.Insert(); err != nil {
			failures = append(failures, wsExcelFailure{Row: label, Reason: "加入班级失败：" + err.Error()})
			continue
		}
		// 按「小班编码」列直接入小班（幂等）。
		if smallClassId > 0 {
			added, err := model.AddWorkspaceSmallClassMembers(smallClassId, []int{student.Id})
			if err != nil {
				failures = append(failures, wsExcelFailure{Row: label, Reason: "加入小班失败：" + err.Error()})
			} else if added > 0 {
				addedSmallMembers++
			} else {
				skippedSmallStudents++
			}
		}
		// 新学生写入花名册，避免同一份表格内的重复行再次建号。
		roster := loadRoster(class.Id)
		roster[wsNormalizeClassName(displayName)] = append(roster[wsNormalizeClassName(displayName)], pinyin)
		createdStudents++
	}

	// ---- 执行：小班学生表（旧模板兼容：姓名 + 届次 + 年级三层匹配，直接入班） ----
	// addedSmallMembers / skippedSmallStudents 计数已在学生表执行段声明，此处复用。
	// 第一层匹配所需的全部在读学生与学部索引（sectionByRef 已在上方构建）。
	allActiveStudents, _ := model.GetWorkspaceStudentsFiltered(0, model.WorkspaceStudentStatusActive)
	classSection := make(map[int]int)
	if classList, err := model.GetAllWorkspaceClasses(); err == nil {
		for _, class := range classList {
			classSection[class.Id] = class.SectionId
		}
	}
	for _, row := range smallStudentRows {
		smallId, ok := smallClassIdByName[wsNormalizeClassName(row.SmallName)]
		if !ok {
			failures = append(failures, wsExcelFailure{
				Row:    row.SmallName + "/" + row.DisplayName,
				Reason: "小班「" + row.SmallName + "」不存在，请先在「小班」工作表或小班管理中创建",
			})
			continue
		}
		// 第一层：姓名精确匹配。
		candidates := make([]*model.WorkspaceStudent, 0)
		for _, student := range allActiveStudents {
			if wsNormalizeClassName(student.DisplayName) == wsNormalizeClassName(row.DisplayName) {
				candidates = append(candidates, student)
			}
		}
		// 第二层：届次过滤。
		if row.EntryYear > 0 && len(candidates) > 0 {
			filtered := candidates[:0]
			for _, student := range candidates {
				if student.EntryYear == row.EntryYear {
					filtered = append(filtered, student)
				}
			}
			candidates = filtered
		}
		// 第三层：年级（学部）过滤。
		if row.GradeRef != "" && len(candidates) > 0 {
			section := sectionByRef[strings.ToUpper(strings.TrimSpace(row.GradeRef))]
			if section == nil {
				section = sectionByRef[strings.TrimSpace(row.GradeRef)]
			}
			if section != nil {
				filtered := candidates[:0]
				for _, student := range candidates {
					if classSection[student.ClassId] == section.Id {
						filtered = append(filtered, student)
					}
				}
				candidates = filtered
			}
		}
		if len(candidates) != 1 {
			failures = append(failures, wsExcelFailure{
				Row: row.SmallName + "/" + row.DisplayName,
				Reason: func() string {
					if len(candidates) == 0 {
						return "未找到匹配的学生，请先创建学生或补全姓名/届次/年级"
					}
					return "存在多名同名学生，请缩小届次或年级后重试，或在小班「导入学生」中手动配对"
				}(),
			})
			continue
		}
		student := candidates[0]
		var existsCount int64
		_ = model.DB.Model(&model.WorkspaceSmallClassMember{}).
			Where("small_class_id = ? AND student_id = ?", smallId, student.Id).
			Count(&existsCount).Error
		if existsCount > 0 {
			skippedSmallStudents++
			continue
		}
		if _, err := model.AddWorkspaceSmallClassMembers(smallId, []int{student.Id}); err != nil {
			failures = append(failures, wsExcelFailure{Row: row.SmallName + "/" + row.DisplayName, Reason: "入班失败：" + err.Error()})
			continue
		}
		addedSmallMembers++
	}

	if failures == nil {
		failures = []wsExcelFailure{}
	}
	common.ApiSuccess(c, gin.H{
		"classes_created":       createdClasses,
		"classes_updated":       updatedClasses,
		"students_created":      createdStudents,
		"students_skipped":      skippedStudents,
		"small_classes_created": createdSmallClasses,
		"small_classes_updated": updatedSmallClasses,
		"small_members_added":   addedSmallMembers,
		"small_members_skipped": skippedSmallStudents,
		"failed":                failures,
	})
}

// wsFindSheet 按「精确名 → 关键字 → 单表回退」定位工作表，兼容用户自行命名的表格。
func wsFindSheet(book *excelize.File, exact string, keywords ...string) string {
	sheets := book.GetSheetList()
	for _, name := range sheets {
		if strings.TrimSpace(name) == exact {
			return name
		}
	}
	for _, name := range sheets {
		for _, keyword := range keywords {
			if strings.Contains(name, keyword) {
				return name
			}
		}
	}
	return ""
}

// wsNormalizeClassName 归一化班级名称：去除全角空格与所有空白，忽略大小写。
func wsNormalizeClassName(name string) string {
	cleaned := strings.ReplaceAll(name, "\u3000", "")
	cleaned = strings.Join(strings.Fields(cleaned), "")
	return strings.ToLower(cleaned)
}

// wsNormalizeCell 去除单元格首尾空白，并把全角空格替换为普通空格。
func wsNormalizeCell(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(value, "\u3000", " "))
}

// parseWsExcelClasses 解析「班级」工作表。
func parseWsExcelClasses(book *excelize.File) ([]wsExcelClassRow, []wsExcelFailure) {
	// 关键字用「行政班」而非「班级」，避免误命中「小班」工作表。
	sheet := wsFindSheet(book, wsExcelClassSheet, "行政班")
	if sheet == "" {
		return nil, nil
	}
	rows, err := book.GetRows(sheet)
	if err != nil || len(rows) < 2 {
		return nil, nil
	}
	index := wsHeaderIndex(rows[0])
	nameIdx := wsFirstIndex(index, "班级名称", "班级", "名称")
	if nameIdx < 0 {
		return nil, []wsExcelFailure{{Row: sheet, Reason: "缺少「班级名称」列"}}
	}
	codeIdx := wsFirstIndex(index, "班级编码（留空自动生成）", "班级编码", "编码")
	gradeIdx := wsFirstIndex(index, "学部（代码或名称）", "学部", "年级（代码或名称）", "年级")
	yearIdx := wsFirstIndex(index, "届（如2024）", "届别", "届")

	result := make([]wsExcelClassRow, 0, len(rows)-1)
	for _, row := range rows[1:] {
		name := wsNormalizeCell(wsCell(row, nameIdx))
		if name == "" {
			continue
		}
		item := wsExcelClassRow{Name: name}
		if codeIdx >= 0 {
			item.Code = wsNormalizeCell(wsCell(row, codeIdx))
		}
		item.SectionRef = wsNormalizeCell(wsCell(row, gradeIdx))
		if yearIdx >= 0 {
			item.EntryYear, _ = parseWsExcelYear(wsCell(row, yearIdx))
		}
		result = append(result, item)
	}
	return result, nil
}

// parseWsExcelStudents 解析「学生」工作表（行政大班学生名单）。
func parseWsExcelStudents(book *excelize.File) ([]wsExcelStudentRow, []wsExcelFailure) {
	// 关键字不带「学生」二字直配，避免误命中「小班学生」工作表。
	sheet := wsFindSheet(book, wsExcelStudentSheet, "班级学生", "行政班学生", "名单", "花名册")
	if sheet == "" {
		// 只有一个工作表且不是班级/小班表时，按学生表解析，兼容用户自定义表名。
		if sheets := book.GetSheetList(); len(sheets) == 1 &&
			!strings.Contains(sheets[0], "班级") && !strings.Contains(sheets[0], "小班") {
			sheet = sheets[0]
		}
	}
	if sheet == "" {
		return nil, nil
	}
	rows, err := book.GetRows(sheet)
	if err != nil || len(rows) < 2 {
		return nil, nil
	}
	index := wsHeaderIndex(rows[0])
	// 新模板为「班级编码（编码或名称）」，旧模板为「班级名称」，两者都兼容。
	classIdx := wsFirstIndex(index, "班级编码（编码或名称）", "班级编码", "班级名称", "班级", "所属班级")
	if classIdx < 0 {
		return nil, []wsExcelFailure{{Row: sheet, Reason: "缺少「班级编码（编码或名称）」列"}}
	}
	nameIdx := wsFirstIndex(index, "姓名", "学生姓名", "名字")
	if nameIdx < 0 {
		return nil, []wsExcelFailure{{Row: sheet, Reason: "缺少「姓名」列"}}
	}
	smallIdx := wsFirstIndex(index, "小班编码（编码或名称，留空不入小班）", "小班编码", "所属小班")
	gradeIdx := wsFirstIndex(index, "学部（代码或名称）", "学部", "年级（代码或名称）", "年级")
	yearIdx := wsFirstIndex(index, "届（如2024）", "届别", "届")
	pinyinIdx := wsFirstIndex(index,
		"姓名拼音（全拼，用于登录）", "姓名拼音（全拼）", "姓名拼音", "拼音用户名", "拼音", "全拼")
	passwordIdx := wsFirstIndex(index, "初始密码（留空为 123456）", "初始密码")

	result := make([]wsExcelStudentRow, 0, len(rows)-1)
	for rowIndex, row := range rows[1:] {
		className := wsNormalizeCell(wsCell(row, classIdx))
		displayName := wsNormalizeCell(wsCell(row, nameIdx))
		if className == "" && displayName == "" {
			continue
		}
		item := wsExcelStudentRow{
			Row:         strconv.Itoa(rowIndex + 2),
			ClassName:   className,
			DisplayName: displayName,
			SectionRef:  wsNormalizeCell(wsCell(row, gradeIdx)),
			Pinyin:      normalizeWorkspacePinyin(wsCell(row, pinyinIdx)),
			Password:    strings.TrimSpace(wsCell(row, passwordIdx)),
		}
		if smallIdx >= 0 {
			item.SmallClassRef = wsNormalizeCell(wsCell(row, smallIdx))
		}
		if yearIdx >= 0 {
			item.EntryYear, _ = parseWsExcelYear(wsCell(row, yearIdx))
		}
		result = append(result, item)
	}
	return result, nil
}

// parseWsExcelSmallClasses 解析「小班」工作表（行政班与授课教师支持多选，用；分隔）。
func parseWsExcelSmallClasses(book *excelize.File) ([]wsExcelSmallClassRow, []wsExcelFailure) {
	sheet := wsFindSheet(book, wsExcelSmallClassSheet, "小班")
	if sheet == "" {
		return nil, nil
	}
	rows, err := book.GetRows(sheet)
	if err != nil || len(rows) < 2 {
		return nil, nil
	}
	index := wsHeaderIndex(rows[0])
	nameIdx := wsFirstIndex(index, "小班名称", "小班", "名称")
	if nameIdx < 0 {
		return nil, []wsExcelFailure{{Row: sheet, Reason: "缺少「小班名称」列"}}
	}
	codeIdx := wsFirstIndex(index, "小班编码（留空自动生成）", "小班编码", "编码")
	parentIdx := wsFirstIndex(index, "所属行政班（多个用；分隔）", "所属行政班", "行政班")
	teacherIdx := wsFirstIndex(index, "授课教师（多个用；分隔）", "授课教师", "教师")
	typeIdx := wsFirstIndex(index, "类型（正课/选修）", "类型")
	aiIdx := wsFirstIndex(index, "AI课堂（是/否）", "AI课堂", "AI课程", "AI")
	htmlIdx := wsFirstIndex(index, "HTML实验室（是/否）", "HTML实验室", "HTML实验", "HTML")

	result := make([]wsExcelSmallClassRow, 0, len(rows)-1)
	for _, row := range rows[1:] {
		name := wsNormalizeCell(wsCell(row, nameIdx))
		if name == "" {
			continue
		}
		item := wsExcelSmallClassRow{
			Name: name,
			Code: wsNormalizeCell(wsCell(row, codeIdx)),
			Type: wsNormalizeCell(wsCell(row, typeIdx)),
			// 指针仅在对应列填写了可解析值时赋值，缺列/留空保持 nil（沿用默认）。
			AiEnabled:   parseWsExcelBoolPtr(wsCell(row, aiIdx)),
			HtmlEnabled: parseWsExcelBoolPtr(wsCell(row, htmlIdx)),
		}
		for _, ref := range strings.FieldsFunc(wsCell(row, parentIdx), func(r rune) bool {
			return r == '；' || r == ';' || r == '、'
		}) {
			if cleaned := strings.TrimSpace(ref); cleaned != "" {
				item.Parents = append(item.Parents, cleaned)
			}
		}
		for _, ref := range strings.FieldsFunc(wsCell(row, teacherIdx), func(r rune) bool {
			return r == '；' || r == ';' || r == '、'
		}) {
			if cleaned := strings.TrimSpace(ref); cleaned != "" {
				item.Teachers = append(item.Teachers, cleaned)
			}
		}
		result = append(result, item)
	}
	return result, nil
}

// parseWsExcelSmallStudents 解析「小班学生」工作表（小班名称 + 姓名 + 届 + 年级）。
func parseWsExcelSmallStudents(book *excelize.File) ([]wsExcelSmallStudentRow, []wsExcelFailure) {
	sheet := wsFindSheet(book, wsExcelSmallStudentSheet, "小班学生", "小班名单")
	if sheet == "" {
		return nil, nil
	}
	rows, err := book.GetRows(sheet)
	if err != nil || len(rows) < 2 {
		return nil, nil
	}
	index := wsHeaderIndex(rows[0])
	smallIdx := wsFirstIndex(index, "小班名称", "小班")
	if smallIdx < 0 {
		return nil, []wsExcelFailure{{Row: sheet, Reason: "缺少「小班名称」列"}}
	}
	nameIdx := wsFirstIndex(index, "姓名", "学生姓名", "名字")
	if nameIdx < 0 {
		return nil, []wsExcelFailure{{Row: sheet, Reason: "缺少「姓名」列"}}
	}
	yearIdx := wsFirstIndex(index, "届（如2024）", "届别", "届")
	gradeIdx := wsFirstIndex(index, "年级（代码或名称）", "学部（代码或名称）", "学部", "年级")

	result := make([]wsExcelSmallStudentRow, 0, len(rows)-1)
	for rowIndex, row := range rows[1:] {
		displayName := wsNormalizeCell(wsCell(row, nameIdx))
		if displayName == "" {
			continue
		}
		item := wsExcelSmallStudentRow{
			Row:         strconv.Itoa(rowIndex + 2),
			SmallName:   wsNormalizeCell(wsCell(row, smallIdx)),
			DisplayName: displayName,
			GradeRef:    wsNormalizeCell(wsCell(row, gradeIdx)),
		}
		if yearIdx >= 0 {
			item.EntryYear, _ = parseWsExcelYear(wsCell(row, yearIdx))
		}
		result = append(result, item)
	}
	return result, nil
}

// parseWsExcelYear 解析届别：支持「2024」「2024届」「24」三种写法。
func parseWsExcelYear(raw string) (int, error) {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimSuffix(trimmed, "届")
	if trimmed == "" {
		return 0, fmt.Errorf("empty")
	}
	year, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, err
	}
	if year < 100 {
		year += 2000
	}
	return year, nil
}

// wsUnifiedRow 单工作表模板的一行：行政班 + 可选小班 + 可选学生。
type wsUnifiedRow struct {
	Row        string
	ClassName  string
	SectionRef string
	EntryYear  int
	SmallName  string
	Teachers   []string
	Type       string
	// AiEnabled / HtmlEnabled 指针表示列是否填写：nil = 留空，保持默认值。
	AiEnabled   *bool
	HtmlEnabled *bool
	StudentName string
}

// splitWsCellRefs 按 ；/;、 拆分多值单元格。
func splitWsCellRefs(raw string) []string {
	var result []string
	for _, ref := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == '；' || r == ';' || r == '、'
	}) {
		if cleaned := strings.TrimSpace(ref); cleaned != "" {
			result = append(result, cleaned)
		}
	}
	return result
}

// parseWsExcelUnifiedRows 解析**单工作表**合并模板（表头含「行政班」列）。
// 班级首次出现行携带学部/届；小班首次出现行携带教师与开关；学生列填名即建号。
// 未命中单表结构时返回 nil，调用方回退旧版多工作表解析。
func parseWsExcelUnifiedRows(book *excelize.File) ([]wsUnifiedRow, []wsExcelFailure) {
	sheet := wsFindSheet(book, wsExcelUnifiedSheet, "合并导入", "行政班")
	if sheet == "" {
		// 单工作表且表头含「行政班」+「学生姓名」时按单表解析（兼容自定义表名）。
		if sheets := book.GetSheetList(); len(sheets) == 1 {
			raw, err := book.GetRows(sheets[0])
			if err == nil && len(raw) > 0 {
				index := wsHeaderIndex(raw[0])
				if wsFirstIndex(index, "行政班", "班级名称") >= 0 &&
					wsFirstIndex(index, "学生姓名", "姓名") >= 0 {
					sheet = sheets[0]
				}
			}
		}
	}
	if sheet == "" {
		return nil, nil
	}
	raw, err := book.GetRows(sheet)
	if err != nil || len(raw) < 2 {
		return nil, nil
	}
	index := wsHeaderIndex(raw[0])
	classIdx := wsFirstIndex(index, "行政班", "班级名称")
	if classIdx < 0 {
		return nil, nil
	}
	studentIdx := wsFirstIndex(index, "学生姓名", "姓名")
	if studentIdx < 0 {
		return nil, []wsExcelFailure{{Row: sheet, Reason: "缺少「学生姓名」列"}}
	}
	sectionIdx := wsFirstIndex(index, "学部（代码或名称）", "学部", "年级")
	yearIdx := wsFirstIndex(index, "届（如2024）", "届别", "届")
	smallIdx := wsFirstIndex(index, "小班", "小班名称", "所属小班")
	teacherIdx := wsFirstIndex(index, "授课教师（多个用；分隔）", "授课教师", "教师")
	typeIdx := wsFirstIndex(index, "类型（正课/选修）", "类型")
	aiIdx := wsFirstIndex(index, "AI课堂（是/否）", "AI课堂", "AI")
	htmlIdx := wsFirstIndex(index, "HTML实验室（是/否）", "HTML实验室", "HTML")

	result := make([]wsUnifiedRow, 0, len(raw)-1)
	for rowIndex, row := range raw[1:] {
		className := wsNormalizeCell(wsCell(row, classIdx))
		studentName := wsNormalizeCell(wsCell(row, studentIdx))
		smallName := wsNormalizeCell(wsCell(row, smallIdx))
		if className == "" && studentName == "" && smallName == "" {
			continue
		}
		item := wsUnifiedRow{
			Row:         strconv.Itoa(rowIndex + 2),
			ClassName:   className,
			SmallName:   smallName,
			StudentName: studentName,
			Type:        wsNormalizeCell(wsCell(row, typeIdx)),
			Teachers:    splitWsCellRefs(wsCell(row, teacherIdx)),
			// 指针仅在列填写了可解析值时赋值，缺列/留空保持 nil（沿用默认）。
			AiEnabled:   parseWsExcelBoolPtr(wsCell(row, aiIdx)),
			HtmlEnabled: parseWsExcelBoolPtr(wsCell(row, htmlIdx)),
		}
		if sectionIdx >= 0 {
			item.SectionRef = wsNormalizeCell(wsCell(row, sectionIdx))
		}
		if yearIdx >= 0 {
			item.EntryYear, _ = parseWsExcelYear(wsCell(row, yearIdx))
		}
		result = append(result, item)
	}
	return result, nil
}

// expandWsUnifiedRows 把单表行展开为「班级行 + 小班行 + 学生行」三组，
// 复用旧版多工作表的执行逻辑：
//   - 班级行：同一行政班首次出现时携带学部与届（后续留空行沿用）
//   - 小班行：同一小班首次出现时携带教师/类型/开关；所属行政班由
//     所有出现过该小班名的行政班列去重合并（跨班小班用「行政班；行政班」）
//   - 学生行：学生列非空的行，按当前行政班归属，小班列留空则只入行政班
//
// 小班行的 ClassName 用分号拼接的多个行政班名，执行段按名解析为 id 列表。
func expandWsUnifiedRows(rows []wsUnifiedRow) (classes []wsExcelClassRow, smalls []wsExcelSmallClassRow, students []wsExcelStudentRow, failures []wsExcelFailure) {
	// 行政班首次出现行携带的学部/届，用于后续留空行继承。
	type classMeta struct {
		section string
		year    int
	}
	seenClass := make(map[string]classMeta)
	// 小班归并：名称 → 行政班名集合（保序去重）与首次配置。
	seenSmall := make(map[string]*wsExcelSmallClassRow)
	smallParents := make(map[string][]string)

	for _, row := range rows {
		if row.ClassName == "" {
			// 学生列有值但未写行政班：报错，避免建号无归属。
			if row.StudentName != "" {
				failures = append(failures, wsExcelFailure{
					Row:    row.Row,
					Reason: "填写了学生姓名但「行政班」为空，请在该行补填行政班名称",
				})
			}
			continue
		}
		key := wsNormalizeClassName(row.ClassName)
		// ---- 班级行：首次出现时携带学部与届 ----
		if meta, ok := seenClass[key]; ok {
			_ = meta
		} else {
			seenClass[key] = classMeta{section: row.SectionRef, year: row.EntryYear}
			classes = append(classes, wsExcelClassRow{
				Name:       row.ClassName,
				SectionRef: row.SectionRef,
				EntryYear:  row.EntryYear,
			})
		}
		// ---- 小班行：归并所属行政班，首次出现行携带配置 ----
		if row.SmallName != "" {
			smallKey := wsNormalizeClassName(row.SmallName)
			// 行政班列表去重追加。
			parents := smallParents[smallKey]
			duplicated := false
			for _, parent := range parents {
				if wsNormalizeClassName(parent) == key {
					duplicated = true
					break
				}
			}
			if !duplicated {
				smallParents[smallKey] = append(parents, row.ClassName)
			}
			if item, ok := seenSmall[smallKey]; ok {
				// 后续行可补充教师/开关；已有非空值不覆盖。
				for _, teacher := range row.Teachers {
					exists := false
					for _, have := range item.Teachers {
						if wsNormalizeClassName(have) == wsNormalizeClassName(teacher) {
							exists = true
							break
						}
					}
					if !exists {
						item.Teachers = append(item.Teachers, teacher)
					}
				}
				if item.Type == "" {
					item.Type = row.Type
				}
				if item.AiEnabled == nil {
					item.AiEnabled = row.AiEnabled
				}
				if item.HtmlEnabled == nil {
					item.HtmlEnabled = row.HtmlEnabled
				}
			} else {
				item := &wsExcelSmallClassRow{
					Name:        row.SmallName,
					Type:        row.Type,
					Teachers:    append([]string{}, row.Teachers...),
					AiEnabled:   row.AiEnabled,
					HtmlEnabled: row.HtmlEnabled,
				}
				seenSmall[smallKey] = item
			}
		}
		// ---- 学生行 ----
		if row.StudentName != "" {
			// 届别未填时从同班其他行继承（典型：学生行留空）。
			entryYear := row.EntryYear
			if entryYear <= 0 {
				entryYear = seenClass[key].year
			}
			sectionRef := row.SectionRef
			if sectionRef == "" {
				sectionRef = seenClass[key].section
			}
			students = append(students, wsExcelStudentRow{
				Row:           row.Row,
				ClassName:     row.ClassName,
				DisplayName:   row.StudentName,
				EntryYear:     entryYear,
				SectionRef:    sectionRef,
				SmallClassRef: row.SmallName,
				// 单表模板不提供拼音/密码列：拼音按姓名自动生成，密码走默认值。
			})
		}
	}
	// 小班行：所属行政班 = 出现过该小班名的行政班（；分隔，执行段按名解析）。
	for key, item := range seenSmall {
		item.Parents = smallParents[key]
		smalls = append(smalls, *item)
	}
	return classes, smalls, students, failures
}

func wsHeaderIndex(header []string) map[string]int {
	index := make(map[string]int, len(header))
	for i, value := range header {
		index[wsNormalizeCell(value)] = i
	}
	return index
}

// wsFirstIndex 返回第一个命中的列下标，未命中返回 -1。
func wsFirstIndex(index map[string]int, names ...string) int {
	for _, name := range names {
		if at, ok := index[name]; ok {
			return at
		}
	}
	return -1
}

func wsCell(row []string, index int) string {
	if index < 0 || index >= len(row) {
		return ""
	}
	return row[index]
}

// parseWsExcelBoolPtr 解析 Excel 布尔列（是/否、Y/N、1/0、true/false、开/关）。
// 列缺失、留空或无法识别时返回 nil，调用方据此保持默认值。
func parseWsExcelBoolPtr(raw string) *bool {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil
	}
	lower := strings.ToLower(value)
	var result bool
	switch lower {
	case "是", "y", "yes", "true", "1", "开", "on":
		result = true
	case "否", "n", "no", "false", "0", "关", "off":
		result = false
	default:
		return nil
	}
	return &result
}
