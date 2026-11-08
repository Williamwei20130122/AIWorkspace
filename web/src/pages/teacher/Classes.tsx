import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Button, buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconArrowRight, IconPlus, IconSchool } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { CreateClassForm } from "@/components/teacher/CreateClassForm";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { SideDrawer } from "@/components/teacher/SideDrawer";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { TeacherClass } from "@/lib/types";

export default function TeacherClasses() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<TeacherClass[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClasses(await api.get<TeacherClass[]>("/api/teacher/classes"));
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

  const totalStudents = (classes ?? []).reduce((sum, item) => sum + item.memberCount, 0);
  const totalTopics = (classes ?? []).reduce((sum, item) => sum + item.topicCount, 0);

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="教师工作台"
        title="班级管理"
        description="班级是学生与课题的容器：先在班级里添加学生，创建课题时再从班级学生中勾选参与人。"
        actions={
          <>
            <Link to="/teacher/students" className={buttonClass("secondary", "sm")}>
              学生管理
            </Link>
            <Button
              type="button"
              variant="accent"
              size="sm"
              onClick={() => setCreateOpen(true)}
              aria-haspopup="dialog"
            >
              <IconPlus className="size-4" />
              新建班级
            </Button>
          </>
        }
      />

      {loading && !classes ? (
        <LoadingState label="正在加载班级…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : classes ? (
        <div className="space-y-4">
          {classes.length > 0 ? (
            <p className="text-xs text-ink-soft">
              共 {classes.length} 个班级 · {totalStudents} 名在册学生 · {totalTopics} 个课题
            </p>
          ) : null}

          {classes.length === 0 ? (
            <EmptyState
              icon={<IconSchool />}
              title="还没有班级"
              description="先创建一个班级并添加学生，之后才能按班级创建课题。"
              action={
                <Button type="button" variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                  新建班级
                </Button>
              }
            />
          ) : (
            <>
              {/* 桌面表格 */}
              <div className="aw-card hidden overflow-hidden md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-brand-50/60 text-xs text-ink-soft">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">班级</th>
                      <th scope="col" className="px-3 py-3 font-semibold">年级</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">学生数</th>
                      <th scope="col" className="px-3 py-3 text-right font-semibold">课题数</th>
                      <th scope="col" className="px-3 py-3 font-semibold">创建时间</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {classes.map((klass) => (
                      <tr key={klass.id} className="transition-colors hover:bg-brand-50/40">
                        <td className="max-w-80 px-4 py-3">
                          <Link
                            to={`/teacher/classes/${klass.id}`}
                            className="block truncate font-semibold text-brand-900 hover:text-brand-700"
                            title={klass.name}
                          >
                            {klass.name}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-ink-soft">{klass.grade || "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink-soft">
                          {klass.memberCount}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink-soft">
                          {klass.topicCount}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-soft">
                          {formatDate(klass.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/teacher/classes/${klass.id}`}
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
              <ul className="grid gap-3 md:hidden">
                {classes.map((klass) => (
                  <li key={klass.id}>
                    <Link
                      to={`/teacher/classes/${klass.id}`}
                      className="aw-card group flex flex-col gap-3 p-4 transition-colors hover:border-brand-300"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="min-w-0 truncate text-sm font-semibold text-brand-900 group-hover:text-brand-700">
                          {klass.name}
                        </h3>
                        <span className="text-xs text-ink-soft">{klass.grade || "未填年级"}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                        <span>{klass.memberCount} 名学生</span>
                        <span>{klass.topicCount} 个课题</span>
                        <span className="text-ink-soft/80">创建于 {formatDate(klass.createdAt)}</span>
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 group-hover:text-brand-700">
                        查看班级详情
                        <IconArrowRight className="size-3.5" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      <SideDrawer
        open={createOpen}
        title="新建班级"
        description="填写班级名称即可创建，学生稍后在班级详情里添加。"
        onClose={() => setCreateOpen(false)}
      >
        <CreateClassForm
          onCreated={(classId) => {
            setCreateOpen(false);
            navigate(`/teacher/classes/${classId}`);
          }}
        />
      </SideDrawer>
    </AppShell>
  );
}
