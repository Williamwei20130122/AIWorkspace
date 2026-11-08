import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { JoinClassForm } from "@/components/student/JoinClassForm";
import { ErrorCard, LoadingCard } from "@/components/student/PageState";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBook } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { api, errorMessage } from "@/lib/api";
import type { StudentClass } from "@/lib/types";

export default function StudentClasses() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<StudentClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      setClasses(await api.get<StudentClass[]>("/api/student/classes"));
    } catch (err) {
      setError(errorMessage(err, "班级列表加载失败，请稍后重试"));
    } finally {
      if (showLoading) setLoading(false);
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
        description="你加入的班级与课程；凭老师发的邀请码可以加入新班级。"
        actions={
          <Link to="/student/assignments" className={buttonClass("secondary", "sm")}>
            查看我的作业
          </Link>
        }
      />

      {loading ? (
        <LoadingCard label="正在加载班级…" />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {classes.length === 0 ? (
              <EmptyState
                icon={<IconBook />}
                title="还没有加入班级"
                description="向老师要一个 6 位邀请码，在「加入班级」里输入即可。"
              />
            ) : (
              classes.map((item) => (
                <Card key={item.id}>
                  <CardHeader>
                    <div className="min-w-0">
                      <CardTitle className="truncate">{item.name}</CardTitle>
                      <CardDescription>
                        共 {item.studentCount} 名学生 · {item.courses.length} 门课程
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={item.teacher.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-brand-900">
                          {item.teacher.name}
                        </p>
                        <p className="truncate text-xs text-ink-soft">{item.teacher.email}</p>
                      </div>
                    </div>
                    <div className="mt-4 mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-ink-soft">课程与作业</p>
                    </div>
                    {item.courses.length === 0 ? (
                      <p className="text-sm text-ink-soft">老师还没有在这门班级下创建课程。</p>
                    ) : (
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {item.courses.map((course) => (
                          <li
                            key={course.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-line bg-brand-50/40 px-3 py-2"
                          >
                            <span className="min-w-0 truncate text-sm font-medium text-brand-900">
                              {course.title}
                            </span>
                            <Badge tone={course.assignmentCount > 0 ? "warning" : "neutral"}>
                              {course.assignmentCount} 份作业
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-4">
                      <Link to="/student/assignments" className={buttonClass("secondary", "sm")}>
                        查看班级作业
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <aside className="lg:sticky lg:top-8 lg:self-start">
            <JoinClassForm onJoined={() => void load(false)} />
          </aside>
        </div>
      )}
    </AppShell>
  );
}
