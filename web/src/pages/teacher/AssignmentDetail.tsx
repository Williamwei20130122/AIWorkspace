import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowLeft, IconCheck, IconClipboard } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { DueBadge } from "@/components/teacher/DueBadge";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { GradeForm } from "@/components/teacher/GradeForm";
import { Panel } from "@/components/teacher/Panel";
import { ApiError, api, errorMessage } from "@/lib/api";
import { cn, formatDate, formatDateTime, scorePercent } from "@/lib/format";
import type { StudentBrief, SubmissionDetail, TeacherAssignmentDetail } from "@/lib/types";

export default function TeacherAssignmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [assignment, setAssignment] = useState<TeacherAssignmentDetail | null>(null);
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
      setAssignment(await api.get<TeacherAssignmentDetail>(`/api/teacher/assignments/${id}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setAssignment(null);
        setNotFound(true);
      } else {
        setError(errorMessage(err, "作业详情加载失败，请刷新页面重试"));
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
          <p className="mt-2 text-base font-semibold text-brand-900">作业不存在</p>
          <p className="mt-1 text-sm leading-6 text-ink-soft">
            这份作业可能已被删除，或者不属于你的账号。
          </p>
          <Link to="/teacher/assignments" className={cn(buttonClass("secondary", "sm"), "mt-4")}>
            返回作业列表
          </Link>
        </div>
      ) : loading && !assignment ? (
        <LoadingState label="正在加载作业详情…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : assignment ? (
        <div className="space-y-6">
          <PageHeader
            eyebrow="作业详情"
            title={assignment.title}
            description={`${assignment.course.title} · ${assignment.course.class.name} · 满分 ${assignment.points} 分`}
            actions={
              <Link
                to={`/teacher/classes/${assignment.course.class.id}`}
                className={buttonClass("secondary", "sm")}
              >
                <IconArrowLeft className="size-4" />
                返回班级
              </Link>
            }
          />

          {/* 作业信息 */}
          <div className="aw-card overflow-hidden">
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Meta label="满分">{assignment.points} 分</Meta>
              <Meta label="截止时间">
                <DueBadge dueAt={assignment.dueAt} />
              </Meta>
              <Meta label="提交情况">
                {assignment.submissionCount} 人已交 · {assignment.gradedCount} 人已批
              </Meta>
              <Meta label="发布">{formatDate(assignment.createdAt)}</Meta>
            </div>
            {assignment.description ? (
              <div className="border-t border-line bg-brand-50/30 px-5 py-4">
                <p className="text-xs font-semibold text-ink-soft">作业要求</p>
                <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-brand-900">
                  {assignment.description}
                </p>
              </div>
            ) : null}
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {/* 已提交 */}
            <Panel
              title={`已提交（${assignment.submissionCount}）`}
              description={
                assignment.submissionCount > 0
                  ? `${assignment.gradedCount} 份已批改，${assignment.submissionCount - assignment.gradedCount} 份待批改`
                  : "学生提交后会显示在这里"
              }
              action={
                assignment.submissionCount > 0 ? (
                  <Badge
                    tone={
                      assignment.submissionCount - assignment.gradedCount > 0
                        ? "warning"
                        : "success"
                    }
                  >
                    {assignment.submissionCount - assignment.gradedCount > 0
                      ? `待批改 ${assignment.submissionCount - assignment.gradedCount}`
                      : "全部批改完成"}
                  </Badge>
                ) : null
              }
            >
              {assignment.submissions.length === 0 ? (
                <EmptyState
                  icon={<IconClipboard />}
                  title="还没有学生提交"
                  description="学生提交后，这里会显示提交内容和批改表单。"
                />
              ) : (
                <ul className="space-y-3">
                  {assignment.submissions.map((submission) => (
                    <SubmissionCard
                      key={submission.id}
                      submission={submission}
                      points={assignment.points}
                      onSaved={() => void load()}
                    />
                  ))}
                </ul>
              )}
            </Panel>

            {/* 未提交 */}
            <Panel
              title={`未提交（${assignment.missingStudents.length}）`}
              description="还没有提交这份作业的学生"
            >
              {assignment.missingStudents.length === 0 ? (
                <EmptyState
                  icon={<IconCheck />}
                  title="全部学生都已提交"
                  description="这份作业的提交很完整。"
                />
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  {assignment.missingStudents.map((student) => (
                    <MissingStudentRow key={student.id} student={student} />
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

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <div className="mt-1 text-sm font-semibold text-brand-900">{children}</div>
    </div>
  );
}

function MissingStudentRow({ student }: { student: StudentBrief }) {
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

function SubmissionCard({
  submission,
  points,
  onSaved,
}: {
  submission: SubmissionDetail;
  points: number;
  onSaved: () => void;
}) {
  const graded = submission.score !== null;
  const percent = scorePercent(submission.score, points);

  return (
    <li>
      <article className="overflow-hidden rounded-xl border border-line bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar
              name={submission.student.name}
              color={submission.student.avatarColor}
              size="sm"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-brand-900">
                {submission.student.name}
              </p>
              <p className="truncate text-xs text-ink-soft">{submission.student.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-soft">
              提交于 {formatDateTime(submission.submittedAt)}
            </span>
            <Badge tone={graded ? "success" : "warning"}>{graded ? "已批改" : "待批改"}</Badge>
          </div>
        </header>

        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-ink-soft">提交内容</p>
          <p className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-brand-900">
            {submission.content}
          </p>
        </div>

        <div className="border-t border-line bg-brand-50/40 px-4 py-3">
          {graded ? (
            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-sm font-semibold text-emerald-800">
                得分 {submission.score} / {points} 分
                {percent === null ? "" : `（${percent}%）`}
                {submission.gradedAt ? (
                  <span className="ml-2 text-xs font-normal text-emerald-700">
                    批改于 {formatDateTime(submission.gradedAt)}
                  </span>
                ) : null}
              </p>
              {submission.feedback ? (
                <p className="mt-1 whitespace-pre-line break-words text-xs leading-relaxed text-emerald-900/80">
                  评语：{submission.feedback}
                </p>
              ) : null}
            </div>
          ) : null}

          <GradeForm
            key={submission.id}
            submissionId={submission.id}
            points={points}
            score={submission.score}
            feedback={submission.feedback}
            onSaved={onSaved}
          />
        </div>
      </article>
    </li>
  );
}
