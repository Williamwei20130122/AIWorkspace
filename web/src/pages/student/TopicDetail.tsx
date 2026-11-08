import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { EvaluationScores } from "@/components/student/EvaluationScores";
import { formatFileSize } from "@/components/student/files";
import { Markdown } from "@/components/student/Markdown";
import { ErrorCard, LoadingCard } from "@/components/student/PageState";
import { SubmitForm } from "@/components/student/SubmitForm";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  IconArrowLeft,
  IconAward,
  IconCheck,
  IconClock,
  IconFile,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Evaluation, StudentTopicDetail } from "@/lib/types";

function BackLink() {
  return (
    <Link
      to="/student/topics"
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft transition-colors hover:text-brand-700"
    >
      <IconArrowLeft className="size-4" />
      返回课题列表
    </Link>
  );
}

function EvaluationCard({ evaluation }: { evaluation: Evaluation }) {
  const comment = evaluation.comment?.trim() ?? "";
  const teacherName = evaluation.teacher?.name;

  return (
    <li className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-brand-900">
          <span className="grid size-8 place-items-center rounded-full bg-brand-50 text-brand-700">
            <IconAward className="size-4" />
          </span>
          {teacherName ? `${teacherName} 老师` : "老师评价"}
        </span>
        <span className="text-xs text-ink-soft">{formatDateTime(evaluation.createdAt)}</span>
      </div>
      <div className="mt-3">
        <EvaluationScores scores={evaluation.scores} />
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-soft">
        {comment || "老师没有填写评语。"}
      </p>
    </li>
  );
}

