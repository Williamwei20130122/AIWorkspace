package setting

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// WorkspacePricingKey 单次计费与上游成本定价规则的配置项。
const WorkspacePricingKey = "WorkspacePricing"

// WorkspaceHtmlThinkingEffortKey HTML 编程实验室默认思考强度的配置项。
const WorkspaceHtmlThinkingEffortKey = "WorkspaceHtmlThinkingEffort"

// WorkspaceSlideThinkingEffortKey 演示实验室默认思考强度的配置项。
const WorkspaceSlideThinkingEffortKey = "WorkspaceSlideThinkingEffort"

// workspaceThinkingEfforts 思考强度的合法取值（reasoning_effort 标准档位）。
var workspaceThinkingEfforts = []string{"none", "minimal", "low", "medium", "high"}

// WorkspaceThinkingEffortOptions 思考强度下拉的可选值；首项为空表示「跟随模型默认」。
func WorkspaceThinkingEffortOptions() []string {
	options := make([]string, 0, len(workspaceThinkingEfforts)+1)
	options = append(options, "")
	return append(options, workspaceThinkingEfforts...)
}

// NormalizeWorkspaceThinkingEffort 校验并归一化思考强度；空串表示不注入（跟随模型默认）。
func NormalizeWorkspaceThinkingEffort(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	for _, one := range workspaceThinkingEfforts {
		if one == value {
			return one
		}
	}
	return ""
}

// GetWorkspaceHtmlThinkingEffort 返回 HTML 实验室默认思考强度，空串表示不注入。
func GetWorkspaceHtmlThinkingEffort() string {
	common.OptionMapRWMutex.RLock()
	raw := ""
	if common.OptionMap != nil {
		raw = common.OptionMap[WorkspaceHtmlThinkingEffortKey]
	}
	common.OptionMapRWMutex.RUnlock()
	return NormalizeWorkspaceThinkingEffort(raw)
}

// GetWorkspaceSlideThinkingEffort 返回演示实验室默认思考强度，空串表示不注入。
func GetWorkspaceSlideThinkingEffort() string {
	common.OptionMapRWMutex.RLock()
	raw := ""
	if common.OptionMap != nil {
		raw = common.OptionMap[WorkspaceSlideThinkingEffortKey]
	}
	common.OptionMapRWMutex.RUnlock()
	return NormalizeWorkspaceThinkingEffort(raw)
}

// DefaultWorkspacePointsPerCall 单次消耗点数的统一默认值（按能力统一，默认 5 点）。
const DefaultWorkspacePointsPerCall = 5

// 计价单位枚举：管理端以下拉方式选择，不接受自由文本，避免同一单位被写成多种叫法。
const (
	WorkspaceUnitCall   = "次"
	WorkspaceUnitImage  = "张"
	WorkspaceUnitSong   = "首"
	WorkspaceUnitMinute = "分钟"
	WorkspaceUnitKToken = "千token"
)

// WorkspaceUnitOptions 计价单位下拉的可选值。
func WorkspaceUnitOptions() []string {
	return []string{
		WorkspaceUnitCall,
		WorkspaceUnitImage,
		WorkspaceUnitSong,
		WorkspaceUnitMinute,
		WorkspaceUnitKToken,
	}
}

// DefaultWorkspaceUnitForKind 按能力类型给出默认计价单位建议。
func DefaultWorkspaceUnitForKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case "text", "html", "slide":
		return WorkspaceUnitKToken
	case "tts":
		return WorkspaceUnitMinute
	case "music":
		return WorkspaceUnitSong
	case "image", "edit":
		return WorkspaceUnitImage
	default:
		return WorkspaceUnitCall
	}
}

// normalizeWorkspaceUnit 归一化计价单位；非枚举值返回空串，由调用方决定回落。
func normalizeWorkspaceUnit(unit string) string {
	unit = strings.TrimSpace(unit)
	for _, one := range WorkspaceUnitOptions() {
		if one == unit {
			return one
		}
	}
	return ""
}

// WorkspacePriceTier 阶梯单价：用量不超过 Upto（含）时适用 Price；Upto <= 0 表示不限。
// 用于「图片按分辨率区间」「声音按时长区间」等分档计价。
type WorkspacePriceTier struct {
	Upto  float64 `json:"upto"`
	Price float64 `json:"price"`
}

// WorkspaceCapabilityCost 按生成能力(kind)统一配置的单次消耗点数。
// 同类能力的全部模型共用同一个点数，默认 5 点。
type WorkspaceCapabilityCost struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Points int    `json:"points"`
}

