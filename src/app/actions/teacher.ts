"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import type { ActionState } from "@/lib/action-state";
import { parseDateTimeLocal } from "@/lib/format";

/** 生成 6 位大写邀请码（去掉易混淆字符） */
function generateJoinCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

const classSchema = z.object({
  name: z.string().trim().min(1, "请输入班级名称").max(40, "班级名称过长"),
  grade: z.string().trim().max(20, "年级过长").optional(),
});

/** 教师创建班级 */
export async function createClassAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const teacher = await requireRole(ROLES.TEACHER);
  const parsed = classSchema.safeParse({
    name: formData.get("name"),
    grade: formData.get("grade") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  let joinCode = generateJoinCode();
  // 极小概率重复，最多重试 5 次
  for (let i = 0; i < 5; i += 1) {
    const exists = await prisma.class.findUnique({ where: { joinCode } });
    if (!exists) break;
    joinCode = generateJoinCode();
  }

  const created = await prisma.class.create({
    data: {
      name: parsed.data.name,
      grade: parsed.data.grade || null,
      joinCode,
      teacherId: teacher.id,
    },
  });

  revalidatePath("/teacher");
  revalidatePath("/teacher/classes");
  redirect(`/teacher/classes/${created.id}`);
}

const courseSchema = z.object({
  classId: z.string().min(1),
  title: z.string().trim().min(1, "请输入课程名称").max(60, "课程名称过长"),
  description: z.string().trim().max(500, "课程简介过长").optional(),
});

/** 教师在班级下创建课程 */
export async function createCourseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const teacher = await requireRole(ROLES.TEACHER);
  const parsed = courseSchema.safeParse({
    classId: formData.get("classId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  const klass = await prisma.class.findFirst({
    where: { id: parsed.data.classId, teacherId: teacher.id },
    select: { id: true },
  });
  if (!klass) return { error: "班级不存在或无权操作" };

  await prisma.course.create({
    data: {
      classId: klass.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
    },
  });

  revalidatePath(`/teacher/classes/${klass.id}`);
  revalidatePath("/teacher");
  return { success: "课程已创建" };
}

const assignmentSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().trim().min(1, "请输入作业标题").max(80, "作业标题过长"),
  description: z.string().trim().max(2000, "作业要求过长").optional(),
  points: z.coerce.number().int().min(1, "分值至少 1").max(1000, "分值过大"),
  dueAt: z.string().optional(),
});

/** 教师发布作业 */
export async function createAssignmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const teacher = await requireRole(ROLES.TEACHER);
  const parsed = assignmentSchema.safeParse({
    courseId: formData.get("courseId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    points: formData.get("points") ?? 100,
    dueAt: formData.get("dueAt") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  const course = await prisma.course.findFirst({
    where: { id: parsed.data.courseId, class: { teacherId: teacher.id } },
    select: { id: true, classId: true },
  });
  if (!course) return { error: "课程不存在或无权操作" };

  const assignment = await prisma.assignment.create({
    data: {
      courseId: course.id,
      createdById: teacher.id,
      title: parsed.data.title,
      description: parsed.data.description || null,
      points: parsed.data.points,
      dueAt: parseDateTimeLocal(formData.get("dueAt")),
    },
  });

  revalidatePath(`/teacher/classes/${course.classId}`);
  revalidatePath("/teacher");
  revalidatePath("/teacher/assignments");
  redirect(`/teacher/assignments/${assignment.id}`);
}

const gradeSchema = z.object({
  submissionId: z.string().min(1),
  score: z.coerce.number().int().min(0, "分数不能为负").max(1000, "分数过大"),
  feedback: z.string().trim().max(2000, "评语过长").optional(),
});

/** 教师批改提交 */
export async function gradeSubmissionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const teacher = await requireRole(ROLES.TEACHER);
  const parsed = gradeSchema.safeParse({
    submissionId: formData.get("submissionId"),
    score: formData.get("score"),
    feedback: formData.get("feedback") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  const submission = await prisma.submission.findFirst({
    where: {
      id: parsed.data.submissionId,
      assignment: { course: { class: { teacherId: teacher.id } } },
    },
    select: { id: true, assignmentId: true },
  });
  if (!submission) return { error: "提交不存在或无权操作" };

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      score: parsed.data.score,
      feedback: parsed.data.feedback || null,
      gradedAt: new Date(),
    },
  });

  revalidatePath(`/teacher/assignments/${submission.assignmentId}`);
  revalidatePath("/teacher");
  return { success: "批改已保存" };
}

const announcementSchema = z.object({
  classId: z.string().min(1),
  title: z.string().trim().min(1, "请输入公告标题").max(80, "标题过长"),
  content: z.string().trim().min(1, "请输入公告内容").max(2000, "内容过长"),
});

/** 教师发布班级公告 */
export async function createAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const teacher = await requireRole(ROLES.TEACHER);
  const parsed = announcementSchema.safeParse({
    classId: formData.get("classId"),
    title: formData.get("title"),
    content: formData.get("content"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  const klass = await prisma.class.findFirst({
    where: { id: parsed.data.classId, teacherId: teacher.id },
    select: { id: true },
  });
  if (!klass) return { error: "班级不存在或无权操作" };

  await prisma.announcement.create({
    data: { classId: klass.id, title: parsed.data.title, content: parsed.data.content },
  });

  revalidatePath(`/teacher/classes/${klass.id}`);
  return { success: "公告已发布" };
}
