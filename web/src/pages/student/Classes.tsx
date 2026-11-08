import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { ErrorCard, LoadingCard } from "@/components/student/PageState";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBook, IconSchool, IconUsers } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { api, errorMessage } from "@/lib/api";
import type { StudentClass } from "@/lib/types";

function ClassCard({ item }: { item: StudentClass }) {
  return (
    <Card className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-brand-900">{item.name}</h2>
          <p className="mt-1 truncate text-xs text-ink-soft">
            {item.teacher?.name ? `${item.teacher.name} 老师` : "老师"}
            {item.grade ? ` · ${item.grade}` : ""}
          </p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <IconSchool />
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-line bg-brand-50/40 px-3 py-2.5">
          <p className="flex items-center gap-1 text-xs text-ink-soft">
            <IconUsers className="size-3.5" />
            班级人数
          </p>
          <p className="mt-1 text-lg font-semibold leading-none text-brand-900">
            {item.memberCount}
            <span className="ml-1 text-xs font-medium text-ink-soft">人</span>
          </p>
        </div>
        <div className="rounded-xl border border-line bg-brand-50/40 px-3 py-2.5">
          <p className="flex items-center gap-1 text-xs text-ink-soft">
            <IconBook className="size-3.5" />
            课题数
          </p>
          <p className="mt-1 text-lg font-semibold leading-none text-brand-900">
            {typeof item.topicCount === "number" ? item.topicCount : "—"}
            {typeof item.topicCount === "number" ? (
              <span className="ml-1 text-xs font-medium text-ink-soft">个</span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <Link to="/student/topics" className={buttonClass("secondary", "sm")}>
          查看我的课题
        </Link>
      </div>
    </Card>
  );
}

export default function StudentClasses() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<StudentClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClasses(await api.get<StudentClass[]>("/api/student/classes"));
    } catch (err) {
      setError(errorMessage(err, "班级列表加载失败，请稍后重试。"));
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
        eyebrow="我的班级"
        title="我的班级"
        description="你所在的班级、任课老师与班级课题数。课题分组与提交请到「我的课题」里查看。"
        actions={<Badge tone="brand">共 {classes.length} 个班级</Badge>}
      />

      {loading ? (
        <LoadingCard label="正在加载班级…" />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : classes.length === 0 ? (
        <EmptyState
          icon={<IconSchool />}
          title="还没有加入班级"
          description="老师把你加入班级后，这里会显示班级信息；课题由老师从班级学生中分配。"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {classes.map((item) => (
            <ClassCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