// WorkspaceModelPricing 按「模型 × 功能」独立配置的计价信息。
// 同一模型的不同功能计价单位与上游单价不同（图片按张、声音按分钟、文本按千 token），
// 因此必须按模型与功能的组合逐个设置，不能只按模型统一计价。
type WorkspaceModelPricing struct {
	Model     string               `json:"model"`
	Kind      string               `json:"kind"`       // 生成能力(kind)：同一模型的不同功能分别定价
	Unit      string               `json:"unit"`       // 计价单位（枚举：次/张/首/分钟/千token）
	UnitPrice float64              `json:"unit_price"` // 上游单价（元/单位）
	BaseUnits float64              `json:"base_units"` // 每次生成默认计量数量（无实际用量时的兜底）
	Tiers     []WorkspacePriceTier `json:"tiers,omitempty"`
}

// WorkspacePricingConfig 定价规则总配置：点数按能力统一，折算金额/单位/上游单价按模型独立。
type WorkspacePricingConfig struct {
	Kinds  []WorkspaceCapabilityCost `json:"kinds"`
	Models []WorkspaceModelPricing   `json:"models"`
}

// defaultWorkspaceCapabilityCosts 六种生成能力的默认单次消耗点数（统一 5 点）。
func defaultWorkspaceCapabilityCosts() []WorkspaceCapabilityCost {
	metas := workspaceKindMetas()
	items := make([]WorkspaceCapabilityCost, 0, len(metas))
	for _, meta := range metas {
		items = append(items, WorkspaceCapabilityCost{
			Kind:   meta.Kind,
			Name:   meta.Name,
			Points: DefaultWorkspacePointsPerCall,
		})
	}
	return items
}

// DefaultWorkspacePricing 返回内置默认定价规则。
func DefaultWorkspacePricing() WorkspacePricingConfig {
	return WorkspacePricingConfig{
		Kinds:  defaultWorkspaceCapabilityCosts(),
		Models: []WorkspaceModelPricing{},
	}
}

// normalizeKindCosts 保证六种能力都有定价项，并修正历史脏值（乱码名称 / 负数点数）。
// 存储里已显式配置的能力保留其点数（允许 0 表示免费）；缺失的能力补默认 5 点。
func normalizeKindCosts(costs []WorkspaceCapabilityCost) []WorkspaceCapabilityCost {
	byKind := make(map[string]WorkspaceCapabilityCost, len(costs))
	for _, one := range costs {
		kind := strings.TrimSpace(one.Kind)
		if kind == "" || !isWorkspaceKind(kind) {
			continue
		}
		one.Kind = kind
		byKind[kind] = one
	}
	metas := workspaceKindMetas()
	result := make([]WorkspaceCapabilityCost, 0, len(metas))
	for _, meta := range metas {
		item, ok := byKind[meta.Kind]
		item.Kind = meta.Kind
		if strings.TrimSpace(item.Name) == "" || strings.Contains(item.Name, "?") {
			item.Name = meta.Name
		}
		if item.Points < 0 {
			item.Points = 0
		}
		if !ok {
			item.Points = DefaultWorkspacePointsPerCall
		}
		result = append(result, item)
	}
	return result
}

