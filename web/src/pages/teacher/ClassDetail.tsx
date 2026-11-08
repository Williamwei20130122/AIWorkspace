import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { IconArrowLeft, IconBook, IconPlus, IconUsers } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { CreateTopicForm } from "@/components/teacher/CreateTopicForm";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { Panel } from "@/components/teacher/Panel";
import { SideDrawer } from "@/components/teacher/SideDrawer";
import { TopicStatusBadge } from "@/components/teacher/StatusBadge";
import { ApiError, api, errorMessage } from "@/lib/api";
import { cn, formatDate } from "@/lib/format";
import type { ClassDetail as ClassDetailData, ManagedStudent } from "@/lib/types";

export default function TeacherClassDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [klass, setKlass] = useState<ClassDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [managedStudents, setManagedStudents] = useState<ManagedStudent[]>([]);
  const [loginId, setLoginId] = useState("");
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);

  const loadClass = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      setKlass(await api.get<ClassDetailData>(`/api/teacher/classes/${id}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setKlass(null);
        setNotFound(true);
      } else {
        setError(errorMessage(err, "班级详情加载失败，请刷新页面重试"));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadManagedStudents = useCallback(async () => {
    try {
      setManagedStudents(await api.get<ManagedStudent[]>("/api/teacher/students"));
    } catch {
      setManagedStudents([]);
    }
  }, []);

  useEffect(() => {
    void loadClass();
    void loadManagedStudents();
  }, [loadClass, loadManagedStudents]);

  if (!user) return null;

  async function handleAddStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addPending || !klass) return;

    const value = loginId.trim();
    if (!value) {
      setAddSuccess(null);
      setAddError("请输入要添加的学生学号");
      return;
    }

    setAddPending(true);
    setAddError(null);
    setAddSuccess(null);
    try {
      await api.post(`/api/teacher/classes/${klass.id}/students`, { loginId: value });
      setLoginId("");
      setAddSuccess("已添加学生到班级");
      await loadClass();
    } catch (err) {
      setAddError(errorMessage(err, "添加学生失败，请确认该学生由你管理"));
    } finally {
      setAddPending(false);
    }
  }

  async function handleRemoveStudent(studentId: string, name: string) {
    if (!klass || removingId) return;
    const confirmed = window.confirm(
      `确定把「${name}」移出班级吗？历史记录会保留，之后可以重新添加。`,
    );
    if (!confirmed) return;

    setRemovingId(studentId);
    setRemoveError(null);
    try {
      await api.del(`/api/teacher/classes/${klass.id}/students/${studentId}`);
      await loadClass();
    } catch (err) {
      setRemoveError(errorMessage(err, "移出学生失败，请稍后重试"));
    } finally {
      setRemovingId(null);
    }
  }

  const activeStudents = klass?.students.filter((student) => !student.removedAt) ?? [];
  const removedStudents = klass?.students.filter((student) => student.removedAt) ?? [];

  return (
    <AppShell user={user}>
      {notFound ? (
        <div className="mx-auto max-w-md rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">404</p>
          <p className="mt-2 text-base font-semibold text-brand-900">班级不存在</p>
          <p className="mt-1 text-sm leading-6 text-ink-soft">
            这个班级可能已被删除，或者不属于你的账号。
          </p>
          <Link to="/teacher/classes" className={cn(buttonClass("secondary", "sm"), "mt-4")}>
            返回班级列表
          </Link>
        </div>
      ) : loading && !klass ? (
        <LoadingState label="正在加载班级详情…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void loadClass()} />
      ) : klass ? (
        <div className="space-y-6">
          <PageHeader
            eyebrow={klass.grade ? `${klass.grade} · 班级详情` : "班级详情"}
            title={klass.name}
            description={`${activeStudents.length} 名在册学生 · ${klass.topics.length} 个课题 · 课题从本班学生中勾选参与人`}
            actions={
              <>
                <Link to="/teacher/classes" className={buttonClass("secondary", "sm")}>
                  <IconArrowLeft className="size-4" />
                  返回班级列表
                </Link>
                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  onClick={() => setCreateOpen(true)}
                  aria-haspopup="dialog"
                >
                  <IconPlus className="size-4" />
                  去建课题
                </Button>
              </>
            }
          />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-6">
              <Panel
                title={`学生名单（${activeStudents.length}）`}
                description="学生由老师添加进班级；移出后保留历史，可重新添加"
                action={
                  removedStudents.length > 0 ? (
                    <span className="text-xs text-ink-soft">已移出 {removedStudents.length} 人</span>
                  ) : null
                }
              >
                <form onSubmit={handleAddStudent} className="space-y-3" noValidate>
                  <Field
                    label="添加学生"
                    htmlFor="class-student-login"
                    hint="输入学号，或从「我管理的学生」中选择；只能添加你管理的学生"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="class-student-login"
                        name="loginId"
                        list="class-managed-student-options"
                        autoComplete="off"
                        maxLength={64}
                        placeholder="如：S001"
                        value={loginId}
                        disabled={addPending}
                        onChange={(event) => setLoginId(event.target.value)}
                      />
                      <datalist id="class-managed-student-options">
                        {managedStudents.map((student) => (
                          <option key={student.id} value={student.loginId}>
                            {`${student.name}（${student.loginId}）`}
                          </option>
                        ))}
                      </datalist>
                      <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        disabled={addPending}
                      >
                        {addPending ? "添加中…" : "添加学生"}
                      </Button>
                    </div>
                  </Field>
                  <FormMessage error={addError ?? undefined} success={addSuccess ?? undefined} />
                </form>

                {klass.students.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-dashed border-line bg-white/60 px-4 py-6 text-center text-sm text-ink-soft">
                    这个班级还没有学生。输入学号把学生添加进班级后再创建课题。
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-line border-t border-line">
                    {[...activeStudents, ...removedStudents].map((student) => {
                      const removed = Boolean(student.removedAt);
                      return (
                        <li
                          key={student.id}
                          className="flex flex-wrap items-center gap-2.5 py-2.5 first:pt-3"
                        >
                          <Avatar name={student.name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-brand-900">
                              {student.name}
                              {removed ? (
                                <Badge tone="neutral" className="ml-2">
                                  已移出
                                </Badge>
                              ) : null}
                            </p>
                            <p className="truncate text-xs text-ink-soft">
                              学号 {student.loginId}
                              {removed && student.removedAt
                                ? ` · ${formatDate(student.removedAt)} 移出`
                                : ""}
                            </p>
                          </div>
                          {removed ? (
                            <span className="shrink-0 text-[11px] text-ink-soft">历史成员</span>
                          ) : (
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              disabled={removingId !== null}
                              onClick={() => void handleRemoveStudent(student.id, student.name)}
                            >
                              {removingId === student.id ? "移出中…" : "移出"}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <FormMessage error={removeError ?? undefined} />
              </Panel>

              <Panel
                title={`该班课题（${klass.topics.length}）`}
                description="课题创建时从本班学生中勾选参与人，进入课题可继续管理成员与分组"
                action={
                  <Button type="button" variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
                    <IconPlus className="size-4" />
                    去建课题
                  </Button>
                }
              >
                {klass.topics.length === 0 ? (
                  <EmptyState
                    icon={<IconBook />}
                    title="该班还没有课题"
                    description="从本班学生中勾选参与人，创建第一个课题。"
                    action={
                      <Button type="button" variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                        去建课题
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {klass.topics.map((topic) => (
                      <li key={topic.id}>
                        <Link
                          to={`/teacher/topics/${topic.id}`}
                          className="group flex flex-wrap items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-brand-50/60"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-900 group-hover:text-brand-700">
                            {topic.title}
                          </span>
                          <TopicStatusBadge status={topic.status} />
                          <span className="text-xs font-medium text-brand-600 group-hover:text-brand-700">
                            查看
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <div className="min-w-0 space-y-6">
              <Panel title="班级信息" description="班级属于创建老师，学生从「学生管理」中维护">
                <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-y-2 text-sm">
                  <dt className="text-ink-soft">班级名称</dt>
                  <dd className="font-medium text-brand-900">{klass.name}</dd>
                  <dt className="text-ink-soft">年级</dt>
                  <dd className="text-brand-900">{klass.grade || "—"}</dd>
                  <dt className="text-ink-soft">在册学生</dt>
                  <dd className="text-brand-900">{activeStudents.length} 人</dd>
                  <dt className="text-ink-soft">历史学生</dt>
                  <dd className="text-brand-900">{removedStudents.length} 人</dd>
                  <dt className="text-ink-soft">班级课题</dt>
                  <dd className="text-brand-900">{klass.topics.length} 个</dd>
                </dl>
                <div className="mt-4 space-y-2 border-t border-line pt-4">
                  <Link
                    to="/teacher/students"
                    className={cn(buttonClass("secondary", "sm"), "w-full")}
                  >
                    <IconUsers className="size-4" />
                    去学生管理
                  </Link>
                  <Link to="/teacher/topics" className={cn(buttonClass("secondary", "sm"), "w-full")}>
                    <IconBook className="size-4" />
                    课题管理
                  </Link>
                </div>
              </Panel>

              <Panel title="小提示" description="v4 班级与课题的关系">
                <ul className="space-y-2 text-xs leading-5 text-ink-soft">
                  <li>· 课题必须属于一个班级，参与学生从该班学生中勾选。</li>
                  <li>· 课题创建后，仍可在课题详情的成员管理里增删学生（限本班学生）。</li>
                  <li>· 小组提交与分组设置都在课题详情里配置。</li>
                </ul>
              </Panel>
            </div>
          </div>

          <SideDrawer
            open={createOpen}
            title="新建课题"
            description={`从「${klass.name}」的学生中勾选参与人，默认全选。`}
            onClose={() => setCreateOpen(false)}
          >
            <CreateTopicForm
              initialClassId={klass.id}
              onCreated={(topicId) => {
                setCreateOpen(false);
                navigate(`/teacher/topics/${topicId}`);
              }}
            />
          </SideDrawer>
        </div>
      ) : null}
    </AppShell>
  );
}
