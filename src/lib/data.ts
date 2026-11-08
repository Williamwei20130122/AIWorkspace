import { prisma } from "@/lib/prisma";

/**
 * 服务端数据查询层（只在 Server Component / Server Action 中调用）。
 *
 * 约定：
 * - 所有查询都按当前登录用户做权限过滤（教师只能看自己的班，学生只能看自己加入的班）。
 * - 返回值直接给页面用；页面可以用 `Awaited<ReturnType<typeof xxx>>` 推导类型。
 * - 找不到 / 无权限一律返回 null，由页面调用 notFound()。
 */

/* ------------------------------------------------------------------ */
/* 教师端                                                              */
/* ------------------------------------------------------------------ */

export async function getTeacherOverview(teacherId: string) {
  const [classCount, courseCount, studentRows, pendingGrading, recentSubmissions, upcomingAssignments] =
    await Promise.all([
      prisma.class.count({ where: { teacherId } }),
      prisma.course.count({ where: { class: { teacherId } } }),
      prisma.enrollment.findMany({
        where: { class: { teacherId } },
        distinct: ["studentId"],
        select: { studentId: true },
      }),
      prisma.submission.count({
        where: { score: null, assignment: { course: { class: { teacherId } } } },
      }),
      prisma.submission.findMany({
        where: { assignment: { course: { class: { teacherId } } } },
        orderBy: { submittedAt: "desc" },
        take: 6,
        include: {
          student: { select: { id: true, name: true, avatarColor: true } },
          assignment: {
            select: {
              id: true,
              title: true,
              points: true,
              course: { select: { title: true, class: { select: { name: true } } } },
            },
          },
        },
      }),
      prisma.assignment.findMany({
        where: { course: { class: { teacherId } }, dueAt: { gte: new Date() } },
        orderBy: { dueAt: "asc" },
        take: 5,
        include: {
          course: { select: { title: true, class: { select: { name: true } } } },
          _count: { select: { submissions: true } },
        },
      }),
    ]);

  return {
    classCount,
    courseCount,
    studentCount: studentRows.length,
    pendingGrading,
    recentSubmissions,
    upcomingAssignments,
  };
}

export async function listTeacherClasses(teacherId: string) {
  return prisma.class.findMany({
    where: { teacherId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { enrollments: true, courses: true } },
      courses: {
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, color: true },
      },
    },
  });
}