// legacyWorkspacePricingItem 旧版按「功能」定价的结构（无模型维度），仅用于读取迁移。
type legacyWorkspacePricingItem struct {
	Id     string `json:"id"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Points int    `json:"points"`
}

// GetWorkspacePricing 读取定价规则，未配置时回落默认值。
// 兼容早期只有 items（按功能定价）的结构：把点数迁移到能力维度，模型维度留空待配置。
func GetWorkspacePricing() WorkspacePricingConfig {
	common.OptionMapRWMutex.RLock()
	raw := ""
	if common.OptionMap != nil {
		raw = common.OptionMap[WorkspacePricingKey]
	}
	common.OptionMapRWMutex.RUnlock()

	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DefaultWorkspacePricing()
	}
	var cfg WorkspacePricingConfig
	if err := common.UnmarshalJsonStr(raw, &cfg); err != nil {
		return DefaultWorkspacePricing()
	}
	if len(cfg.Kinds) == 0 {
		var legacy struct {
			Items []legacyWorkspacePricingItem `json:"items"`
		}
		if err := common.UnmarshalJsonStr(raw, &legacy); err == nil {
			kinds := make([]WorkspaceCapabilityCost, 0, len(legacy.Items))
			for _, one := range legacy.Items {
				kind := strings.TrimSpace(one.Kind)
				if kind == "" {
					kind = strings.TrimSpace(one.Id)
				}
				if kind == "" {
					continue
				}
				kinds = append(kinds, WorkspaceCapabilityCost{Kind: kind, Name: one.Name, Points: one.Points})
			}
			cfg.Kinds = kinds
		}
	}
	cfg.Kinds = normalizeKindCosts(cfg.Kinds)

	models := make([]WorkspaceModelPricing, 0, len(cfg.Models))
	for _, item := range cfg.Models {
		item.Model = strings.TrimSpace(item.Model)
		if item.Model == "" {
			continue
		}
		item.Kind = strings.TrimSpace(item.Kind)
		// 无法识别的功能直接丢弃，避免历史脏值参与计价。
		if item.Kind != "" && !isWorkspaceKind(item.Kind) {
			continue
		}
		if unit := normalizeWorkspaceUnit(item.Unit); unit != "" {
			item.Unit = unit
		}
		models = append(models, item)
	}
	cfg.Models = models
	return cfg
}

// GetWorkspacePointsForKind 返回某能力统一的单次消耗点数。
func GetWorkspacePointsForKind(kind string) int {
	kind = strings.TrimSpace(kind)
	for _, item := range GetWorkspacePricing().Kinds {
		if item.Kind == kind {
			return item.Points
		}
	}
	return DefaultWorkspacePointsPerCall
}

// GetWorkspaceModelPricing 按「模型 × 功能」查该组合独立的计价信息。
// 兼容历史数据：kind 为空的旧记录按模型级兜底，该模型的任一功能都可使用。
func GetWorkspaceModelPricing(modelName, kind string) (WorkspaceModelPricing, bool) {
	modelName = strings.TrimSpace(modelName)
	kind = strings.TrimSpace(kind)
	if modelName == "" {
		return WorkspaceModelPricing{}, false
	}
	var fallback WorkspaceModelPricing
	hasFallback := false
	for _, item := range GetWorkspacePricing().Models {
		if item.Model != modelName {
			continue
		}
		if kind != "" && item.Kind == kind {
			return item, true
		}
		if item.Kind == "" && !hasFallback {
			fallback = item
			hasFallback = true
		}
	}
	return fallback, hasFallback
}

// WorkspaceResolvedPricing 一次生成实际适用的计费信息：
// 点数取「能力」配置，折算金额 / 计价单位 / 上游单价取「模型」配置。
type WorkspaceResolvedPricing struct {
	Kind      string
	Name      string
	Model     string
	Points    int
	Unit      string
	UnitPrice float64
	BaseUnits float64
	Tiers     []WorkspacePriceTier
}

// WorkspaceAutoPricing 自动换算出的上游单价及其倍率明细。
type WorkspaceAutoPricing struct {
	UnitPrice       float64 `json:"unit_price"`
	ModelRatio      float64 `json:"model_ratio"`
	CompletionRatio float64 `json:"completion_ratio"`
	ExchangeRate    float64 `json:"exchange_rate"`
}

// WorkspaceAutoPricingFor 依据「模型倍率 / 补全倍率 × 汇率」自动换算上游单价（元/单位）：
//   - 文本类（千 token）：模型倍率 × $0.002 × 汇率；
//   - 其它按次类：优先取模型价格（美元/次）× 汇率，缺失时回落到倍率换算。
//
// 管理端不再手工填写单价，换算结果仅用于对账展示与成本折算。
func WorkspaceAutoPricingFor(kind, modelName string) WorkspaceAutoPricing {
	info := WorkspaceAutoPricing{ExchangeRate: operation_setting.USDExchangeRate}
	if info.ExchangeRate <= 0 {
		info.ExchangeRate = 7.3
	}
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return info
	}
	if ratio, ok, _ := ratio_setting.GetModelRatio(modelName); ok && ratio > 0 {
		info.ModelRatio = ratio
	}
	info.CompletionRatio = ratio_setting.GetCompletionRatio(modelName)
	switch strings.TrimSpace(kind) {
	case "text", "html", "slide":
		info.UnitPrice = info.ModelRatio * 0.002 * info.ExchangeRate
	default:
		if price, ok := ratio_setting.GetModelPrice(modelName, false); ok && price > 0 {
			info.UnitPrice = price * info.ExchangeRate
		} else if info.ModelRatio > 0 {
			info.UnitPrice = info.ModelRatio * 0.002 * info.ExchangeRate
		}
	}
	return info
}

// WorkspaceAutoUnitPrice 返回自动换算出的上游单价；0 表示该模型未配置倍率/价格。
func WorkspaceAutoUnitPrice(kind, modelName string) float64 {
	return WorkspaceAutoPricingFor(kind, modelName).UnitPrice
}

// ResolveWorkspacePricing 合成一次生成的点数与计价信息；模型未配置时回落默认值。
// 上游单价优先由模型倍率自动换算，换算不出时回落到历史保存的配置值。
func ResolveWorkspacePricing(kind, modelName string) WorkspaceResolvedPricing {
	kind = strings.TrimSpace(kind)
	name := ""
	for _, item := range GetWorkspacePricing().Kinds {
		if item.Kind == kind {
			name = item.Name
			break
		}
	}
	resolved := WorkspaceResolvedPricing{
		Kind:      kind,
		Name:      name,
		Model:     strings.TrimSpace(modelName),
		Points:    GetWorkspacePointsForKind(kind),
		Unit:      DefaultWorkspaceUnitForKind(kind),
		UnitPrice: WorkspaceAutoUnitPrice(kind, modelName),
		BaseUnits: 1,
	}
	if item, ok := GetWorkspaceModelPricing(resolved.Model, kind); ok {
		if unit := normalizeWorkspaceUnit(item.Unit); unit != "" {
			resolved.Unit = unit
		}
		if resolved.UnitPrice <= 0 {
			resolved.UnitPrice = item.UnitPrice
		}
		if item.BaseUnits > 0 {
			resolved.BaseUnits = item.BaseUnits
		}
		resolved.Tiers = item.Tiers
	}
	return resolved
}

// CostYuan 按上游单价与实际用量（含阶梯价）折算一次生成的金额（元）。
func (p WorkspaceResolvedPricing) CostYuan(units float64) float64 {
	if units <= 0 {
		units = p.BaseUnits
	}
	price := p.UnitPrice
	if len(p.Tiers) > 0 {
		matched := false
		for _, tier := range p.Tiers {
			if tier.Upto <= 0 || units <= tier.Upto {
				price = tier.Price
				matched = true
				break
			}
		}
		if !matched {
			price = p.Tiers[len(p.Tiers)-1].Price
		}
	}
	return units * price
}

// WorkspacePricing2JsonString 序列化默认定价规则，供初始化写入 OptionMap。
func WorkspacePricing2JsonString() string {
	encoded, err := common.Marshal(DefaultWorkspacePricing())
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

// NormalizeWorkspacePricing 校验并归一化定价规则，返回可持久化的 JSON。
func NormalizeWorkspacePricing(cfg WorkspacePricingConfig) (string, error) {
	cfg.Kinds = normalizeKindCosts(cfg.Kinds)

	seen := make(map[string]bool, len(cfg.Models))
	models := make([]WorkspaceModelPricing, 0, len(cfg.Models))
	for _, item := range cfg.Models {
		item.Model = strings.TrimSpace(item.Model)
		if item.Model == "" {
			continue
		}
		item.Kind = strings.TrimSpace(item.Kind)
		if item.Kind != "" && !isWorkspaceKind(item.Kind) {
			continue
		}
		// 同一模型的不同功能是独立计价项，按「模型 + 功能」去重。
		key := item.Model + "\x00" + item.Kind
		if seen[key] {
			continue
		}
		seen[key] = true
		if unit := normalizeWorkspaceUnit(item.Unit); unit != "" {
			item.Unit = unit
		} else {
			item.Unit = WorkspaceUnitCall
		}
		if item.UnitPrice < 0 {
			item.UnitPrice = 0
		}
		if item.BaseUnits < 0 {
			item.BaseUnits = 0
		}
		tiers := make([]WorkspacePriceTier, 0, len(item.Tiers))
		for _, tier := range item.Tiers {
			if tier.Price < 0 {
				tier.Price = 0
			}
			tiers = append(tiers, tier)
		}
		item.Tiers = tiers
		models = append(models, item)
	}
	cfg.Models = models

	encoded, err := common.Marshal(cfg)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// RemoveWorkspaceModelPricing 从定价规则里剔除指定模型的全部功能计价，
// 模型被删除时调用，避免已删除模型的「模型 × 功能」计价仍被展示或参与核算。
func RemoveWorkspaceModelPricing(modelNames []string) (string, error) {
	drop := make(map[string]struct{}, len(modelNames))
	for _, name := range modelNames {
		if name = strings.TrimSpace(name); name != "" {
			drop[name] = struct{}{}
		}
	}
	if len(drop) == 0 {
		return "", nil
	}
	cfg := GetWorkspacePricing()
	models := make([]WorkspaceModelPricing, 0, len(cfg.Models))
	for _, item := range cfg.Models {
		if _, ok := drop[item.Model]; ok {
			continue
		}
		models = append(models, item)
	}
	cfg.Models = models
	return NormalizeWorkspacePricing(cfg)
}
