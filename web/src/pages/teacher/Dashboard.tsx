import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBook, IconClipboard, IconGraduation, IconUsers } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DueBadge } from "@/components/teacher/DueBadge";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { Panel } from "@/components/teacher/Panel";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { RecentSubmission, TeacherOverview, UpcomingAssignment } from "@/lib/types";

export default function TeacherDashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<TeacherOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await api.get<TeacherOverview>("/api/teacher/overview"));
    } catch (err) {
      setError(errorMessage(err, "工作台加载失败，请刷新页面重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="教师工作台"
        title={`你好，${user.name}`}
        description="这里汇总了班级、课程与作业的整体进度。先把待批改的提交处理掉，学生就能尽快看到反馈。"
        actions={
          <>
            <Link to="/teacher/classes" className={buttonClass("secondary", "sm")}>
              我的班级
            </Link>
            <Link to="/teacher/assignments" className={buttonClass("accent", "sm")}>
              作业与批改
            </Link>
          </>
        }
      />

      {loading && !overview ? (
        <LoadingState label="正在加载工作台…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : overview ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="班级数"
              value={overview.classCount}
              hint="我创建的班级"
              icon={<IconUsers />}
              tone="brand"
            />
            <StatCard
              label="学生数"
              value={overview.studentCount}
              hint="所有班级去重后的学生"
              icon={<IconGraduation />}
              tone="brand"
            />
            <StatCard
              label="课程数"
              value={overview.courseCount}
              hint="所有班级的课程"
              icon={<IconBook />}
              tone="brand"
            />
            <StatCard
              label="待批改"
              value={overview.pendingGrading}
              hint={overview.pendingGrading > 0 ? "学生正在等反馈" : "提交都已批改完成"}
              icon={<IconClipboard />}
              tone={overview.pendingGrading > 0 ? "accent" : "success"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Panel
              title="最近提交"
              description="学生最新的作业提交，点开即可批改"
              action={
                <Link
                  to="/teacher/assignments"
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  查看全部
                </Link>
              }
            >
              {overview.recentSubmissions.length === 0 ? (
                <EmptyState
                  icon={<IconClipboard />}
                  title="还没有提交记录"
                  description="学生提交作业后，会出现在这里。"
                />
              ) : (
                <ul className="divide-y divide-line">
                  {overview.recentSubmissions.map((submission) => (
                    <SubmissionRow key={submission.id} submission={submission} />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="即将截止的作业"
              description="按截止时间排序，别让学生错过"
              action={
                <Link
                  to="/teacher/assignments"
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  查看全部
                </Link>
              }
            >
              {overview.upcomingAssignments.length === 0 ? (
                <EmptyState
                  icon={<IconBook />}
                  title="近期没有截止的作业"
                  description="发布新作业后，这里会显示最近的截止时间。"
                  action={
                    <Link to="/teacher/classes" className={buttonClass("secondary", "sm")}>
                      去发布作业
                    </Link>
                  }
                />
              ) : (
                <ul className="space-y-1">
                  {overview.upcomingAssignments.map((assignment) => (
                    <UpcomingRow key={assignment.id} assignment={assignment} />
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function SubmissionRow({ submission }: { submission: RecentSubmission }) {
  const graded = submission.score !== null;

  return (
    <li>
      <Link
        to={`/teacher/assignments/${submission.assignment.id}`}
        className="group flex items-start gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-brand-50/60"
      >
        <Avatar name={submission.student.name} color={submission.student.avatarColor} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-brand-900 group-hover:text-brand-700">
            {submission.student.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft">
            {submission.assignment.title} · {submission.assignment.course.title} ·{" "}
            {submission.assignment.course.class.name}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge tone={graded ? "success" : "warning"}>{graded ? "已批改" : "待批改"}</Badge>
          <span className="text-[11px] text-ink-soft">{formatDateTime(submission.submittedAt)}</span>
        </div>
      </Link>
    </li>
  );
}

function UpcomingRow({ assignment }: { assignment: UpcomingAssignment }) {
  return (
    <li>
      <Link
        to={`/teacher/assignments/${assignment.id}`}
        className="group flex items-start gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-brand-50/60"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
          <IconClipboard className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-brand-900 group-hover:text-brand-700">
            {assignment.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft">
            {assignment.course.title} · {assignment.course.class.name} · {assignment.submittedCount} 人已交
          </p>
          <div className="mt-2">
            <DueBadge dueAt={assignment.dueAt} />
          </div>
        </div>
      </Link>
    </li>
  );
}
