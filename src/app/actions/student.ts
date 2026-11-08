"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import type { ActionState } from "@/lib/action-state";

const joinSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, "邀请码为 6 位字母数字"),
});

/** 学生用邀请码加入班级 */
export async function joinClassAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const student = await requireRole(ROLES.STUDENT);
  const parsed = joinSchema.safeParse({ joinCode: formData.get("joinCode") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "邀请码不正确" };
  }

  const klass = await prisma.class.findUnique({
    where: { joinCode: parsed.data.joinCode },
    select: { id: true, name: true },
  });
  if (!klass) return { error: "没有找到这个邀请码对应的班级" };

  await prisma.enrollment.upsert({
    where: { classId_studentId: { classId: klass.id, studentId: student.id } },
    create: { classId: klass.id, studentId: student.id },
    update: {},
  });

  revalidatePath("/student");
  revalidatePath("/student/classes");
  return { success: `已加入「${klass.name}」` };
}

const submitSchema = z.object({
  assignmentId: z.string().min(1),
  content: z.string().trim().min(1, "请填写作业内容").max(5000, "内容过长"),
});

/** 学生提交 / 重新提交作业 */
export async function submitAssignmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const student = await requireRole(ROLES.STUDENT);
  const parsed = submitSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
    content: formData.get("content"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  const assignment = await prisma.assignment.findFirst({
    where: {
      id: parsed.data.assignmentId,
      course: { class: { enrollments: { some: { studentId: student.id } } } },
    },
    select: { id: true },
  });
  if (!assignment) return { error: "作业不存在或你不在该班级" };

  await prisma.submission.upsert({
    where: {
      assignmentId_studentId: { assignmentId: assignment.id, studentId: student.id },
    },
    create: {
      assignmentId: assignment.id,
      studentId: student.id,
      content: parsed.data.content,
    },
    update: {
      content: parsed.data.content,
      submittedAt: new Date(),
      score: null,
      feedback: null,
      gradedAt: null,
    },
  });

  revalidatePath(`/student/assignments/${assignment.id}`);
  revalidatePath("/student/assignments");
  revalidatePath("/student");
  return { success: "作业已提交" };
}
