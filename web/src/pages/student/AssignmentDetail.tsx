import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { DueBadge } from "@/components/student/DueBadge";
import { ErrorCard, LoadingCard } from "@/components/student/PageState";
import { SubmissionBadge } from "@/components/student/SubmissionBadge";
import { SubmitAssignmentForm } from "@/components/student/SubmitAssignmentForm";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowLeft, IconFile } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime, scorePercent } from "@/lib/format";
import type { MySubmission, StudentAssignmentDetail } from "@/lib/types";

/** 契约中的 MySubmission 不含 content；若后端额外返回则一并展示 */
type SubmissionWithContent = MySubmission & { content?: string | null };

function BackLink() {
  return (
    <Link
      to="/student/assignments"
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft transition-colors hover:text-brand-700"
    >
      <IconArrowLeft className="size-4" />
      返回作业列表
    </Link>
  );
}

function SubmissionInfo({ data }: { data: StudentAssignmentDetail }) {
  const submission = data.mySubmission as SubmissionWithContent | null;

  if (!submission) {
    return (
      <p className="text-sm text-ink-soft">
        还没有提交这份作业。在「提交作业」表单里写下答案即可，老师批改后会显示分数和评语。
      </p>
    );
  }

  const percent = scorePercent(submission.score, data.points);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
        <span>提交时间：{formatDateTime(submission.submittedAt)}</span>
        {submission.content ? <span>共 {submission.content.length} 字</span> : null}
      </div>

      {submission.content ? (
        <div>
          <p className="text-xs font-medium text-ink-soft">我的提交内容</p>
          <p className="mt-1 whitespace-pre-line rounded-xl border border-line bg-brand-50/40 px-3 py-2.5 text-sm leading-6 text-ink">
            {submission.content}
          </p>
        </div>
      ) : null}

      {submission.score !== null ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-emerald-800">教师评分</p>
              <p className="mt-1 text-2xl font-semibold leading-none text-brand-900">
                {submission.score}
                <span className="ml-1 text-sm font-medium text-ink-soft">/ {data.points} 分</span>
              </p>
            </div>
            {percent !== null ? <Badge tone="success">{percent}%</Badge> : null}
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-emerald-100">
            <div
              className="h-full rounded-full bg-emerald-600"
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
          <div className="mt-3 border-t border-emerald-200 pt-3">
            <p className="text-xs font-medium text-emerald-800">教师评语</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-6 text-ink">
              {submission.feedback || "老师没有填写评语。"}
            </p>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-sky-200 bg-sky-50/60 px-3.5 py-2.5 text-sm leading-6 text-sky-800">
          已提交，等待老师批改。批改前你仍然可以重新提交。
        </p>
      )}
    </div>
  );
}

export default function StudentAssignmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<StudentAssignmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(
    async (showLoading = true) => {
      if (!id) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      if (showLoading) setLoading(true);
      setError(null);
      try {
        setData(await api.get<StudentAssignmentDetail>(`/api/student/assignments/${id}`));
        setNotFound(false);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          setData(null);
        } else {
          setError(errorMessage(err, "作业加载失败，请稍后重试"));
        }
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  if (loading) {
    return (
      <AppShell user={user}>
        <BackLink />
        <LoadingCard label="正在加载作业…" />
      </AppShell>
    );
  }

  if (notFound) {
    return (
      <AppShell user={user}>
        <BackLink />
        <EmptyState
          icon={<IconFile />}
          title="作业不存在"
          description="这份作业可能已被老师删除，或者你不在这份作业所属的班级里。"
          action={
            <Link to="/student/assignments" className={buttonClass("primary", "sm")}>
              返回作业列表
            </Link>
          }
        />
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell user={user}>
        <BackLink />
        <ErrorCard message={error ?? "作业不存在"} onRetry={() => void load()} />
      </AppShell>
    );
  }

  return (
    <AppShell user={user}>
      <BackLink />
      <PageHeader
        eyebrow={data.course.title}
        title={data.title}
        description={`${data.course.class.name} · 教师 ${data.course.class.teacher.name} · 满分 ${data.points} 分`}
        actions={<DueBadge dueAt={data.dueAt} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>作业要求</CardTitle>
                <CardDescription>老师布置时填写的说明</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {data.description ? (
                <p className="whitespace-pre-line text-sm leading-6 text-ink">{data.description}</p>
              ) : (
                <p className="text-sm text-ink-soft">老师没有填写额外要求，按题目完成即可。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>我的提交</CardTitle>
                <CardDescription>提交后仍可重新提交，老师会看到最新内容</CardDescription>
              </div>
              <SubmissionBadge submission={data.mySubmission} points={data.points} />
            </CardHeader>
            <CardContent>
              <SubmissionInfo data={data} />
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{data.mySubmission ? "重新提交" : "提交作业"}</CardTitle>
                <CardDescription>最多 5000 字</CardDescription>
              </div>
              <span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-700">
                <IconFile />
              </span>
            </CardHeader>
            <CardContent>
              <SubmitAssignmentForm
                assignmentId={data.id}
                submission={data.mySubmission}
                onSubmitted={() => void load(false)}
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}
