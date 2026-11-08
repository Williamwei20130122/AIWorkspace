import type {
  SubmissionSummary,
  SubmitMode,
  TopicDetail,
  TopicGroup,
  TopicSummary,
} from "@/lib/types";

/**
 * v4 增量字段的局部类型：
 * lib/types.ts 目前只补了班级/分组的基础类型，课题详情与提交里的 v4 字段还没并入，
 * 这里用交叉类型兜底（Lead 后续补进 lib 后仍然兼容）。
 */

export type TeacherTopicSummary = TopicSummary & {
  className?: string | null;
};

export type TeacherTopicDetail = TopicDetail & {
  class: { id: string; name: string } | null;
  submitMode: SubmitMode;
  groupMin: number;
  groupMax: number;
  allowStudentGroups: boolean;
  groups: TopicGroup[];
};

/** 小组提交时 student 可能为空，用 group / submitter 展示提交人 */
export type TeacherSubmissionRow = SubmissionSummary & {
  group?: { id: string; name: string } | null;
  submitter?: { id: string; name: string; loginId: string } | null;
};
