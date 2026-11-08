import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  IconAward,
  IconBook,
  IconCheck,
  IconClipboard,
  IconUsers,
} from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { Panel } from "@/components/teacher/Panel";
import { TopicStatusBadge } from "@/components/teacher/StatusBadge";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/format";
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

  const pendingSubmissions = overview?.pendingSubmissions ?? [];
  const recentEvaluations = (overview?.recentEvaluations ?? []).slice(0, 5);
  const topics = overview?.topics ?? [];

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="教师工作台"
        title={`你好，${user.name}`}
        description="先处理左侧「待评价队列」里最早的提交，学生就能尽快看到反馈；下面的课题表格可以快速进入课题管理。"
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
          {/* 顶部统计 */}
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
              value={recentEvaluations.length}
              hint="最近做出的评价（最多 5 条）"
              icon={<IconAward />}
              tone="neutral"
            />
          </div>

          {/* 待评价队列 + 最近评价 */}
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Panel
              title="待评价队列"
              description="按提交时间升序，最早提交的排在最前"
              action={
                overview.pendingEvaluationCount > 0 ? (
                  <Badge tone="warning">共 {overview.pendingEvaluationCount} 份待评价</Badge>
                ) : (
                  <Badge tone="success">已全部评价</Badge>
                )
              }
            >
              {pendingSubmissions.length === 0 ? (
                <EmptyState
                  icon={<IconCheck />}
                  title="暂无待评价提交"
                  description="学生提交后，未评价的提交会按时间排在这里。"
                />
              ) : (
                <>
                  {/* 桌面表格 */}
                  <div className="-mx-1 hidden md:block">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-line text-xs text-ink-soft">
                        <tr>
                          <th scope="col" className="px-1 pb-2 font-semibold">学生</th>
                          <th scope="col" className="px-1 pb-2 font-semibold">课题</th>
                          <th scope="col" className="px-1 pb-2 font-semibold">提交时间</th>
                          <th scope="col" className="px-1 pb-2 text-right font-semibold">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {pendingSubmissions.map((item) => (
                          <tr key={item.id} className="transition-colors hover:bg-brand-50/50">
                            <td className="px-1 py-2.5">
                              <span className="flex items-center gap-2">
                                <Avatar name={item.student.name} size="sm" />
                                <span className="truncate font-medium text-brand-900">{item.student.name}</span>
                              </span>
                            </td>
                            <td className="max-w-56 px-1 py-2.5">
                              <Link
                                to={`/teacher/topics/${item.topicId}`}
                                className="block truncate text-ink-soft hover:text-brand-700"
                                title={item.topicTitle}
                              >
                                {item.topicTitle}
                              </Link>
                            </td>
                            <td className="whitespace-nowrap px-1 py-2.5 text-xs text-ink-soft">
                              {formatDateTime(item.submittedAt)}
                            </td>
                            <td className="px-1 py-2.5 text-right">
                              <Link
                                to={`/teacher/topics/${item.topicId}`}
                                className={buttonClass("secondary", "sm")}
                              >
                                去评价
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 移动卡片 */}
                  <ul className="space-y-2 md:hidden">
                    {pendingSubmissions.map((item) => (
                      <li key={item.id} className="rounded-xl border border-line bg-white p-3">
                        <div className="flex items-start gap-2.5">
                          <Avatar name={item.student.name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-brand-900">
                              {item.student.name}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-ink-soft">{item.topicTitle}</p>
                            <p className="mt-1 text-[11px] text-ink-soft">
                              提交于 {formatDateTime(item.submittedAt)}
                            </p>
                          </div>
                        </div>
                        <Link
                          to={`/teacher/topics/${item.topicId}`}
                          className={cn(buttonClass("secondary", "sm"), "mt-2.5 w-full")}
                        >
                          去评价
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>

            <Panel
              title="最近评价"
              description="最近 5 条评价，点在课题里查看上下文"
              action={
                <Link
                  to="/teacher/evaluations"
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  全部评价
                </Link>
              }
            >
              {recentEvaluations.length === 0 ? (
                <EmptyState
                  icon={<IconAward />}
                  title="还没有评价"
                  description="完成一次评价后，会在这里显示最近记录。"
                />
              ) : (
                <ol className="space-y-0">
                  {recentEvaluations.map((evaluation, index) => (
                    <li
                      key={evaluation.id}
                      className={cn(
                        "relative border-l border-line pl-4",
                        index === recentEvaluations.length - 1 ? "pb-0" : "pb-4",
                      )}
                    >
                      <span
                        className="absolute -left-[5px] top-1 size-2.5 rounded-full border-2 border-white bg-brand-500"
                        aria-hidden="true"
                      />
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <Link
                          to={`/teacher/topics/${evaluation.topic.id}`}
                          className="truncate text-sm font-semibold text-brand-900 hover:text-brand-700"
                        >
                          {evaluation.student.name}
                        </Link>
                        <span className="shrink-0 text-[11px] text-ink-soft">
                          {formatDateTime(evaluation.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-ink-soft">{evaluation.topic.title}</p>
                      {evaluation.comment.trim() ? (
                        <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs leading-5 text-ink-soft">
                          {evaluation.comment}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-ink-soft/80">（没有写评语）</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>

          {/* 我的课题 */}
          <Panel
            title={`我的课题（${topics.length}）`}
            description="成员、提交与待评价一览；完整的搜索与分页在课题管理里"
            action={
              <Link to="/teacher/topics" className="text-xs font-semibold text-brand-600 hover:text-brand-700">
                课题管理
              </Link>
            }
          >
            {topics.length === 0 ? (
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
              <>
                {/* 桌面紧凑表格 */}
                <div className="-mx-1 hidden md:block">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-line text-xs text-ink-soft">
                      <tr>
                        <th scope="col" className="px-1 pb-2 font-semibold">课题</th>
                        <th scope="col" className="px-1 pb-2 font-semibold">状态</th>
                        <th scope="col" className="px-1 pb-2 text-right font-semibold">成员</th>
                        <th scope="col" className="px-1 pb-2 text-right font-semibold">提交</th>
                        <th scope="col" className="px-1 pb-2 text-right font-semibold">待评价</th>
                        <th scope="col" className="px-1 pb-2 text-right font-semibold">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {topics.map((topic) => (
                        <tr key={topic.id} className="transition-colors hover:bg-brand-50/50">
                          <td className="max-w-80 px-1 py-2.5">
                            <Link
                              to={`/teacher/topics/${topic.id}`}
                              className="block truncate font-semibold text-brand-900 hover:text-brand-700"
                              title={topic.title}
                            >
                              {topic.title}
                            </Link>
                          </td>
                          <td className="px-1 py-2.5">
                            <TopicStatusBadge status={topic.status} />
                          </td>
                          <td className="px-1 py-2.5 text-right tabular-nums text-ink-soft">
                            {topic.memberCount}
                          </td>
                          <td className="px-1 py-2.5 text-right tabular-nums text-ink-soft">
                            {topic.submissionCount}
                          </td>
                          <td className="px-1 py-2.5 text-right tabular-nums">
                            {topic.pendingCount > 0 ? (
                              <span className="font-semibold text-amber-700">{topic.pendingCount}</span>
                            ) : (
                              <span className="text-ink-soft/70">0</span>
                            )}
                          </td>
                          <td className="px-1 py-2.5 text-right">
                            <Link
                              to={`/teacher/topics/${topic.id}`}
                              className={buttonClass("secondary", "sm")}
                            >
                              查看
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 移动卡片 */}
                <ul className="space-y-2 md:hidden">
                  {topics.map((topic) => (
                    <li key={topic.id}>
                      <Link
                        to={`/teacher/topics/${topic.id}`}
                        className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3 transition-colors hover:border-brand-300"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-brand-900">
                            {topic.title}
                          </span>
                          <TopicStatusBadge status={topic.status} />
                        </div>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                          <span>{topic.memberCount} 名学生</span>
                          <span>{topic.submissionCount} 份提交</span>
                          <span
                            className={cn(
                              topic.pendingCount > 0 ? "font-medium text-amber-700" : "",
                            )}
                          >
                            {topic.pendingCount > 0 ? `${topic.pendingCount} 份待评价` : "没有待评价"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </div>
      ) : null}
    </AppShell>
  );
}
