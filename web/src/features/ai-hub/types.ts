/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

export interface AiHubCapability {
  id: string
  name: string
  desc: string
  kind: string
  model: string
  path: string
  qpath: string
  fmt: string
  method: string
  extend?: string
  enabled: boolean
  cost: number
  points: number
  plugin?: string
  action?: string
  models?: string[]
}

export interface AiHubCapabilityConfig {
  capabilities: AiHubCapability[]
  platform_name: string
}

/** 单个「模型 × 功能」的上游接口配置。 */
export interface AiHubModelEndpoint {
  kind: string
  /** 请求格式：openai（标准 OpenAI 格式）| json（通用 JSON 格式） */
  format?: string
  /** 上游接口路径，如 /chat/completions、/images/generations */
  path?: string
  /** 异步任务结果查询接口（可选） */
  qpath?: string
  /** 请求方法：POST | GET */
  method?: string
  /** 附加参数 JSON（对象字符串），会深合并覆盖到该功能的生成请求体 */
  extra?: string
}

// AiHubModelCapability 单个模型声明的生成能力（在模型管理里设置）。
export interface AiHubModelCapability {
  model: string
  kinds: string[]
  /** 开放范围：student | teacher | both，缺省 both */
  audience?: string
  plugin?: string
  action?: string
  /** 声音合成（tts）：该模型可选的音色标识列表，学生端据此渲染音色下拉。 */
  voices?: string[]
  /** 按「模型 × 功能」维度独立配置的上游接口参数。 */
  endpoints?: AiHubModelEndpoint[]
}

/** 学部：小学部 / 初中部 / 高中部，内部配置学制与年级阶梯。 */
export interface AiHubSection {
  id: number
  /** 学部代码，作为学生账号前缀（P / J / S）。 */
  code: string
  name: string
  /** 学制年限，如小学 6 年、初中 3 年。 */
  years: number
  /** 学年升级月份，默认 9。 */
  promote_month: number
  /** 年级阶梯名称，长度与 years 一致。 */
  grade_names: string[]
  /** 超出学制后是否自动冻结为「已毕业」。 */
  auto_graduate: boolean
  sort_order: number
  enabled: boolean
  class_count?: number
  student_num?: number
  grades?: AiHubSectionGradeStat[]
  created_at?: number
  updated_at?: number
}

export interface AiHubSectionGradeStat {
  grade_index: number
  grade_name: string
  class_count: number
  student_num: number
}

export interface AiHubClass {
  id: number
  created_at: number
  updated_at: number
  name: string
  /** 班级编号（教师可编辑），名单表格下拉用于快速区分同名班级。 */
  code: string
  description: string
  /** 所属学部 id。 */
  section_id: number
  /** 届别对应的入学年份，如 2024；0 表示未设置。 */
  entry_year: number
  enabled: boolean
  student_count?: number
  /** 展示用：学部名称与代码。 */
  section_name?: string
  section_code?: string
  /** 当前年级序号（按届别实时换算），0 表示届别未设置。 */
  grade_index?: number
  /** 当前年级显示名（如「初二」「已毕业」）。 */
  grade_name?: string
  /** 该班届别已超出学部学制年限。 */
  graduated?: boolean
}

/** 上课小班（授课分班）：从行政大班拆分学生、绑授课教师、正课/选修标记、AI 总开关。 */
export interface AiHubSmallClass {
  id: number
  created_at?: number
  updated_at?: number
  name: string
  /** 小班编码，留空自动生成 S+序号。 */
  code: string
  /** 所属行政大班 id 列表（多选）。 */
  parent_class_ids: number[]
  /** 授课教师用户 id 列表（多选）。 */
  teacher_ids: number[]
  /** regular=正课 / elective=选修。 */
  type: 'regular' | 'elective' | string
  enabled: boolean
  /** AI 权限总开关：关闭后该小班学生端隐藏全部 AI 入口且服务端拦截生成。 */
  ai_enabled: boolean
  /** HTML 实验室开关：默认关闭，需教师在小班管理中显式开启。 */
  html_enabled: boolean
  /** 演示实验室开关：默认关闭，需教师在小班管理中显式开启。 */
  slide_enabled: boolean
  /** 多选展示名，分号拼接。 */
  parent_class_name?: string
  teacher_name?: string
  member_count?: number
}

/** 小班导入 Excel 未匹配行的候选学生（供手动配对下拉）。 */
export interface AiHubSmallClassCandidate {
  student_id: number
  user_id: number
  display_name: string
  student_no: string
  class_name: string
  grade_name: string
  entry_year: number
}

