import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { getTeacherClassDetail } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { IconArrowLeft, IconBell, IconBook, IconUsers } from "@/components/ui/icons";
import { CopyJoinCode } from "@/components/teacher/copy-join-code";
import { CreateCourseForm } from "@/components/teacher/create-course-form";
import { CreateAssignmentForm } from "@/components/teacher/create-assignment-form";
import { CreateAnnouncementForm } from "@/components/teacher/create-announcement-form";
import { DueBadge } from "@/components/teacher/due-badge";
import { Panel } from "@/components/teacher/panel";

type ClassDetail = NonNullable<Awaited<ReturnType<typeof getTeacherClassDetail>>>;
type ClassCourse = ClassDetail["courses"][number];
type ClassStudent = ClassDetail["enrollments"][number]["student"];

export const metadata: Metadata = { title: "班级详情" };

export default async function TeacherClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole(ROLES.TEACHER);
  const klass = await getTeacherClassDetail(id, user.id);
  if (!klass) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={klass.grade ? `${klass.grade} · 班级详情` : "班级详情"}
        title={klass.name}
        description={`${klass.enrollments.length} 名学生 · ${klass.courses.length} 门课程 · 创建于 ${formatDate(klass.createdAt)}`}
        actions={
          <Link href="/teacher/classes" className={buttonClass("secondary", "sm")}>
            <IconArrowLeft className="size-4" />
            返回班级列表
          </Link>
        }
      />

      {/* 邀请码 */}
      <div className="aw-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">班级邀请码</p>
          <p className="mt-1 text-sm text-ink-soft">
            学生登录后输入这 6 位邀请码即可加入本班，邀请码不随班级名称变化。
          </p>
        </div>
        <CopyJoinCode code={klass.joinCode} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* 学生名单 */}
          <Panel
            title="学生名单"
            description={`${klass.enrollments.length} 人`}
            action={
              klass.enrollments.length > 0 ? (
                <span className="text-xs text-ink-soft">按加入时间排序</span>
              ) : null
            }
          >
            {klass.enrollments.length === 0 ? (
              <EmptyState
                icon={<IconUsers />}
                title="还没有学生加入"
                description={`把邀请码 ${klass.joinCode} 发给学生，他们登录后就能加入本班。`}
              />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {klass.enrollments.map((enrollment) => (
                  <StudentRow key={enrollment.id} student={enrollment.student} />
                ))}
              </ul>
            )}
          </Panel>

          {/* 课程与作业 */}
          <Panel
            title="课程与作业"
            description={`${klass.courses.length} 门课程`}
            action={
              klass.courses.length > 0 ? (
                <Link
                  href="/teacher/assignments"
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  全部作业
                </Link>
              ) : null
            }
          >
            {klass.courses.length === 0 ? (
              <EmptyState
                icon={<IconBook />}
                title="还没有课程"
                description="在「新建课程」表单里添加第一门课程，然后就可以发布作业。"
              />
            ) : (
              <ul className="space-y-3">
                {klass.courses.map((course) => (
                  <CourseCard key={course.id} course={course} />
                ))}
              </ul>
            )}
          </Panel>

          {/* 公告 */}
          <Panel
            title="班级公告"
            description={
              klass.announcements.length > 0
                ? `最近 ${klass.announcements.length} 条`
                : "还没有发布过公告"
            }
          >
            {klass.announcements.length === 0 ? (
              <EmptyState
                icon={<IconBell />}
                title="还没有公告"
                description="在「发布公告」表单里通知学生最新安排。"
              />
            ) : (
              <ul className="divide-y divide-line">
                {klass.announcements.map((announcement) => (
                  <li key={announcement.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-brand-900">{announcement.title}</h3>
                      <span className="text-xs text-ink-soft">{formatDate(announcement.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm leading-6 text-ink-soft">
                      {announcement.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* 右侧操作区 */}
        <div className="space-y-6">
          <Panel title="新建课程" description="为这个班级添加一门课程">
            <CreateCourseForm classId={klass.id} />
          </Panel>
          <Panel title="发布作业" description="选择课程、填写要求与截止时间">
            <CreateAssignmentForm
              courses={klass.courses.map((course) => ({ id: course.id, title: course.title }))}
            />
          </Panel>
          <Panel title="发布公告" description="公告会展示给本班学生">
            <CreateAnnouncementForm classId={klass.id} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StudentRow({ student }: { student: ClassStudent }) {
  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5">
      <Avatar name={student.name} color={student.avatarColor} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-brand-900">{student.name}</p>
        <p className="truncate text-xs text-ink-soft">{student.email}</p>
      </div>
    </li>
  );
}

function CourseCard({ course }: { course: ClassCourse }) {
  return (
    <li className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-900">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: course.color }}
            />
            <span className="truncate">{course.title}</span>
          </h3>
          {course.description ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-soft">
              {course.description}
            </p>
          ) : null}
        </div>
        <Badge tone="brand">{course._count.assignments} 个作业</Badge>
      </div>

      {course.assignments.length === 0 ? (
        <p className="mt-3 border-t border-line pt-3 text-xs text-ink-soft">
          这门课还没有作业，在「发布作业」表单里创建。
        </p>
      ) : (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {course.assignments.map((assignment) => (
            <li key={assignment.id}>
              <Link
                href={`/teacher/assignments/${assignment.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-brand-50"
              >
                <span className="truncate text-sm text-brand-800">{assignment.title}</span>
                <DueBadge dueAt={assignment.dueAt} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
