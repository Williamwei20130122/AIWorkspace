import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { buttonClass } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowRight, IconBook, IconPlus } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { CreateTopicForm } from "@/components/teacher/CreateTopicForm";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { Panel } from "@/components/teacher/Panel";
import { TopicStatusBadge } from "@/components/teacher/StatusBadge";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { TopicSummary } from "@/lib/types";

export default function TeacherTopics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [topics, setTopics] = useState<TopicSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTopics(await api.get<TopicSummary[]>("/api/teacher/topics"));
    } catch (err) {
      setError(errorMessage(err, "课题列表加载失败，请刷新页面重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  const pendingTotal = (topics ?? []).reduce((sum, topic) => sum + topic.pendingCount, 0);

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="教师工作台"
        title="我的课题"
        description="课题由你创建，可邀请最多 3 名助教、添加学生并自定义评价维度。学生提交后在这里评价。"
        actions={
          <>
            <Link to="/teacher/evaluations" className={buttonClass("secondary", "sm")}>
              评价汇总
            </Link>
            <a href="#create-topic" className={buttonClass("accent", "sm")}>
              <IconPlus className="size-4" />
              新建课题
            </a>
          </>
        }
      />

      {loading && !topics ? (
        <LoadingState label="正在加载课题…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : topics ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section>
            <SectionTitle
              title={`全部课题（${topics.length}）`}
              action={
                pendingTotal > 0 ? (
                  <span className="text-xs font-medium text-amber-700">共 {pendingTotal} 份提交待评价</span>
                ) : (
                  <span className="text-xs text-ink-soft">没有待评价提交</span>
                )
              }
            />
            {topics.length === 0 ? (
              <EmptyState
                icon={<IconBook />}
                title="还没有课题"
                description="创建第一个课题，添加学生后就可以收到提交并评价。"
                action={
                  <a href="#create-topic" className={buttonClass("primary", "sm")}>
                    去创建课题
                  </a>
                }
              />
            ) : (
              <ul className="space-y-3">
                {topics.map((topic) => (
                  <TopicCard key={topic.id} topic={topic} />
                ))}
              </ul>
            )}
          </section>

          <aside id="create-topic" className="scroll-mt-24">
            <Panel
              title="新建课题"
              description="填写标题即可创建，介绍页稍后在详情里编辑"
              className="xl:sticky xl:top-6"
            >
              <CreateTopicForm onCreated={(topicId) => navigate(`/teacher/topics/${topicId}`)} />
            </Panel>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}

function TopicCard({ topic }: { topic: TopicSummary }) {
  return (
    <li>
      <Link
        to={`/teacher/topics/${topic.id}`}
        className="aw-card group flex flex-col gap-3 p-4 transition-colors hover:border-brand-300 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-brand-900 group-hover:text-brand-700">
              {topic.title}
            </h3>
            <p className="mt-1 text-xs text-ink-soft">
              {topic.isOwner ? `我创建的课题 · 负责人 ${topic.owner.name}` : `创建者 ${topic.owner.name}`}
            </p>
          </div>
          <TopicStatusBadge status={topic.status} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
          <span>{topic.memberCount} 名学生</span>
          <span>{topic.submissionCount} 份提交</span>
          <span className={topic.pendingCount > 0 ? "font-medium text-amber-700" : ""}>
            {topic.pendingCount > 0 ? `${topic.pendingCount} 份待评价` : "没有待评价"}
          </span>
          <span className="text-ink-soft/80">更新于 {formatDateTime(topic.updatedAt)}</span>
        </div>

        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 group-hover:text-brand-700">
          查看课题详情
          <IconArrowRight className="size-3.5" />
        </span>
      </Link>
    </li>
  );
}
