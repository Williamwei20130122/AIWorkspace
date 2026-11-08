import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { buttonClass } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAward } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { EvaluationScores } from "@/components/teacher/EvaluationScores";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { EvaluationListItem } from "@/lib/types";

export default function TeacherEvaluations() {
  const { user } = useAuth();
  const [evaluations, setEvaluations] = useState<EvaluationListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvaluations(await api.get<EvaluationListItem[]>("/api/teacher/evaluations"));
    } catch (err) {
      setError(errorMessage(err, "评价列表加载失败，请刷新页面重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () =>
      [...(evaluations ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [evaluations],
  );

  if (!user) return null;

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="教师工作台"
        title="评价汇总"
        description="我管理课题下的全部评价，按时间倒序排列。点课题标题可进入详情继续评价。"
        actions={
          <Link to="/teacher/topics" className={buttonClass("secondary", "sm")}>
            我的课题
          </Link>
        }
      />

      {loading && !evaluations ? (
        <LoadingState label="正在加载评价…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : evaluations ? (
        <div>
          <SectionTitle
            title={`全部评价（${sorted.length}）`}
            action={<span className="text-xs text-ink-soft">最新评价在最上面</span>}
          />
          {sorted.length === 0 ? (
            <EmptyState
              icon={<IconAward />}
              title="还没有评价"
              description="在课题详情里对学生提交打分并写评语后，评价会汇总到这里。"
              action={
                <Link to="/teacher/topics" className={buttonClass("primary", "sm")}>
                  去课题里评价
                </Link>
              }
            />
          ) : (
            <ul className="space-y-3">
              {sorted.map((evaluation) => (
                <li key={evaluation.id} className="aw-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to={`/teacher/topics/${evaluation.topic.id}`}
                        className="text-sm font-semibold text-brand-900 hover:text-brand-700"
                      >
                        {evaluation.topic.name ?? evaluation.topic.title ?? "课题"}
                      </Link>
                      <p className="mt-1 text-xs text-ink-soft">
                        学生 {evaluation.student.name} · 评价人 {evaluation.teacher?.name ?? "教师"}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-soft">
                      {formatDateTime(evaluation.createdAt)}
                    </span>
                  </div>

                  <EvaluationScores scores={evaluation.scores} className="mt-3" />

                  {evaluation.comment.trim() ? (
                    <p className="mt-3 whitespace-pre-wrap break-words border-t border-line pt-3 text-sm leading-6 text-ink-soft">
                      {evaluation.comment}
                    </p>
                  ) : (
                    <p className="mt-3 border-t border-line pt-3 text-xs text-ink-soft">（没有写评语）</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </AppShell>
  );
}
