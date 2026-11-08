import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";

export const metadata: Metadata = {
  title: "教师工作台",
  description: "班级、课程、作业提交与批改进度一览。",
};

export default async function TeacherLayout({ children }: { children: ReactNode }) {
  const user = await requireRole(ROLES.TEACHER);

  return <AppShell user={user}>{children}</AppShell>;
}