export default function StudentTopicDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<StudentTopicDetail | null>(null);
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
        setData(await api.get<StudentTopicDetail>(`/api/student/topics/${id}`));
        setNotFound(false);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          setData(null);
        } else {
          setError(errorMessage(err, "课题加载失败，请稍后重试。"));
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
        <LoadingCard label="正在加载课题…" />
      </AppShell>
    );
  }

  if (notFound) {
    return (
      <AppShell user={user}>
        <BackLink />
        <EmptyState
          icon={<IconFile />}
          title="课题不存在或你不在该课题"
          description="课题可能已被删除，或者老师已经把你移出。可以返回课题列表查看其他课题。"
          action={
            <Link to="/student/topics" className={buttonClass("primary", "sm")}>
              返回课题列表
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
        <ErrorCard message={error ?? "课题不存在或你不在该课题"} onRetry={() => void load()} />
      </AppShell>
    );
  }

  const closed = data.status === "CLOSED";
  const submission = data.mySubmission;
  const submissionText = submission?.textContent ?? "";
  const submissionFiles = submission?.files ?? [];
  const evaluations = data.myEvaluations ?? [];
  const evaluated = evaluations.length > 0;
  const latestEvaluation =
    [...evaluations].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  const ownerName = data.owner?.name?.trim();
  const assistantNames = (data.assistants ?? []).map((assistant) => assistant.name).filter(Boolean);
  const headerMeta = ownerName ? `${ownerName} 老师` : "课题";
  const description = assistantNames.length
    ? `${headerMeta} · 助教 ${assistantNames.join("、")}`
    : headerMeta;

  return (
    <AppShell user={user}>
      <BackLink />
      <PageHeader
        eyebrow="课题详情"
        title={data.title}
        description={description}
        actions={
          <Badge tone={closed ? "neutral" : "brand"}>{closed ? "已关闭" : "进行中"}</Badge>
        }
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>课题介绍</CardTitle>
            <CardDescription>老师写的课题说明与要求</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.descriptionMd?.trim() ? (
            <Markdown content={data.descriptionMd} />
          ) : (
            <p className="text-sm text-ink-soft">老师还没有填写课题介绍。</p>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-2 space-y-6 lg:order-1">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>我的提交</CardTitle>
                <CardDescription>
                  {evaluated
                    ? "老师已评价，提交内容已锁定"
                    : "老师会看到你最新一次提交的文本与附件"}
                </CardDescription>
              </div>
              <Badge tone={submission ? "success" : "warning"}>
                {submission ? "已提交" : "未提交"}
              </Badge>
            </CardHeader>
            <CardContent>
              {!submission ? (
                <p className="text-sm text-ink-soft">
                  还没有提交。在提交表单里填写文本、选择附件后提交即可；提交后仍可重新提交。
                </p>
              ) : (
                <div className="space-y-4">
                  <p className="flex items-center gap-1.5 text-xs text-ink-soft">
                    <IconClock className="size-3.5" />
                    最后提交时间：{formatDateTime(submission.updatedAt)}
                  </p>

                  {submissionText.trim() ? (
                    <div>
                      <p className="text-xs font-medium text-ink-soft">文本内容</p>
                      <p className="mt-1 whitespace-pre-wrap rounded-xl border border-line bg-brand-50/40 px-3.5 py-3 text-sm leading-6 text-ink">
                        {submissionText}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-soft">本次提交没有文本内容。</p>
                  )}

                  <div>
                    <p className="text-xs font-medium text-ink-soft">
                      附件（{submissionFiles.length}）
                    </p>
                    {submissionFiles.length === 0 ? (
                      <p className="mt-1 text-sm text-ink-soft">本次提交没有附件。</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {submissionFiles.map((file) => (
                          <li key={file.id}>
                            <a
                              href={`/api/student/files/${file.id}`}
                              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <IconFile className="size-4 shrink-0 text-brand-600" />
                                <span className="truncate font-medium text-brand-900">
                                  {file.originalName || "附件"}
                                </span>
                              </span>
                              <span className="shrink-0 text-xs text-ink-soft">
                                {formatFileSize(file.sizeBytes)} · 下载
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>我的评价</CardTitle>
                <CardDescription>老师对这份提交的历史评价</CardDescription>
              </div>
              <Badge tone="brand">{evaluations.length} 次</Badge>
            </CardHeader>
            <CardContent>
              {evaluations.length === 0 ? (
                <EmptyState
                  icon={<IconAward />}
                  title="还没有评价"
                  description="老师评价你的提交后，这里会显示维度分数和评语。"
                />
              ) : (
                <ul className="space-y-4">
                  {evaluations.map((evaluation) => (
                    <EvaluationCard key={evaluation.id} evaluation={evaluation} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="order-1 lg:order-2 lg:sticky lg:top-8 lg:self-start">
          {evaluated ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>本次评价</CardTitle>
                  <CardDescription>老师已完成评价，提交内容已锁定</CardDescription>
                </div>
                <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <IconCheck />
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                {latestEvaluation ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                      <span className="font-medium text-brand-900">
                        {latestEvaluation.teacher?.name
                          ? `${latestEvaluation.teacher.name} 老师`
                          : "老师评价"}
                      </span>
                      <span>{formatDateTime(latestEvaluation.createdAt)}</span>
                    </div>
                    <EvaluationScores scores={latestEvaluation.scores} />
                    <p className="whitespace-pre-wrap text-sm leading-6 text-ink-soft">
                      {latestEvaluation.comment?.trim() || "老师没有填写评语。"}
                    </p>
                    <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs leading-relaxed text-brand-800">
                      老师已评价，不能重新提交；全部历史评价见下方「我的评价」。
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-ink-soft">老师已评价，提交内容已锁定。</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{submission ? "重新提交" : "提交"}</CardTitle>
                  <CardDescription>
                    {closed ? "课题已关闭，提交已停止" : "文本 + 任意附件，可多次提交"}
                  </CardDescription>
                </div>
                <span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-700">
                  {submission ? <IconCheck /> : <IconFile />}
                </span>
              </CardHeader>
              <CardContent>
                <SubmitForm
                  topicId={data.id}
                  closed={closed}
                  evaluated={evaluated}
                  submission={submission}
                  onSubmitted={() => void load(false)}
                />
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
