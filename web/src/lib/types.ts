/** 与后端 v3 JSON 契约（docs/CONTRACT.md 第 6 节）一一对应的类型 */

export type Role = "TEACHER" | "STUDENT" | "ADMIN";
export type TopicStatus = "ACTIVE" | "CLOSED";

export interface User {
  id: string;
  loginId: string;
  name: string;
  role: Role;
  avatarColor: string;
  hasPassword: boolean;
}

export interface ManagedStudent {
  id: string;
  name: string;
  loginId: string;
  hasPassword: boolean;
  createdAt: string;
}

export interface TopicSummary {
  id: string;
  title: string;
  status: TopicStatus;
  joinMode: string;
  className?: string;
  owner: { id: string; name: string };
  isOwner: boolean;
  memberCount: number;
  submissionCount: number;
  pendingCount: number;
  updatedAt: string;
}

/** GET /api/teacher/topics 分页响应 */
export interface TopicPage {
  items: TopicSummary[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    active: number;
    closed: number;
    pendingTotal: number;
  };
}

export interface TopicStudent {
  id: string;
  name: string;
  loginId: string;
  hasPassword: boolean;
  removedAt: string | null;
}

export interface TopicAssistant {
  id: string;
  name: string;
  loginId: string;
}

export interface Dimension {
  id: string;
  name: string;
  maxScore: number;
  sortOrder: number;
}

export interface EvaluationScore {
  dimensionId: string;
  dimensionName: string;
  score: number;
  maxScore: number;
}

export interface Evaluation {
  id: string;
  createdAt: string;
  teacher: { id: string; name: string };
  comment: string;
  scores: EvaluationScore[];
}

export interface SubmissionFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SubmissionSummary {
  id: string;
  student: { id: string; name: string; loginId: string };
  group?: { id: string; name: string } | null;
  submitter?: { id: string; name: string; loginId: string } | null;
  textContent: string;
  updatedAt: string;
  fileCount: number;
  evaluationCount: number;
  latestEvaluation: Evaluation | null;
  pending: boolean;
}

export interface TopicDetail {
  id: string;
  title: string;
  descriptionMd: string;
  status: TopicStatus;
  joinMode: string;
  class: { id: string; name: string } | null;
  submitMode: SubmitMode;
  groupMin: number;
  groupMax: number;
  allowStudentGroups: boolean;
  owner: { id: string; name: string };
  assistants: TopicAssistant[];
  students: TopicStudent[];
  dimensions: Dimension[];
  groups: TopicGroup[];
  submissions: SubmissionSummary[];
}

export interface SubmissionDetail {
  id: string;
  topic: { id: string; title: string };
  student: { id: string; name: string; loginId: string; avatarColor?: string };
  textContent: string;
  files: SubmissionFile[];
  updatedAt: string;
  evaluations: Evaluation[];
}

export interface TeacherOverview {
  topicCount: number;
  studentCount: number;
  pendingEvaluationCount: number;
  recentEvaluations: EvaluationListItem[];
  pendingSubmissions: PendingSubmission[];
  topics: TopicSummary[];
}

/** 工作台「待评价队列」 */
export interface PendingSubmission {
  id: string;
  topicId: string;
  topicTitle: string;
  student: { id: string; name: string };
  submittedAt: string;
}

export interface EvaluationListItem {
  id: string;
  createdAt: string;
  comment: string;
  teacher: { id: string; name: string };
  student: { id: string; name: string };
  topic: { id: string; name?: string; title?: string };
  submissionId: string;
  scores: EvaluationScore[];
}

export interface StudentTopicSummary {
  id: string;
  title: string;
  status: TopicStatus;
  owner: { name: string };
  submitted: boolean;
  updatedAt: string;
  removedAt: string | null;
}

export interface StudentOverview {
  topicCount: number;
  pendingSubmissionCount: number;
  submittedCount: number;
  latestEvaluations: MyEvaluationItem[];
  topics: StudentTopicSummary[];
}

export interface MyEvaluationItem {
  id: string;
  createdAt: string;
  comment: string;
  topic: { id: string; name?: string; title?: string };
  scores: EvaluationScore[];
}

export interface StudentTopicDetail {
  id: string;
  title: string;
  descriptionMd: string;
  status: TopicStatus;
  owner: { name: string };
  assistants: { name: string }[];
  class: { id: string; name: string } | null;
  submitMode: SubmitMode;
  groupMin: number;
  groupMax: number;
  allowStudentGroups: boolean;
  myGroup: MyGroup | null;
  groups: StudentGroupSummary[];
  mySubmission: {
    id: string;
    textContent: string;
    updatedAt: string;
    files: SubmissionFile[];
  } | null;
  myEvaluations: Evaluation[];
}

/** 学生端看到的小组概要（allowStudentGroups 时给全部组） */
export interface StudentGroupSummary {
  id: string;
  name: string;
  memberCount: number;
  members?: { id: string; name: string }[];
}

// ---------------- v4：班级与分组 ----------------

export interface TeacherClass {
  id: string;
  name: string;
  grade: string | null;
  memberCount: number;
  topicCount: number;
  createdAt: string;
}

export interface ClassStudent {
  id: string;
  name: string;
  loginId: string;
  removedAt: string | null;
}

export interface ClassDetail {
  id: string;
  name: string;
  grade: string | null;
  students: ClassStudent[];
  topics: { id: string; title: string; status: TopicStatus }[];
}

export interface StudentClass {
  id: string;
  name: string;
  grade: string | null;
  teacher: { name: string };
  memberCount: number;
  topicCount?: number;
}

export interface TopicGroup {
  id: string;
  name: string;
  createdBy: "teacher" | "student";
  members: { id: string; name: string; loginId: string }[];
}

export interface MyGroup {
  id: string;
  name: string;
  members: { id: string; name: string }[];
}

export type SubmitMode = "INDIVIDUAL" | "GROUP";
