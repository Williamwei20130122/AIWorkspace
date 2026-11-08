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
  owner: { id: string; name: string };
  assistants: TopicAssistant[];
  students: TopicStudent[];
  dimensions: Dimension[];
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
  topics: TopicSummary[];
}

export interface EvaluationListItem {
  id: string;
  createdAt: string;
  comment: string;
  teacher: { id: string; name: string };
  student: { id: string; name: string };
  topic: { id: string; title: string };
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
  topic: { id: string; title: string };
  scores: EvaluationScore[];
}

export interface StudentTopicDetail {
  id: string;
  title: string;
  descriptionMd: string;
  status: TopicStatus;
  owner: { name: string };
  assistants: { name: string }[];
  mySubmission: {
    id: string;
    textContent: string;
    updatedAt: string;
    files: SubmissionFile[];
  } | null;
  myEvaluations: Evaluation[];
}
