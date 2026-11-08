import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { AppShell } from "@/components/shell/app-shell";

export const metadata: Metadata = {
  title: "学生工作台",
  description: "学生端：查看班级与课程、提交作业、查看成绩。",
};

/** 学生端布局：校验角色后用 AppShell 包住全部学生页面 */
export default async function StudentLayout({ children }: { children: ReactNode }) {
  const user = await requireRole(ROLES.STUDENT);
  return <AppShell user={user}>{children}</AppShell>;
}
