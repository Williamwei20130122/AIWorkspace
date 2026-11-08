import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowRight, IconClipboard } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { DueBadge } from "@/components/teacher/DueBadge";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { Panel } from "@/components/teacher/Panel";
import { api, errorMessage } from "@/lib/api";
import type { TeacherAssignmentListItem } from "@/lib/types";

export default function TeacherAssignments() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<TeacherAssignmentListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssignments(await api.get<TeacherAssignmentListItem[]>("/api/teacher/assignments"));
    } catch (err) {
      setError(errorMessage(err, "作业列表加载失败，请刷新页面重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  const pendingTotal = (assignments ?? []).reduce(
    (sum, assignment) => sum + (assignment.submittedCount - assignment.gradedCount),
    0,
  );

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="教师工作台"
        title="作业与批改"
        description={`共 ${assignments?.length ?? 0} 份作业，其中 ${pendingTotal} 份提交待批改。点击任意一行进入作业详情，查看提交并打分。`}
        actions={
          <Link to="/teacher/classes" className={buttonClass("secondary", "sm")}>
            我的班级
          </Link>
        }
      />

      {loading && !assignments ? (
        <LoadingState label="正在加载作业…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : assignments ? (
        assignments.length === 0 ? (
          <EmptyState
            icon={<IconClipboard />}
            title="还没有发布作业"
            description="进入班级详情，为课程发布第一份作业。"
            action={
              <Link to="/teacher/classes" className={buttonClass("primary", "sm")}>
                去发布作业
              </Link>
            }
          />
        ) : (
          <Panel
            title="全部作业"
            description="按创建时间倒序"
            action={
              pendingTotal > 0 ? (
                <Badge tone="warning">待批改 {pendingTotal} 份提交</Badge>
              ) : (
                <Badge tone="success">全部批改完成</Badge>
              )
            }
            bodyClassName="pt-1"
          >
            <div className="-mx-5 overflow-hidden">
              <div className="hidden border-b border-line bg-brand-50/50 px-5 py-2.5 text-xs font-semibold text-ink-soft md:grid md:grid-cols-[minmax(0,1fr)_10rem_10rem_4.5rem_1.25rem] md:items-center md:gap-4">
                <span>作业</span>
                <span>截止时间</span>
                <span>提交进度</span>
                <span className="text-right">分值</span>
                <span aria-hidden="true" />
              </div>
              <ul className="divide-y divide-line">
                {assignments.map((assignment) => (
                  <AssignmentRow key={assignment.id} assignment={assignment} />
                ))}
              </ul>
            </div>
          </Panel>
        )
      ) : null}
    </AppShell>
  );
}

function AssignmentRow({ assignment }: { assignment: TeacherAssignmentListItem }) {
  const pendingCount = assignment.submittedCount - assignment.gradedCount;

  return (
    <li>
      <Link
        to={`/teacher/assignments/${assignment.id}`}
        className="group grid gap-2 px-5 py-4 transition-colors hover:bg-brand-50/40 md:grid-cols-[minmax(0,1fr)_10rem_10rem_4.5rem_1.25rem] md:items-center md:gap-4"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-brand-900 group-hover:text-brand-700">
            {assignment.title}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-soft">
            <span className="truncate">{assignment.course.title}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{assignment.course.class.name}</span>
            <span aria-hidden="true" className="md:hidden">
              ·
            </span>
            <span className="md:hidden">{assignment.points} 分</span>
          </p>
        </div>

        <div>
          <DueBadge dueAt={assignment.dueAt} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-soft">
            已交 {assignment.submittedCount} · 已批 {assignment.gradedCount}
          </span>
          {pendingCount > 0 ? (
            <Badge tone="warning">待批 {pendingCount}</Badge>
          ) : assignment.submittedCount > 0 ? (
            <Badge tone="success">已批完</Badge>
          ) : (
            <Badge tone="neutral">暂无提交</Badge>
          )}
        </div>

        <div className="hidden text-right text-sm font-semibold text-brand-900 md:block">
          {assignment.points} 分
        </div>

        <IconArrowRight className="hidden size-4 justify-self-end text-ink-soft/60 transition-colors group-hover:text-brand-600 md:block" />
      </Link>
    </li>
  );
}