export async function getTeacherClassDetail(classId: string, teacherId: string) {
  const klass = await prisma.class.findFirst({
    where: { id: classId, teacherId },
    include: {
      teacher: { select: { id: true, name: true, email: true } },
      enrollments: {
        orderBy: { createdAt: "asc" },
        include: {
          student: {
            select: { id: true, name: true, email: true, avatarColor: true, createdAt: true },
          },
        },
      },
      courses: {
        orderBy: { createdAt: "asc" },
        include: {
          _count: { select: { assignments: true } },
          assignments: {
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { id: true, title: true, dueAt: true },
          },
        },
      },
      announcements: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  return klass;
}

export async function listTeacherAssignments(teacherId: string) {
  const assignments = await prisma.assignment.findMany({
    where: { course: { class: { teacherId } } },
    orderBy: { createdAt: "desc" },
    include: {
      course: { select: { id: true, title: true, class: { select: { id: true, name: true } } } },
      submissions: { select: { id: true, studentId: true, score: true } },
    },
  });
  return assignments.map((a) => ({
    ...a,
    submittedCount: a.submissions.length,
    gradedCount: a.submissions.filter((s) => s.score !== null).length,
  }));
}

export async function getTeacherAssignmentDetail(assignmentId: string, teacherId: string) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, course: { class: { teacherId } } },
    include: {
      createdBy: { select: { name: true } },
      course: {
        include: {
          class: {
            include: {
              enrollments: {
                include: { student: { select: { id: true, name: true, email: true, avatarColor: true } } },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
      submissions: {
        orderBy: { submittedAt: "desc" },
        include: {
          student: { select: { id: true, name: true, email: true, avatarColor: true } },
        },
      },
    },
  });
  if (!assignment) return null;

  const submittedIds = new Set(assignment.submissions.map((s) => s.studentId));
  const missingStudents = assignment.course.class.enrollments
    .map((e) => e.student)
    .filter((s) => !submittedIds.has(s.id));

  return { ...assignment, missingStudents };
}

/* ------------------------------------------------------------------ */
/* 学生端                                                              */
/* ------------------------------------------------------------------ */

export async function getStudentOverview(studentId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId },
    select: { classId: true },
  });
  const classIds = enrollments.map((e) => e.classId);

  const [assignments, recentAnnouncements] = await Promise.all([
    prisma.assignment.findMany({
      where: { course: { classId: { in: classIds } } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      include: {
        course: { select: { title: true, class: { select: { id: true, name: true } } } },
        submissions: { where: { studentId }, select: { id: true, score: true } },
      },
    }),
    prisma.announcement.findMany({
      where: { classId: { in: classIds } },
      orderBy: { createdAt: "desc" },
      take: 4,
      include: { class: { select: { name: true } } },
    }),
  ]);

  const now = new Date();
  const pending = assignments.filter((a) => a.submissions.length === 0);
  const submitted = assignments.filter((a) => a.submissions.length > 0);
  const graded = assignments.filter((a) => a.submissions[0]?.score !== null && a.submissions[0]?.score !== undefined);
  const averagePercent =
    graded.length === 0
      ? null
      : Math.round(
          graded.reduce((sum, a) => sum + ((a.submissions[0]!.score as number) / a.points) * 100, 0) /
            graded.length,
        );

  const dueSoon = pending
    .filter((a) => a.dueAt && a.dueAt.getTime() >= now.getTime())
    .slice(0, 5);

  return {
    classCount: classIds.length,
    courseCount: await prisma.course.count({ where: { classId: { in: classIds } } }),
    pendingCount: pending.length,
    submittedCount: submitted.length,
    averagePercent,
    dueSoon,
    recentAnnouncements,
  };
}

export async function listStudentAssignments(studentId: string) {
  const assignments = await prisma.assignment.findMany({
    where: { course: { class: { enrollments: { some: { studentId } } } } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    include: {
      course: { select: { title: true, class: { select: { id: true, name: true } } } },
      submissions: {
        where: { studentId },
        select: { id: true, submittedAt: true, score: true, feedback: true },
      },
    },
  });
  return assignments.map((a) => {
    const mySubmission = a.submissions[0] ?? null;
    return { ...a, mySubmission };
  });
}

export async function getStudentAssignmentDetail(assignmentId: string, studentId: string) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, course: { class: { enrollments: { some: { studentId } } } } },
    include: {
      course: {
        select: {
          title: true,
          class: { select: { id: true, name: true, teacher: { select: { name: true } } } },
        },
      },
      submissions: { where: { studentId } },
    },
  });
  if (!assignment) return null;
  return { ...assignment, mySubmission: assignment.submissions[0] ?? null };
}

export async function listStudentClasses(studentId: string) {
  return prisma.class.findMany({
    where: { enrollments: { some: { studentId } } },
    orderBy: { createdAt: "desc" },
    include: {
      teacher: { select: { name: true, email: true } },
      _count: { select: { enrollments: true } },
      courses: {
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { assignments: true } } },
      },
    },
  });
}

export async function listStudentGrades(studentId: string) {
  return prisma.submission.findMany({
    where: { studentId, score: { not: null } },
    orderBy: { submittedAt: "desc" },
    include: {
      assignment: {
        select: {
          id: true,
          title: true,
          points: true,
          dueAt: true,
          course: { select: { title: true, class: { select: { name: true } } } },
        },
      },
    },
  });
}

export async function listStudentAnnouncements(studentId: string, take = 10) {
  return prisma.announcement.findMany({
    where: { class: { enrollments: { some: { studentId } } } },
    orderBy: { createdAt: "desc" },
    take,
    include: { class: { select: { id: true, name: true } } },
  });
}
