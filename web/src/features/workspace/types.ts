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

export type WorkspaceCapabilityKind =
  | 'text'
  | 'image'
  | 'edit'
  | 'tts'
  | 'video'
  | 'music'

export interface WorkspaceCapability {
  id: string
  name: string
  desc: string
  kind: WorkspaceCapabilityKind
  model: string
  path: string
  qpath: string
  fmt: string
  enabled: boolean
  cost: number
  points: number
  plugin?: string
  action?: string
  models?: string[]
  /** 声音合成（tts）：全部可用模型音色的并集。 */
  voices?: string[]
  /** 声音合成（tts）：按模型分组的可选音色，供「所选模型 → 音色下拉」联动。 */
  model_voices?: Record<string, string[]>
  /** 按模型分组的结果查询接口，轮询异步任务时按所选模型取地址。 */
  model_qpaths?: Record<string, string>
  /** 按模型分组的异步标识：true 表示异步生成模型，提交后须等待任务完成。 */
  model_async?: Record<string, boolean>
}

export interface WorkspaceTask {
  task_id: string
  platform: string
  status: string
  progress: string
  fail_reason?: string
  created_at: number
  finished_at: number
}

/** 课堂会话：教师把某个小班的课时分发后形成的当前课。 */
export interface WorkspaceClassSession {
  id: number
  created_at: number
  updated_at: number
  small_class_id: number
  lesson_id: number
  unit_id: number
  section_id: number
  grade_index: number
  teacher_id: number
  status: string
  started_at: number
  ended_at: number
  /** 本节课主题：分发时默认课时标题，教师可改。 */
  theme?: string
  lesson_title?: string
  unit_name?: string
  small_class_name?: string
  small_class_code?: string
  ai_course?: boolean
  task_count?: number
  submission_count?: number
  my_submission_count?: number
}

/** 课堂任务的产出形式：text 文字 / file 文件 / ai AI 作品。 */
export type WorkspaceTaskOutputForm = 'text' | 'file' | 'ai'

export interface WorkspaceTaskSubmission {
  id: number
  created_at: number
  session_id: number
  task_id: number
  user_id: number
  content_type: string
  text_content?: string
  file_name?: string
  artifact_id?: number
  mime_type?: string
  size_bytes?: number
  asset_url?: string
  capability?: string
  prompt?: string
  result_text?: string
  task_title?: string
  student_name?: string
}

export interface WorkspaceClassSessionTask {
  id: number
  title: string
  requirement: string
  output_forms: string
  allowed_extensions: string
  max_uploads: number
  // 每位学生对该任务的提交次数上限，0 表示不限次数。
  max_submits: number
  // 备课挂载的参考资料素材 id 列表（逗号分隔）。
  reference_artifacts: string
  // 参考资料摘要（服务端解析素材 id 后返回，可直接展示与访问）。
  references: WorkspaceTaskReference[]
  sort_order: number
  my_submissions: WorkspaceTaskSubmission[]
}

/** 任务参考资料摘要：备课时挂载给学生参考的共享素材。 */
export interface WorkspaceTaskReference {
  id: number
  name: string
  kind: string
  mime_type: string
  size_bytes: number
  // 受鉴权的素材内容地址，点击即可预览/下载。
  url: string
  // 素材已被删除：仅占位提示。
  missing: boolean
}
