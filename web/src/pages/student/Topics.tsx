import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { ErrorCard, LoadingCard } from "@/components/student/PageState";
import { Badge } from "@/components/ui/badge";
import { Card, SectionTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowRight, IconBook } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { StudentTopicSummary } from "@/lib/types";

function TopicCard({ topic }: { topic: StudentTopicSummary }) {
  const closed = topic.status === "CLOSED";
  const ownerName = topic.owner?.name;

  return (
    <Link to={`/student/topics/${topic.id}`} className="group block">
      <Card className="h-full p-5 transition-colors group-hover:border-brand-300">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-brand-900 transition-colors group-hover:text-brand-700">
              {topic.title}
            </h2>
            <p className="mt-1 truncate text-xs text-ink-soft">
              {ownerName ? `${ownerName} 老师 · ` : ""}更新于 {formatDate(topic.updatedAt)}
            </p>
          </div>
          <IconArrowRight className="mt-0.5 size-4 shrink-0 text-ink-soft/60 transition-colors group-hover:text-brand-600" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={closed ? "neutral" : "brand"}>{closed ? "已关闭" : "进行中"}</Badge>
          <Badge tone={topic.submitted ? "success" : "warning"}>
            {topic.submitted ? "已提交" : "未提交"}
          </Badge>
          {topic.removedAt ? <Badge tone="neutral">历史 · 已移出</Badge> : null}
        </div>
      </Card>
    </Link>
  );
}

export default function StudentTopics() {
  const { user } = useAuth();
  const [topics, setTopics] = useState<StudentTopicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTopics(await api.get<StudentTopicSummary[]>("/api/student/topics"));
    } catch (err) {
      setError(errorMessage(err, "课题列表加载失败，请稍后重试。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  const currentTopics = topics.filter((topic) => !topic.removedAt);
  const historyTopics = topics.filter((topic) => Boolean(topic.removedAt));

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="我的课题"
        title="我的课题"
        description="老师把你加入课题后，这里会显示课题介绍、提交入口与历史评价。"
      />

      {loading ? (
        <LoadingCard label="正在加载课题…" />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : topics.length === 0 ? (
        <EmptyState
          icon={<IconBook />}
          title="还没有课题"
          description="老师把你加入课题后，课题会显示在这里；已结束的课题也会保留在历史里。"
        />
      ) : (
        <div className="space-y-8">
          <section aria-label="当前课题">
            <SectionTitle title={`当前课题 · ${currentTopics.length}`} />
            {currentTopics.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line bg-white/60 px-5 py-6 text-sm text-ink-soft">
                目前没有进行中的课题，看看下方历史课题里的评价吧。
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {currentTopics.map((topic) => (
                  <TopicCard key={topic.id} topic={topic} />
                ))}
              </div>
            )}
          </section>

          {historyTopics.length > 0 ? (
            <section aria-label="历史课题">
              <SectionTitle title={`历史课题 · ${historyTopics.length}`} />
              <p className="mb-3 text-sm text-ink-soft">
                你已被移出这些课题，仍然可以查看课题介绍与历史评价（只读）。
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {historyTopics.map((topic) => (
                  <TopicCard key={topic.id} topic={topic} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