export interface AiHubSmallClassMatchedRow {
  row: string
  student_id: number
  user_id: number
  display_name: string
  student_no: string
  class_name: string
  grade_name: string
}

export interface AiHubSmallClassUnmatchedRow {
  row: string
  display_name: string
  entry_year: number
  grade_ref: string
  candidates: AiHubSmallClassCandidate[]
  reason: string
}

export interface AiHubSmallClassImportResult {
  matched: AiHubSmallClassMatchedRow[]
  unmatched: AiHubSmallClassUnmatchedRow[]
  failed: { row: string; reason: string }[]
  matched_student_ids: number[]
}

/** 由学部学制推导出的年级选项（学年变化后自动跟随）。 */
export interface AiHubGradeOption {
  section_id: number
  section_name: string
  section_code: string
  grade_index: number
  grade_name: string
}

// ---------- 备课模式：年级 → 单元 → 课时 → 分项任务 ----------

export interface AiHubLessonTask {
  id: number
  lesson_id: number
  title: string
  requirement: string
  // 产出形式，逗号分隔：text / file / ai。
  output_forms: string
  // 允许上传的文件后缀白名单，逗号分隔。
  allowed_extensions: string
  max_uploads: number
  // 每位学生对该任务的提交次数上限，0 表示不限次数（无时间限制）。
  max_submits: number
  // 备课时挂到任务上的参考资料素材 id 列表（逗号分隔）。
  reference_artifacts: string
  sort_order: number
}

export interface AiHubLesson {
  id: number
  unit_id: number
  title: string
  description: string
  ai_course: boolean
  sort_order: number
  task_count?: number
  tasks?: AiHubLessonTask[]
}

export interface AiHubUnit {
  id: number
  section_id: number
  grade_index: number
  name: string
  description: string
  sort_order: number
  lesson_count?: number
  lessons?: AiHubLesson[]
}

export interface AiHubStudent {
  id: number
  user_id: number
  class_id: number
  entry_year: number
  student_no: string
  /** 小写拼音登录名，学生可用它或学号登录。 */
  pinyin_username?: string
  display_name: string
  enabled: boolean
  /** 1 在读、2 已毕业（停用）、3 已注销（毕业满一年已删除账号，仅保留名单档案）。 */
  status: number
  /** 毕业时间戳（秒），0 表示未毕业；用于计算毕业满一年后注销账号。 */
  graduated_at: number
  /** 展示用：登录名、班级名、年级名、剩余点数与已用点数。 */
  username?: string
  class_name?: string
  grade_name?: string
  quota?: number
  used_quota?: number
  /** 所属上课小班（可在学生资料里直接设置）。 */
  small_class_ids?: number[]
  small_class_names?: string[]
}

/** 学部总览：当前学年与各学部的班级/学生分布。 */
export interface AiHubSectionOverview {
  /** 当前学年，如 2026 表示 2026-2027 学年。 */
  academic_year: number
  /** 最近一次学年结转的学年，0 表示从未结转。 */
  last_rollover_academic_year: number
  items: AiHubSection[]
}

/** 教师账号：账号信息与角色状态。 */
export interface AiHubTeacherProfile {
  user_id: number
  username: string
  display_name: string
  role: number
  status: number
}

export interface AiHubUserBrief {
  id: number
  username: string
  display_name: string
  role: number
}

// AiHubTeacherWallet 教师点数钱包：每月发放配置 + 当前余额。
export interface AiHubTeacherWallet {
  id: number
  user_id: number
  balance: number
  grant_amount: number
  grant_day: number
  auto_grant: boolean
  last_grant_month: string
  username: string
  api_quota: number
}

export interface AiHubCapabilityQuota {
  id: number
  user_id: number
  capability_id: string
  quota: number
  used: number
}

export interface AiHubAccount {
  id: number
  username: string
  display_name: string
  role: number
  status: number
  quota: number
  used_quota: number
  capability_quotas: AiHubCapabilityQuota[]
}

export interface AiHubRecord {
  key: string
  source: 'sync' | 'task'
  user_id: number
  username: string
  /** 学生姓名 / 学号 / 当前班级 / 当前年级：筛选结果中用于区分重名学生。 */
  student_name?: string
  student_no?: string
  class_name?: string
  grade_name?: string
  capability: string
  model: string
  title: string
  status: string
  progress?: string
  quota: number
  /** 中台按次计费的真实扣点（来自 workspace_usages），未关联到计费明细时为 0。 */
  points?: number
  /** 本次生成提交的内容。 */
  prompt?: string
  /** 本次生成返回的内容预览（文本结果或素材地址）。 */
  result_preview?: string
  /** 关联的云端素材 id（同一学生同一能力的最近产物），无产物时为空。 */
  artifact_id?: number
  task_id?: string
  /** 本次生成的耗时（毫秒），来自计费明细；未记录时为 0/空。 */
  duration_ms?: number
  created_at: number
  fail_reason?: string
}

