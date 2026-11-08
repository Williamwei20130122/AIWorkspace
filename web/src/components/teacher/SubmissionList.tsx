import { useCallback, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormMessage } from "@/components/ui/form";
import { IconClipboard, IconFile } from "@/components/ui/icons";
import { EvaluationForm } from "@/components/teacher/EvaluationForm";
import { EvaluationScores } from "@/components/teacher/EvaluationScores";
import { PendingBadge } from "@/components/teacher/StatusBadge";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Dimension, SubmissionDetail, SubmissionSummary } from "@/lib/types";

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function newestFirst<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** 课题提交列表：展开可看文本内容、附件与评价历史，并直接评价 */
export function SubmissionList({
  submissions,
  dimensions,
  onChanged,
}: {
  submissions: SubmissionSummary[];
  dimensions: Dimension[];
  onChanged: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, SubmissionDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadDetail = useCallback(async (submissionId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const detail = await api.get<SubmissionDetail>(`/api/teacher/submissions/${submissionId}`);
      setDetails((prev) => ({ ...prev, [submissionId]: detail }));
    } catch (err) {
      setDetailError(errorMessage(err, "提交详情加载失败，请稍后重试"));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function toggle(submissionId: string) {
    if (expandedId === submissionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(submissionId);
    setDetailError(null);
    if (!details[submissionId]) {
      await loadDetail(submissionId);
    }
  }

  async function handleEvaluated(submissionId: string) {
    await loadDetail(submissionId);
    onChanged();
  }

  if (submissions.length === 0) {
    return (
      <EmptyState
        icon={<IconClipboard />}
        title="还没有学生提交"
        description="学生提交内容后会出现在这里，你可以展开查看内容并评价。"
      />
    );
  }

  return (
    <ul className="space-y-2">
      {submissions.map((submission) => {
        const expanded = expandedId === submission.id;
        const detail = details[submission.id];

        return (
          <li key={submission.id} className="overflow-hidden rounded-xl border border-line bg-white">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => void toggle(submission.id)}
              className="flex w-full flex-wrap items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-brand-50/50 sm:px-4"
            >
              <Avatar name={submission.student.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-brand-900">{submission.student.name}</p>
                <p className="truncate text-xs text-ink-soft">
                  学号 {submission.student.loginId} · 提交于 {formatDateTime(submission.updatedAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[11px] text-ink-soft">附件 {submission.fileCount}</span>
                <span className="text-[11px] text-ink-soft">评价 {submission.evaluationCount} 次</span>
                <PendingBadge pending={submission.pending} />
                <span className="text-xs font-medium text-brand-600">{expanded ? "收起" : "展开"}</span>
              </div>
            </button>

            {expanded ? (
              <div className="space-y-4 border-t border-line bg-brand-50/20 px-3 py-4 sm:px-4">
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">文本内容</h4>
                  <p className="mt-1.5 whitespace-pre-wrap break-words rounded-xl border border-line bg-white p-3 text-sm leading-6 text-ink">
                    {(detail?.textContent ?? submission.textContent).trim()
                      ? (detail?.textContent ?? submission.textContent)
                      : "（学生没有填写文字内容）"}
                  </p>
                </section>

                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                    附件{submission.fileCount > 0 ? `（${submission.fileCount}）` : ""}
                  </h4>
                  {detailLoading && !detail ? (
                    <p className="mt-1.5 text-xs text-ink-soft">正在加载附件与评价历史…</p>
                  ) : detailError && !detail ? (
                    <div className="mt-1.5 space-y-2">
                      <FormMessage error={detailError} />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void loadDetail(submission.id)}
                      >
                        重新加载
                      </Button>
                    </div>
                  ) : detail && detail.files.length > 0 ? (
                    <ul className="mt-1.5 space-y-1.5">
                      {detail.files.map((file) => (
                        <li key={file.id}>
                          <a
                            href={`/api/student/files/${file.id}`}
                            className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-50"
                          >
                            <IconFile className="size-4 shrink-0 text-brand-500" />
                            <span className="min-w-0 flex-1 truncate">{file.originalName}</span>
                            <span className="shrink-0 text-xs text-ink-soft">{formatFileSize(file.sizeBytes)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-xs text-ink-soft">没有附件</p>
                  )}
                </section>

                {detail ? (
                  <>
                    <section>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                        评价历史（{detail.evaluations.length}）
                      </h4>
                      {detail.evaluations.length === 0 ? (
                        <p className="mt-1.5 text-xs text-ink-soft">还没有评价过这个提交。</p>
                      ) : (
                        <ul className="mt-1.5 space-y-2">
                          {newestFirst(detail.evaluations).map((evaluation) => (
                            <li key={evaluation.id} className="rounded-xl border border-line bg-white p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-medium text-brand-800">
                                  {evaluation.teacher?.name ?? "教师"} 的评价
                                </span>
                                <span className="text-[11px] text-ink-soft">
                                  {formatDateTime(evaluation.createdAt)}
                                </span>
                              </div>
                              <EvaluationScores scores={evaluation.scores} className="mt-2" />
                              {evaluation.comment.trim() ? (
                                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink-soft">
                                  {evaluation.comment}
                                </p>
                              ) : (
                                <p className="mt-2 text-xs text-ink-soft">（没有写评语）</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section>
                      <EvaluationForm
                        submissionId={submission.id}
                        dimensions={dimensions}
                        initialScores={submission.latestEvaluation?.scores ?? []}
                        onSubmitted={() => handleEvaluated(submission.id)}
                      />
                    </section>
                  </>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
