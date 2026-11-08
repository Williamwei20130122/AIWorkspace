import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowLeft, IconBell, IconBook, IconUsers } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { CopyJoinCode } from "@/components/teacher/CopyJoinCode";
import { CreateAnnouncementForm } from "@/components/teacher/CreateAnnouncementForm";
import { CreateAssignmentForm } from "@/components/teacher/CreateAssignmentForm";
import { CreateCourseForm } from "@/components/teacher/CreateCourseForm";
import { DueBadge } from "@/components/teacher/DueBadge";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { Panel } from "@/components/teacher/Panel";
import { ApiError, api, errorMessage } from "@/lib/api";
import { cn, formatDate } from "@/lib/format";
import type { CourseBrief, StudentBrief, TeacherClassDetail } from "@/lib/types";

export default function TeacherClassDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [klass, setKlass] = useState<TeacherClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      setKlass(await api.get<TeacherClassDetail>(`/api/teacher/classes/${id}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setKlass(null);
        setNotFound(true);
      } else {
        setError(errorMessage(err, "班级详情加载失败，请刷新页面重试"));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  return (
    <AppShell user={user}>
      {notFound ? (
        <div className="mx-auto max-w-md rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">404</p>
          <p className="mt-2 text-base font-semibold text-brand-900">班级不存在</p>
          <p className="mt-1 text-sm leading-6 text-ink-soft">
            这个班级可能已被删除，或者不属于你的账号。
          </p>
          <Link
            to="/teacher/classes"
            className={cn(buttonClass("secondary", "sm"), "mt-4")}
          >
            返回班级列表
          </Link>
        </div>
      ) : loading && !klass ? (
        <LoadingState label="正在加载班级详情…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : klass ? (
        <div className="space-y-6">
          <PageHeader
            eyebrow={klass.grade ? `${klass.grade} · 班级详情` : "班级详情"}
            title={klass.name}
            description={`${klass.students.length} 名学生 · ${klass.courses.length} 门课程 · 任课教师 ${klass.teacher.name}`}
            actions={
              <Link to="/teacher/classes" className={buttonClass("secondary", "sm")}>
                <IconArrowLeft className="size-4" />
                返回班级列表
              </Link>
            }
          />

          {/* 邀请码 */}
          <div className="aw-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
                班级邀请码
              </p>
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
                description={`${klass.students.length} 人`}
                action={
                  klass.students.length > 0 ? (
                    <span className="text-xs text-ink-soft">按加入时间排序</span>
                  ) : null
                }
              >
                {klass.students.length === 0 ? (
                  <EmptyState
                    icon={<IconUsers />}
                    title="还没有学生加入"
                    description={`把邀请码 ${klass.joinCode} 发给学生，他们登录后就能加入本班。`}
                  />
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {klass.students.map((student) => (
                      <StudentRow key={student.id} student={student} />
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
                      to="/teacher/assignments"
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
                    description="在右侧「新建课程」表单里添加第一门课程，然后就可以发布作业。"
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
                    description="在右侧「发布公告」表单里通知学生最新安排。"
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {klass.announcements.map((announcement) => (
                      <li key={announcement.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-sm font-semibold text-brand-900">
                            {announcement.title}
                          </h3>
                          <span className="text-xs text-ink-soft">
                            {formatDate(announcement.createdAt)}
                          </span>
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
                <CreateCourseForm classId={klass.id} onCreated={() => void load()} />
              </Panel>
              <Panel title="发布作业" description="选择课程、填写要求与截止时间">
                <CreateAssignmentForm
                  courses={klass.courses.map((course) => ({ id: course.id, title: course.title }))}
                  onCreated={(assignmentId) => navigate(`/teacher/assignments/${assignmentId}`)}
                />
              </Panel>
              <Panel title="发布公告" description="公告会展示给本班学生">
                <CreateAnnouncementForm classId={klass.id} onCreated={() => void load()} />
              </Panel>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function StudentRow({ student }: { student: StudentBrief }) {
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

function CourseCard({ course }: { course: CourseBrief }) {
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
        <Badge tone="brand">{course.assignmentCount} 个作业</Badge>
      </div>

      {course.recentAssignments.length === 0 ? (
        <p className="mt-3 border-t border-line pt-3 text-xs text-ink-soft">
          这门课还没有作业，在「发布作业」表单里创建。
        </p>
      ) : (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {course.recentAssignments.map((assignment) => (
            <li key={assignment.id}>
              <Link
                to={`/teacher/assignments/${assignment.id}`}
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
