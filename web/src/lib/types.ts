/** 与后端 JSON 契约（docs/CONTRACT.md 第 5 节）一一对应的类型 */

export type Role = "TEACHER" | "STUDENT" | "ADMIN";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarColor: string;
}

export interface StudentBrief {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  createdAt?: string;
}

export interface ClassSummary {
  id: string;
  name: string;
  grade: string | null;
  joinCode: string;
  createdAt: string;
  enrollmentCount: number;
  courseCount: number;
  courses: { id: string; title: string; color: string }[];
}

export interface CourseBrief {
  id: string;
  title: string;
  description: string | null;
  color: string;
  assignmentCount: number;
  recentAssignments: { id: string; title: string; dueAt: string | null }[];
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  className?: string;
}

export interface TeacherClassDetail {
  id: string;
  name: string;
  grade: string | null;
  joinCode: string;
  teacher: { name: string; email: string };
  students: StudentBrief[];
  courses: CourseBrief[];
  announcements: Announcement[];
}

export interface RecentSubmission {
  id: string;
  submittedAt: string;
  score: number | null;
  student: { id: string; name: string; avatarColor: string };
  assignment: {
    id: string;
    title: string;
    points: number;
    course: { title: string; class: { name: string } };
  };
}

export interface UpcomingAssignment {
  id: string;
  title: string;
  dueAt: string | null;
  points: number;
  course: { title: string; class: { name: string } };
  submittedCount: number;
}

export interface TeacherOverview {
  classCount: number;
  courseCount: number;
  studentCount: number;
  pendingGrading: number;
  recentSubmissions: RecentSubmission[];
  upcomingAssignments: UpcomingAssignment[];
}

export interface TeacherAssignmentListItem {
  id: string;
  title: string;
  points: number;
  dueAt: string | null;
  createdAt: string;
  course: { id: string; title: string; class: { id: string; name: string } };
  submittedCount: number;
  gradedCount: number;
}

export interface SubmissionDetail {
  id: string;
  student: { id: string; name: string; email: string; avatarColor: string };
  content: string;
  submittedAt: string;
  score: number | null;
  feedback: string | null;
  gradedAt: string | null;
}

export interface TeacherAssignmentDetail {
  id: string;
  title: string;
  description: string | null;
  points: number;
  dueAt: string | null;
  createdAt: string;
  course: { title: string; class: { id: string; name: string } };
  submissionCount: number;
  gradedCount: number;
  submissions: SubmissionDetail[];
  missingStudents: StudentBrief[];
}

export interface StudentOverview {
  classCount: number;
  courseCount: number;
  pendingCount: number;
  submittedCount: number;
  averagePercent: number | null;
  dueSoon: {
    id: string;
    title: string;
    dueAt: string | null;
    points: number;
    course: { title: string; class: { name: string } };
  }[];
  recentAnnouncements: Announcement[];
}

export interface StudentClass {
  id: string;
  name: string;
  teacher: { name: string; email: string };
  studentCount: number;
  courses: { id: string; title: string; assignmentCount: number }[];
}

export interface MySubmission {
  id: string;
  submittedAt: string;
  score: number | null;
  feedback: string | null;
}

export interface StudentAssignmentListItem {
  id: string;
  title: string;
  points: number;
  dueAt: string | null;
  course: { title: string; class: { id: string; name: string } };
  mySubmission: MySubmission | null;
}

export interface StudentAssignmentDetail {
  id: string;
  title: string;
  description: string | null;
  points: number;
  dueAt: string | null;
  course: { title: string; class: { id: string; name: string; teacher: { name: string } } };
  mySubmission: MySubmission | null;
}

export interface GradeItem {
  id: string;
  score: number;
  feedback: string | null;
  submittedAt: string;
  assignment: {
    id: string;
    title: string;
    points: number;
    dueAt: string | null;
    course: { title: string; class: { name: string } };
  };
}