export interface AiHubPricingTier {
  upto: number
  price: number
}

/** 按能力(kind)统一配置的单次消耗点数，同类能力的全部模型共用。 */
export interface AiHubCapabilityCost {
  kind: string
  name: string
  points: number
}

/** 按「模型 × 功能」独立配置的计价信息：计价单位与折算规则各不相同。 */
export interface AiHubModelPricing {
  model: string
  /** 生成能力(kind)，同一模型的不同功能分别定价；历史数据可能为空。 */
  kind?: string
  unit: string
  /** 历史保存的手工单价，仅作回落；实际计价以 auto_pricing 自动换算为准。 */
  unit_price: number
  base_units: number
  tiers?: AiHubPricingTier[]
  /** 由「模型倍率 / 补全倍率 × 汇率」自动换算出的上游单价（只读）。 */
  auto_pricing?: {
    unit_price: number
    model_ratio: number
    completion_ratio: number
    exchange_rate: number
  }
}

export interface AiHubPricingConfig {
  kinds: AiHubCapabilityCost[]
  models: AiHubModelPricing[]
  unit_options: string[]
  platform_name: string
  /** HTML 实验室默认思考强度（空串表示跟随模型默认） */
  html_thinking_effort: string
  /** 演示实验室默认思考强度（空串表示跟随模型默认） */
  slide_thinking_effort: string
  /** 思考强度可选档位（首项为空表示跟随模型默认） */
  thinking_effort_options: string[]
}

export interface AiHubReconcileUserRow {
  user_id: number
  username: string
  class_id: number
  class_name: string
  count: number
  points: number
  amount_yuan: number
  cost_yuan: number
}

export interface AiHubReconcileClassRow {
  class_id: number
  class_name: string
  count: number
  points: number
  amount_yuan: number
  cost_yuan: number
}

export interface AiHubReconcileTotal {
  count: number
  points: number
  amount_yuan: number
  cost_yuan: number
  diff_yuan: number
}

export interface AiHubReconcileTeacherRow {
  teacher_id: number
  teacher_name: string
  count: number
  points: number
  amount_yuan: number
  cost_yuan: number
}

export interface AiHubReconciliation {
  month: string
  start_timestamp: number
  end_timestamp: number
  total: AiHubReconcileTotal
  by_user: AiHubReconcileUserRow[]
  by_class: AiHubReconcileClassRow[]
  by_teacher: AiHubReconcileTeacherRow[]
}

export interface PageResult<T> {
  page: number
  page_size: number
  total: number
  items: T[]
}

export const CAPABILITY_KIND_LABEL: Record<string, string> = {
  text: '文生文',
  image: '文生图',
  edit: '图生图',
  tts: '声音合成',
  video: '视频生成',
  music: '音乐生成',
  html: 'HTML 编程',
  slide: '演示文稿',
}

/** 云端素材：学生在中台生成并落盘的一份成品文件。 */
export interface AiHubArtifact {
  id: number
  created_at: number
  user_id: number
  class_id: number
  // share_class_id 班级共享素材：>0 表示共享给该班级，0 为个人素材。
  share_class_id: number
  kind: string
  model: string
  prompt: string
  storage_path: string
  mime_type: string
  size_bytes: number
  source_url: string
  user_name: string
  class_name: string
  // file_purged 文件是否已被自动清理：记录保留但禁止预览与下载。
  file_purged: boolean
  // purged_at 文件清理时间（秒），0 表示未清理。
  purged_at: number
}

/** 云端素材统计：某一类型的数量与占用空间。 */
export interface AiHubArtifactStats {
  kind: string
  count: number
  bytes: number
}

/** 云端素材列表接口返回值。 */
export interface AiHubArtifactListResult {
  items: AiHubArtifact[]
  total: number
  stats: AiHubArtifactStats[]
}

/** 模型能力的开放范围选项。 */
export const AUDIENCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'both', label: '学生和教师都可选' },
  { value: 'student', label: '仅学生可选' },
  { value: 'teacher', label: '仅教师可选' },
]
