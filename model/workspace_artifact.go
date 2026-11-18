package model

import (
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// WorkspaceArtifact 云端素材：中台生成链路落盘的成品文件索引。
//
// 设计要点：
//   - StoragePath 为相对素材根目录的路径（见 service/artifactstore），跨机器可迁移。
type WorkspaceArtifact struct {
	Id        int   `json:"id" gorm:"primaryKey;autoIncrement"`
	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime;index:idx_ws_artifact_created"`
	UserId    int   `json:"user_id" gorm:"index:idx_ws_artifact_user"`
	ClassId   int   `json:"class_id" gorm:"index:idx_ws_artifact_class"`
	// LessonId 归属课次（上课模式的课 id）；0 表示非上课时段生成。
	LessonId int `json:"lesson_id" gorm:"index:idx_ws_artifact_lesson"`
	// ShareClassId 班级共享素材：>0 表示该素材共享给指定班级全体师生，0 为个人素材。
	ShareClassId int `json:"share_class_id" gorm:"index:idx_ws_artifact_share"`
	// Kind 能力类型：text / image / edit / tts / video / music。
	Kind string `json:"kind" gorm:"type:varchar(16);index"`
	// Model 实际使用的模型名。
	Model string `json:"model" gorm:"type:varchar(128)"`
	// Prompt 生成时提交的提示词（截断保存）。
	Prompt string `json:"prompt" gorm:"type:varchar(500)"`
	// StoragePath 相对素材根目录的存储路径。
	StoragePath string `json:"storage_path" gorm:"type:varchar(512);index"`
	// MimeType 文件类型。
	MimeType string `json:"mime_type" gorm:"type:varchar(128)"`
	// SizeBytes 文件大小（字节）。
	SizeBytes int64 `json:"size_bytes"`
	// SourceURL 上游返回的原始地址（图片/视频/音乐），便于回溯。
	SourceURL string `json:"source_url" gorm:"type:text"`
	// FilePurged 文件是否已被自动清理：清理后记录保留，但禁止预览与下载。
	FilePurged bool `json:"file_purged" gorm:"default:false;index"`
	// PurgedAt 文件清理时间（秒），0 表示未清理。
	PurgedAt int64 `json:"purged_at" gorm:"default:0"`

	// 展示用，不入库
	UserName    string `json:"user_name" gorm:"-"`
	ClassName   string `json:"class_name" gorm:"-"`
	LessonTopic string `json:"lesson_topic" gorm:"-"`
}

func InsertWorkspaceArtifact(artifact *WorkspaceArtifact) error {
	if artifact == nil {
		return nil
	}
	if artifact.CreatedAt == 0 {
		artifact.CreatedAt = common.GetTimestamp()
	}
	return DB.Create(artifact).Error
}

// WorkspaceArtifactQuery 素材查询条件。
type WorkspaceArtifactQuery struct {
	UserId   int
	ClassId  int
	LessonId int
	Kind     string
	// ShareClassId >0 时只返回共享给该班级的素材；SharedOnly 时只看共享素材。
	ShareClassId int
	SharedOnly   bool
	// ExcludeKind 非空时排除该类型（云端素材页默认排除参考素材 kind=input）。
	ExcludeKind string
	// UserIds 非 nil 时只返回这些用户的素材（教师维度权限过滤）。
	UserIds        []int
	StartTimestamp int64
	EndTimestamp   int64
}

func (q WorkspaceArtifactQuery) apply(tx *gorm.DB) *gorm.DB {
	if q.UserId > 0 {
		tx = tx.Where("user_id = ?", q.UserId)
	}
	// 班级共享素材：共享范围按 share_class_id 判定，不再按素材归属学生换算。
	if q.ShareClassId > 0 {
		tx = tx.Where("share_class_id = ?", q.ShareClassId)
	} else if q.ClassId > 0 {
		tx = tx.Where("class_id = ?", q.ClassId)
	}
	if q.SharedOnly {
		tx = tx.Where("share_class_id > 0")
	}
	if q.LessonId > 0 {
		tx = tx.Where("lesson_id = ?", q.LessonId)
	}
	if q.Kind != "" {
		tx = tx.Where("kind = ?", q.Kind)
	}
	if q.ExcludeKind != "" {
		tx = tx.Where("kind <> ?", q.ExcludeKind)
	}
	if q.UserIds != nil {
		if len(q.UserIds) == 0 {
			return tx.Where("1 = 0")
		}
		tx = tx.Where("user_id in (?)", q.UserIds)
	}
	if q.StartTimestamp > 0 {
		tx = tx.Where("created_at >= ?", q.StartTimestamp)
	}
	if q.EndTimestamp > 0 {
		tx = tx.Where("created_at < ?", q.EndTimestamp)
	}
	return tx
}

// ListWorkspaceArtifacts 分页查询素材（含学生姓名 / 班级名 / 课次主题）。
func ListWorkspaceArtifacts(query WorkspaceArtifactQuery, page, pageSize int) ([]*WorkspaceArtifact, int64, error) {
	tx := query.apply(DB.Model(&WorkspaceArtifact{}))
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
	var items []*WorkspaceArtifact
	if err := tx.Order("id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	fillWorkspaceArtifactDisplay(items)
	return items, total, nil
}

// AllWorkspaceArtifacts 不分页拉取素材（供批量清理与导出）。
func AllWorkspaceArtifacts(query WorkspaceArtifactQuery) ([]*WorkspaceArtifact, error) {
	var items []*WorkspaceArtifact
	err := query.apply(DB.Model(&WorkspaceArtifact{})).Order("id asc").Find(&items).Error
	return items, err
}

// AggregateWorkspaceArtifactStats 统计素材数量与占用空间（按能力分类）。
type WorkspaceArtifactStatsRow struct {
	Kind  string `json:"kind"`
	Count int    `json:"count"`
	Bytes int64  `json:"bytes"`
}

func AggregateWorkspaceArtifactStats(query WorkspaceArtifactQuery) ([]*WorkspaceArtifactStatsRow, error) {
	var rows []*WorkspaceArtifactStatsRow
	err := query.apply(DB.Model(&WorkspaceArtifact{})).
		Where("file_purged = ?", false).
		Select("kind, count(*) as count, COALESCE(sum(size_bytes),0) as bytes").
		Group("kind").
		Scan(&rows).Error
	return rows, err
}

func GetWorkspaceArtifactById(id int) (*WorkspaceArtifact, error) {
	var artifact WorkspaceArtifact
	if err := DB.First(&artifact, id).Error; err != nil {
		return nil, err
	}
	fillWorkspaceArtifactDisplay([]*WorkspaceArtifact{&artifact})
	return &artifact, nil
}

// GetWorkspaceArtifactsByIds 按 id 批量读取（教师权限过滤在控制器内完成）。
func GetWorkspaceArtifactsByIds(ids []int) ([]*WorkspaceArtifact, error) {
	items := make([]*WorkspaceArtifact, 0)
	if len(ids) == 0 {
		return items, nil
	}
	err := DB.Where("id in (?)", ids).Find(&items).Error
	return items, err
}

// DeleteWorkspaceArtifactsByIds 删除素材记录（文件删除在控制器内完成）。
func DeleteWorkspaceArtifactsByIds(ids []int) error {
	if len(ids) == 0 {
		return nil
	}
	return DB.Where("id in (?)", ids).Delete(&WorkspaceArtifact{}).Error
}

// ListExpiredWorkspaceArtifacts 列出创建时间早于 cutoff 且尚未清理文件的素材，
// 排除已被课堂作品提交引用的素材（已提交作品保留文件可下载）。
func ListExpiredWorkspaceArtifacts(cutoff int64, limit int) ([]*WorkspaceArtifact, error) {
	if cutoff <= 0 {
		return []*WorkspaceArtifact{}, nil
	}
	if limit <= 0 {
		limit = 200
	}
	items := make([]*WorkspaceArtifact, 0, limit)
	err := DB.
		Where("created_at < ? AND file_purged = ?", cutoff, false).
		Where("id NOT IN (?)", DB.Model(&WorkspaceTaskSubmission{}).Select("artifact_id").Where("artifact_id > 0")).
		Order("id asc").
		Limit(limit).
		Find(&items).Error
	return items, err
}

// MarkWorkspaceArtifactsFilePurged 标记素材文件已清理（记录保留）。
func MarkWorkspaceArtifactsFilePurged(ids []int, purgedAt int64) error {
	if len(ids) == 0 {
		return nil
	}
	return DB.Model(&WorkspaceArtifact{}).
		Where("id in (?)", ids).
		Updates(map[string]any{"file_purged": true, "purged_at": purgedAt}).Error
}

// ListWorkspaceArtifactsByUsersAndKinds 批量读取一批用户在指定能力类型下的素材，
// 供「生成记录」页面把每条记录关联到其最近的产物。
func ListWorkspaceArtifactsByUsersAndKinds(userIds []int, kinds []string) ([]*WorkspaceArtifact, error) {
	items := make([]*WorkspaceArtifact, 0)
	if len(userIds) == 0 || len(kinds) == 0 {
		return items, nil
	}
	err := DB.Where("user_id in (?) and kind in (?)", userIds, kinds).
		Order("id desc").
		Find(&items).Error
	return items, err
}

// SetWorkspaceArtifactShare 设置 / 取消素材的班级共享（shareClassId=0 取消）。
func SetWorkspaceArtifactShare(id, shareClassId int) error {
	result := DB.Model(&WorkspaceArtifact{}).Where("id = ?", id).
		Update("share_class_id", shareClassId)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return common.NewMessage("素材不存在")
	}
	return nil
}

func fillWorkspaceArtifactDisplay(items []*WorkspaceArtifact) {
	if len(items) == 0 {
		return
	}
	userIds := make([]int, 0, len(items))
	classIds := make([]int, 0, len(items))
	seenUser := map[int]bool{}
	seenClass := map[int]bool{}
	for _, item := range items {
		if item.UserId > 0 && !seenUser[item.UserId] {
			seenUser[item.UserId] = true
			userIds = append(userIds, item.UserId)
		}
		if item.ClassId > 0 && !seenClass[item.ClassId] {
			seenClass[item.ClassId] = true
			classIds = append(classIds, item.ClassId)
		}
	}
	names := map[int]string{}
	if len(userIds) > 0 {
		var students []*WorkspaceStudent
		_ = DB.Where("user_id in (?)", userIds).Find(&students).Error
		for _, student := range students {
			names[student.UserId] = student.DisplayName
		}
	}
	classNames := map[int]string{}
	if len(classIds) > 0 {
		var classes []*WorkspaceClass
		_ = DB.Where("id in (?)", classIds).Find(&classes).Error
		for _, class := range classes {
			classNames[class.Id] = class.Name
		}
	}
	for _, item := range items {
		item.UserName = names[item.UserId]
		if item.UserName == "" && item.UserId > 0 {
			if username, err := GetUsernameById(item.UserId, false); err == nil {
				item.UserName = username
			}
		}
		item.ClassName = classNames[item.ClassId]
	}
}
