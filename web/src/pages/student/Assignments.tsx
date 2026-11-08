import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { DueBadge } from "@/components/student/DueBadge";
import { ErrorCard, LoadingCard } from "@/components/student/PageState";
import {
  SubmissionBadge,
  submissionStatus,
  type SubmissionStatus,
} from "@/components/student/SubmissionBadge";
import { buttonClass, Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconClipboard, IconFile } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/format";
import type { StudentAssignmentListItem } from "@/lib/types";

type Filter = "all" | SubmissionStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "not-submitted", label: "未提交" },
  { key: "submitted", label: "已提交" },
  { key: "graded", label: "已批改" },
];

export default function StudentAssignments() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<StudentAssignmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssignments(await api.get<StudentAssignmentListItem[]>("/api/student/assignments"));
    } catch (err) {
      setError(errorMessage(err, "作业列表加载失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: assignments.length,
      "not-submitted": 0,
      submitted: 0,
      graded: 0,
    };
    for (const item of assignments) {
      result[submissionStatus(item.mySubmission)] += 1;
    }
    return result;
  }, [assignments]);

  const visible = useMemo(() => {
    // 截止时间早的排前面，没有截止时间的排最后
    const sorted = [...assignments].sort((a, b) => {
      const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });
    if (filter === "all") return sorted;
    return sorted.filter((item) => submissionStatus(item.mySubmission) === filter);
  }, [assignments, filter]);

  if (!user) return null;

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="我的作业"
        title="我的作业"
        description="按状态筛选作业，点开可以查看要求并提交。"
        actions={
          <Link to="/student/classes" className={buttonClass("secondary", "sm")}>
            我的班级
          </Link>
        }
      />

      {loading ? (
        <LoadingCard label="正在加载作业…" />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : assignments.length === 0 ? (
        <EmptyState
          icon={<IconClipboard />}
          title="还没有作业"
          description="加入班级后，老师布置的作业会出现在这里。"
          action={
            <Link to="/student/classes" className={buttonClass("primary", "sm")}>
              去加入班级
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="按状态筛选作业">
            {FILTERS.map((item) => {
              const active = filter === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(item.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-line bg-white text-ink-soft hover:border-brand-300 hover:text-brand-700",
                  )}
                >
                  {item.label}
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      active ? "text-white/80" : "text-ink-soft/70",
                    )}
                  >
                    {counts[item.key]}
                  </span>
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<IconFile />}
              title="没有符合条件的作业"
              description="换一个筛选条件，或者看看「全部」里的作业。"
              action={
                <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>
                  查看全部作业
                </Button>
              }
            />
          ) : (
            <ul className="space-y-3">
              {visible.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/student/assignments/${item.id}`}
                    className="aw-card group flex flex-col gap-3 p-4 transition-colors hover:border-brand-300 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-brand-900 group-hover:text-brand-700">
                          {item.title}
                        </p>
                        <SubmissionBadge submission={item.mySubmission} points={item.points} />
                      </div>
                      <p className="mt-1 text-xs text-ink-soft">
                        {item.course.title} · {item.course.class.name} · {item.points} 分
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                      <DueBadge dueAt={item.dueAt} />
                      {item.mySubmission ? (
                        <span className="text-xs text-ink-soft">
                          提交于 {formatDateTime(item.mySubmission.submittedAt)}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AppShell>
  );
}
