import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { EvaluationList } from "@/components/student/EvaluationList";
import { ErrorCard, LoadingCard } from "@/components/student/PageState";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAward } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { api, errorMessage } from "@/lib/api";
import type { MyEvaluationItem } from "@/lib/types";

export default function StudentEvaluations() {
  const { user } = useAuth();
  const [items, setItems] = useState<MyEvaluationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<MyEvaluationItem[]>("/api/student/evaluations");
      setItems(data);
    } catch (err) {
      setError(errorMessage(err, "评价加载失败，请稍后重试。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [items],
  );

  if (!user) return null;

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="我的评价"
        title="我的评价"
        description="老师对你所有课题提交的评价，按时间倒序排列。"
        actions={<Badge tone="brand">共 {sorted.length} 条</Badge>}
      />

      {loading ? (
        <LoadingCard label="正在加载评价…" />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<IconAward />}
          title="还没有收到评价"
          description="老师评价你的提交后，这里会显示课题、维度分数和评语。"
        />
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>全部评价</CardTitle>
              <CardDescription>包含历史课题的评价记录</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <EvaluationList items={sorted} />
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
