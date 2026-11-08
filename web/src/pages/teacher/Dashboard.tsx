import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAward, IconBook, IconClipboard, IconUsers } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { Panel } from "@/components/teacher/Panel";
import { TopicStatusBadge } from "@/components/teacher/StatusBadge";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { TeacherOverview } from "@/lib/types";

export default function TeacherDashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<TeacherOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await api.get<TeacherOverview>("/api/teacher/overview"));
    } catch (err) {
      setError(errorMessage(err, "工作台加载失败，请刷新页面重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="教师工作台"
        title={`你好，${user.name}`}
        description="这里汇总了你的课题、学生与评价进度。先把待评价的提交处理掉，学生就能尽快看到反馈。"
        actions={
          <>
            <Link to="/teacher/students" className={buttonClass("secondary", "sm")}>
              学生管理
            </Link>
            <Link to="/teacher/topics" className={buttonClass("accent", "sm")}>
              我的课题
            </Link>
          </>
        }
      />

      {loading && !overview ? (
        <LoadingState label="正在加载工作台…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : overview ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="课题数"
              value={overview.topicCount}
              hint="我创建或协助的课题"
              icon={<IconBook />}
              tone="brand"
            />
            <StatCard
              label="管理学生数"
              value={overview.studentCount}
              hint="我创建或关联的学生"
              icon={<IconUsers />}
              tone="brand"
            />
            <StatCard
              label="待评价数"
              value={overview.pendingEvaluationCount}
              hint={overview.pendingEvaluationCount > 0 ? "学生正在等反馈" : "所有提交都已评价"}
              icon={<IconClipboard />}
              tone={overview.pendingEvaluationCount > 0 ? "accent" : "success"}
            />
            <StatCard
              label="近期评价数"
              value={overview.recentEvaluations.length}
              hint="最近做出的评价"
              icon={<IconAward />}
              tone="neutral"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Panel
              title="我的课题"
              description="按课题查看成员、提交与待评价情况"
              action={
                <Link to="/teacher/topics" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
                  管理全部课题
                </Link>
              }
            >
              {overview.topics.length === 0 ? (
                <EmptyState
                  icon={<IconBook />}
                  title="还没有课题"
                  description="创建第一个课题，添加学生后就可以收到提交并评价。"
                  action={
                    <Link to="/teacher/topics" className={buttonClass("primary", "sm")}>
                      去创建课题
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-line">
                  {overview.topics.map((topic) => (
                    <li key={topic.id}>
                      <Link
                        to={`/teacher/topics/${topic.id}`}
                        className="group flex flex-wrap items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-brand-50/60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-brand-900 group-hover:text-brand-700">
                            {topic.title}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-soft">
                            <span>{topic.memberCount} 名学生</span>
                            <span aria-hidden="true">·</span>
                            <span>{topic.submissionCount} 份提交</span>
                            {topic.pendingCount > 0 ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-medium text-amber-700">{topic.pendingCount} 份待评价</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                        <TopicStatusBadge status={topic.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="近期评价"
              description="最近做出的评价，点开课题可继续评价"
              action={
                <Link
                  to="/teacher/evaluations"
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  全部评价
                </Link>
              }
            >
              {overview.recentEvaluations.length === 0 ? (
                <EmptyState
                  icon={<IconAward />}
                  title="还没有评价"
                  description="学生提交内容并完成评价后，会显示在这里。"
                />
              ) : (
                <ul className="divide-y divide-line">
                  {overview.recentEvaluations.map((evaluation) => (
                    <li key={evaluation.id}>
                      <Link
                        to={`/teacher/topics/${evaluation.topic.id}`}
                        className="group block rounded-xl px-2 py-3 transition-colors hover:bg-brand-50/60"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-brand-900 group-hover:text-brand-700">
                            {evaluation.student.name}
                            <span className="ml-1.5 text-xs font-normal text-ink-soft">
                              {evaluation.topic.title}
                            </span>
                          </p>
                          <span className="text-[11px] text-ink-soft">
                            {formatDateTime(evaluation.createdAt)}
                          </span>
                        </div>
                        {evaluation.comment.trim() ? (
                          <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs leading-5 text-ink-soft">
                            {evaluation.comment}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-ink-soft">（没有写评语）</p>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            <Badge tone="brand">提示</Badge>
            学生账号由你创建；学生登录后在课题页提交，你可以在课题详情里评价。
          </p>
        </div>
      ) : null}
    </AppShell>
  );
}
