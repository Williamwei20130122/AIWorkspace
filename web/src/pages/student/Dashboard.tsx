import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { EvaluationList } from "@/components/student/EvaluationList";
import { ErrorCard, LoadingCard } from "@/components/student/PageState";
import { PasswordCard } from "@/components/student/PasswordCard";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAward, IconBook, IconCheck, IconClipboard } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { StudentOverview, StudentTopicSummary } from "@/lib/types";

function TopicRow({ topic }: { topic: StudentTopicSummary }) {
  const closed = topic.status === "CLOSED";
  const ownerName = topic.owner?.name;
  // /api/student/overview 的 topics 只保证 id/title/status/submitted，
  // owner/updatedAt 有则展示，没有就不显示，避免出现「更新于 —」。
  const meta = [
    ownerName ? `${ownerName} 老师` : null,
    topic.updatedAt ? `更新于 ${formatDate(topic.updatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <Link
        to={`/student/topics/${topic.id}`}
        className="group flex items-center justify-between gap-3"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-brand-900 transition-colors group-hover:text-brand-700">
              {topic.title}
            </span>
            {topic.removedAt ? <Badge tone="neutral">历史</Badge> : null}
            <Badge tone={closed ? "neutral" : "brand"}>{closed ? "已关闭" : "进行中"}</Badge>
          </span>
          {meta ? <span className="mt-1 block truncate text-xs text-ink-soft">{meta}</span> : null}
        </span>
        <Badge tone={topic.submitted ? "success" : "warning"}>
          {topic.submitted ? "已提交" : "未提交"}
        </Badge>
      </Link>
    </li>
  );
}

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
      setError(errorMessage(err, "工作台数据加载失败，请稍后重试。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  const topics = data?.topics ?? [];
  const orderedTopics = [
    ...topics.filter((topic) => !topic.removedAt),
    ...topics.filter((topic) => Boolean(topic.removedAt)),
  ];
  const recentEvaluations = data?.latestEvaluations ?? [];

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="学生工作台"
        title={`你好，${user.name}`}
        description="你参与的课题、待提交的任务和最新评价都在这里。"
        actions={
          <Link to="/student/topics" className={buttonClass("primary", "sm")}>
            查看我的课题
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
              label="我的课题"
              value={data.topicCount}
              hint="老师把你加入的课题（含历史）"
              icon={<IconBook />}
            />
            <StatCard
              label="待提交"
              value={data.pendingSubmissionCount}
              hint="还没有提交的课题"
              icon={<IconClipboard />}
              tone="warning"
            />
            <StatCard
              label="已提交"
              value={data.submittedCount}
              hint="已提交过的课题"
              icon={<IconCheck />}
              tone="success"
            />
            <StatCard
              label="近期评价"
              value={recentEvaluations.length}
              hint="最近收到的评价"
              icon={<IconAward />}
              tone="accent"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>我的课题</CardTitle>
                  <CardDescription>进行中的课题与已结束的历史课题</CardDescription>
                </div>
                <Link to="/student/topics" className={buttonClass("secondary", "sm")}>
                  全部课题
                </Link>
              </CardHeader>
              <CardContent>
                {orderedTopics.length === 0 ? (
                  <EmptyState
                    icon={<IconBook />}
                    title="还没有课题"
                    description="老师把你加入课题后，这里会显示课题与提交入口。"
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {orderedTopics.map((topic) => (
                      <TopicRow key={topic.id} topic={topic} />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>最近评价</CardTitle>
                    <CardDescription>老师对你提交的近期评价</CardDescription>
                  </div>
                  <Link
                    to="/student/evaluations"
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    查看全部
                  </Link>
                </CardHeader>
                <CardContent>
                  {recentEvaluations.length === 0 ? (
                    <EmptyState
                      icon={<IconAward />}
                      title="还没有评价"
                      description="老师评价你的提交后，这里会显示维度分数和评语。"
                    />
                  ) : (
                    <EvaluationList items={recentEvaluations} compact />
                  )}
                </CardContent>
              </Card>

              <PasswordCard hasPassword={user.hasPassword} />
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
