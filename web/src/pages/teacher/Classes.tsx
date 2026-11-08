import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowRight, IconUsers } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { CreateClassForm } from "@/components/teacher/CreateClassForm";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { Panel } from "@/components/teacher/Panel";
import { api, errorMessage } from "@/lib/api";
import type { ClassSummary } from "@/lib/types";

export default function TeacherClasses() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClasses(await api.get<ClassSummary[]>("/api/teacher/classes"));
    } catch (err) {
      setError(errorMessage(err, "班级列表加载失败，请刷新页面重试"));
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
        title="我的班级"
        description="管理班级成员、课程与公告。把 6 位邀请码发给学生，他们登录后即可加入班级。"
        actions={
          <Link to="/teacher/assignments" className={buttonClass("secondary", "sm")}>
            查看全部作业
          </Link>
        }
      />

      {loading && !classes ? (
        <LoadingState label="正在加载班级…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : classes ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section>
            <SectionTitle title={`全部班级（${classes.length}）`} />
            {classes.length === 0 ? (
              <EmptyState
                icon={<IconUsers />}
                title="还没有班级"
                description="创建第一个班级，生成邀请码后学生就能加入。"
                action={
                  <a href="#create-class" className={buttonClass("primary", "sm")}>
                    去创建班级
                  </a>
                }
              />
            ) : (
              <ul className="space-y-3">
                {classes.map((klass) => (
                  <ClassCard key={klass.id} klass={klass} />
                ))}
              </ul>
            )}
          </section>

          <aside id="create-class" className="scroll-mt-24">
            <Panel
              title="新建班级"
              description="创建后会自动生成 6 位邀请码"
              className="xl:sticky xl:top-6"
            >
              <CreateClassForm
                onCreated={(created) => navigate(`/teacher/classes/${created.id}`)}
              />
            </Panel>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}

function ClassCard({ klass }: { klass: ClassSummary }) {
  return (
    <li>
      <Link
        to={`/teacher/classes/${klass.id}`}
        className="aw-card group flex flex-col gap-3 p-4 transition-colors hover:border-brand-300 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-brand-900 group-hover:text-brand-700">
                {klass.name}
              </h3>
              {klass.grade ? <Badge tone="neutral">{klass.grade}</Badge> : null}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              {klass.enrollmentCount} 名学生 · {klass.courseCount} 门课程
            </p>
          </div>
          <span className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-xs font-semibold tracking-[0.18em] text-brand-700">
            {klass.joinCode}
          </span>
        </div>

        {klass.courses.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {klass.courses.slice(0, 4).map((course) => (
              <li
                key={course.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-0.5 text-[11px] font-medium text-ink-soft"
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: course.color }}
                />
                {course.title}
              </li>
            ))}
            {klass.courses.length > 4 ? (
              <li className="px-1 py-0.5 text-[11px] text-ink-soft">等 {klass.courses.length} 门</li>
            ) : null}
          </ul>
        ) : (
          <p className="text-[11px] text-ink-soft">还没有课程，进入班级即可创建</p>
        )}

        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 group-hover:text-brand-700">
          查看班级详情
          <IconArrowRight className="size-3.5" />
        </span>
      </Link>
    </li>
  );
}
