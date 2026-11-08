import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { DueBadge } from "@/components/student/DueBadge";
import { ErrorCard, LoadingCard } from "@/components/student/PageState";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  IconBell,
  IconChart,
  IconCheck,
  IconClipboard,
  IconClock,
  IconUsers,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Announcement, StudentOverview } from "@/lib/types";

/** 公告的班级字段：CONTRACT 用 class.name，types.ts 用 className，两种都兼容 */
type AnnouncementWithClass = Announcement & { class?: { name?: string } };

export default function StudentDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<StudentOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<StudentOverview>("/api/student/overview"));
    } catch (err) {
      setError(errorMessage(err, "工作台数据加载失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  // 契约中 averagePercent 可为 null（无已批改作业）；后端目前以 0 表示同样的含义，
  // 因此在完全没有提交记录时也按「暂无平均分」展示。
  const average = data?.averagePercent ?? null;
  const hasAverage = average !== null && !(average === 0 && (data?.submittedCount ?? 0) === 0);

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="学生工作台"
        title={`你好，${user.name}`}
        description="今天的待交作业、近期截止和班级公告都在这里。"
        actions={
          <Link to="/student/assignments" className={buttonClass("primary", "sm")}>
            查看我的作业
          </Link>
        }
      />

      {loading ? (
        <LoadingCard label="正在加载工作台…" />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="我的班级"
              value={data.classCount}
              hint={`共 ${data.courseCount} 门课程`}
              icon={<IconUsers />}
            />
            <StatCard
              label="待交作业"
              value={data.pendingCount}
              hint="还没有提交的作业"
              icon={<IconClipboard />}
              tone="warning"
            />
            <StatCard
              label="已提交"
              value={data.submittedCount}
              hint="含已批改的作业"
              icon={<IconCheck />}
              tone="success"
            />
            <StatCard
              label="平均分"
              value={hasAverage ? `${average}%` : "—"}
              hint={hasAverage ? "已批改作业的平均得分率" : "还没有已批改的作业"}
              icon={<IconChart />}
              tone="accent"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>即将截止</CardTitle>
                  <CardDescription>按截止时间最近的待交作业</CardDescription>
                </div>
                <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <IconClock />
                </span>
              </CardHeader>
              <CardContent>
                {data.dueSoon.length === 0 ? (
                  <EmptyState
                    icon={<IconCheck />}
                    title="没有待交的作业"
                    description="近期的作业都提交了，去「我的作业」看看历史记录。"
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {data.dueSoon.map((item) => (
                      <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                        <Link
                          to={`/student/assignments/${item.id}`}
                          className="group flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-brand-900 group-hover:text-brand-700">
                              {item.title}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-ink-soft">
                              {item.course.title} · {item.course.class.name} · {item.points} 分
                            </span>
                          </span>
                          <DueBadge dueAt={item.dueAt} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>最近公告</CardTitle>
                  <CardDescription>来自班级的最新通知</CardDescription>
                </div>
                <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <IconBell />
                </span>
              </CardHeader>
              <CardContent>
                {data.recentAnnouncements.length === 0 ? (
                  <EmptyState
                    icon={<IconBell />}
                    title="暂无公告"
                    description="老师发布班级公告后会显示在这里。"
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {data.recentAnnouncements.map((raw) => {
                      const item = raw as AnnouncementWithClass;
                      const className = item.className ?? item.class?.name;
                      return (
                        <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-semibold text-brand-900">{item.title}</p>
                            {className ? <Badge tone="brand">{className}</Badge> : null}
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-soft">
                            {item.content}
                          </p>
                          <p className="mt-1 text-xs text-ink-soft/80">{formatDate(item.createdAt)}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
