/** 角色常量与判定（SQLite 下用字符串存角色，这里做类型收窄） */
export const ROLES = {
  TEACHER: "TEACHER",
  STUDENT: "STUDENT",
  ADMIN: "ADMIN",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export function isRole(value: unknown): value is Role {
  return value === "TEACHER" || value === "STUDENT" || value === "ADMIN";
}

export const ROLE_LABEL: Record<Role, string> = {
  TEACHER: "教师",
  STUDENT: "学生",
  ADMIN: "管理员",
};

export function isTeacher(role: string): boolean {
  return role === ROLES.TEACHER;
}

export function isStudent(role: string): boolean {
  return role === ROLES.STUDENT;
}
