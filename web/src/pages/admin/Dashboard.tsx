import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconAward, IconBook, IconClipboard, IconDashboard, IconSchool, IconUsers } from "@/components/ui/icons";
import { api, errorMessage } from "@/lib/api";
import type { AdminOverview } from "@/lib/types";

export default function AdminDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<AdminOverview>("/api/admin/overview"));
    } catch (err) {
      setError(errorMessage(err, "管理员数据加载失败，请刷新重试"));
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
        eyebrow="管理后台"
        title="管理概览"
        description="管理员账号（admin）可以查看平台整体数据；教师/学生的详细管理仍在教师端进行。"
        actions={null}
      />

      {loading ? (
        <p className="text-sm text-ink-soft">正在加载…</p>
      ) : error ? (
        <div className="aw-card p-4">
          <p className="text-sm text-danger">{error}</p>
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="教师" value={data.teacherCount} hint="注册教师账号" icon={<IconUsers />} tone="brand" />
            <StatCard label="学生" value={data.studentCount} hint="老师创建的学生账号" icon={<IconUsers />} tone="success" />
            <StatCard label="班级" value={data.classCount} hint="全部班级" icon={<IconSchool />} tone="neutral" />
            <StatCard label="课题" value={data.topicCount} hint="全部课题" icon={<IconBook />} tone="brand" />
            <StatCard label="提交" value={data.submissionCount} hint="个人 + 小组提交" icon={<IconClipboard />} tone="accent" />
            <StatCard label="评价" value={data.evaluationCount} hint="全部评价记录" icon={<IconAward />} tone="warning" />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <div>
                <CardTitle>管理员说明</CardTitle>
                <CardDescription>当前管理员账号为只读总览</CardDescription>
              </div>
              <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <IconDashboard className="size-4" />
              </span>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-6 text-ink-soft">
              <p>管理员账号在服务启动时自动创建（登录名 admin），密码由部署方持有。</p>
              <p>如需重置管理员密码，可删除该账号后重启服务自动重建，或直接在数据库中更新密码哈希。</p>
              <p>教师端/学生端的功能与权限不受影响；管理员不会出现在教师或学生列表中。</p>
            </CardContent>
          </Card>
        </>
      ) : null}
    </AppShell>
  );
}
