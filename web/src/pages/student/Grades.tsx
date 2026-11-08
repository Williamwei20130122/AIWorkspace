import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { ErrorCard, LoadingCard } from "@/components/student/PageState";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChart } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDateTime, scorePercent } from "@/lib/format";
import type { GradeItem } from "@/lib/types";

type GradeGroup = {
  key: string;
  className: string;
  courseTitle: string;
  items: GradeItem[];
};

function percentTone(percent: number): string {
  if (percent >= 85) return "bg-brand-600";
  if (percent >= 60) return "bg-amber-500";
  return "bg-red-500";
}

function ProgressBar({ percent }: { percent: number | null }) {
  const safe = percent === null ? 0 : Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={safe}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`得分率 ${safe}%`}
    >
      <div className={cn("h-full rounded-full", percentTone(safe))} style={{ width: `${safe}%` }} />
    </div>
  );
}

export default function StudentGrades() {
  const { user } = useAuth();
  const [grades, setGrades] = useState<GradeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGrades(await api.get<GradeItem[]>("/api/student/grades"));
    } catch (err) {
      setError(errorMessage(err, "成绩加载失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const percents = grades
      .map((item) => scorePercent(item.score, item.assignment.points))
      .filter((value): value is number => value !== null);
    const average = percents.length
      ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length)
      : null;
    return { average, count: percents.length };
  }, [grades]);

  const groups = useMemo(() => {
    const map = new Map<string, GradeGroup>();
    for (const item of grades) {
      const className = item.assignment.course.class.name;
      const courseTitle = item.assignment.course.title;
      const key = `${className} · ${courseTitle}`;
      const existing = map.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(key, { key, className, courseTitle, items: [item] });
      }
    }
    return [...map.values()];
  }, [grades]);

  if (!user) return null;

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="成绩单"
        title="我的成绩"
        description="按班级和课程汇总的已批改作业；平均分按得分率计算。"
        actions={
          <Link to="/student/assignments" className={buttonClass("secondary", "sm")}>
            查看我的作业
          </Link>
        }
      />

      {loading ? (
        <LoadingCard label="正在加载成绩…" />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : grades.length === 0 ? (
        <EmptyState
          icon={<IconChart />}
          title="还没有成绩"
          description="老师批改作业后，得分、得分率和评语会显示在这里。"
          action={
            <Link to="/student/assignments" className={buttonClass("primary", "sm")}>
              去完成作业
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-ink-soft">平均得分率</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-brand-900">
                  {summary.average === null ? "—" : `${summary.average}%`}
                </p>
              </div>
              <div className="min-w-0 flex-1 sm:max-w-md">
                <ProgressBar percent={summary.average} />
                <p className="mt-2 text-xs text-ink-soft">
                  {summary.average === null
                    ? "还没有已批改的作业"
                    : "按每份作业的得分率取平均，仅供参考"}
                </p>
              </div>
              <div className="shrink-0 text-sm text-ink-soft">
                已批改 <span className="text-xl font-semibold text-brand-900">{summary.count}</span> 份
              </div>
            </CardContent>
          </Card>

          {groups.map((group) => (
            <Card key={group.key}>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle className="truncate">{group.courseTitle}</CardTitle>
                  <CardDescription>{group.className}</CardDescription>
                </div>
                <Badge tone="neutral">{group.items.length} 份</Badge>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-line">
                  {group.items.map((item) => {
                    const percent = scorePercent(item.score, item.assignment.points);
                    return (
                      <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link
                            to={`/student/assignments/${item.assignment.id}`}
                            className="min-w-0 truncate text-sm font-semibold text-brand-900 hover:text-brand-700"
                          >
                            {item.assignment.title}
                          </Link>
                          <p className="text-sm font-semibold text-brand-900">
                            {item.score} / {item.assignment.points}
                            <span className="ml-1.5 text-xs font-medium text-ink-soft">
                              （{percent === null ? "—" : `${percent}%`}）
                            </span>
                          </p>
                        </div>
                        <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                          <ProgressBar percent={percent} />
                          <span className="shrink-0 text-xs text-ink-soft">
                            提交于 {formatDateTime(item.submittedAt)}
                          </span>
                        </div>
                        {item.feedback ? (
                          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-soft">
                            教师评语：{item.feedback}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
