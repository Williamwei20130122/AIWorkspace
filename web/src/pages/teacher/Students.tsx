import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { IconUsers } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { CreateStudentForm } from "@/components/teacher/CreateStudentForm";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { Panel } from "@/components/teacher/Panel";
import { PasswordBadge } from "@/components/teacher/StatusBadge";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { ManagedStudent } from "@/lib/types";

export default function TeacherStudents() {
  const { user } = useAuth();
  const [students, setStudents] = useState<ManagedStudent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStudents(await api.get<ManagedStudent[]>("/api/teacher/students"));
    } catch (err) {
      setError(errorMessage(err, "学生列表加载失败，请刷新页面重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  const withPassword = (students ?? []).filter((student) => student.hasPassword).length;

  return (
    <AppShell user={user}>
      <PageHeader
        eyebrow="教师工作台"
        title="学生管理"
        description="学生账号由老师创建，默认无密码、可直接用用户名登录。你可以为学生重置或关闭密码，但永远看不到明文。"
      />

      {loading && !students ? (
        <LoadingState label="正在加载学生…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : students ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section>
            <SectionTitle
              title={`全部学生（${students.length}）`}
              action={
                <span className="text-xs text-ink-soft">
                  {students.length - withPassword} 人无密码 · {withPassword} 人已有密码
                </span>
              }
            />
            {students.length === 0 ? (
              <EmptyState
                icon={<IconUsers />}
                title="还没有学生"
                description="先用右侧「创建学生」添加学生账号，然后把用户名告诉学生即可登录。"
              />
            ) : (
              <ul className="space-y-3">
                {students.map((student) => (
                  <StudentRow key={student.id} student={student} onChanged={() => void load()} />
                ))}
              </ul>
            )}
          </section>

          <aside className="scroll-mt-24">
            <Panel
              title="创建学生"
              description="填写姓名与用户名；用户名重复时会显示已有账号信息"
              className="xl:sticky xl:top-6"
            >
              <CreateStudentForm onChanged={() => void load()} />
            </Panel>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}

function StudentRow({ student, onChanged }: { student: ManagedStudent; onChanged: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const passwordInputId = `student-password-${student.id}`;

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    if (!password.trim()) {
      setSuccess(null);
      setError("请填写新密码");
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/api/teacher/students/${student.id}/password`, { password });
      setPassword("");
      setResetting(false);
      setSuccess(`已重置「${student.name}」的密码，请通过安全方式告知学生`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "重置密码失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  async function handleClosePassword() {
    if (closing || !student.hasPassword) return;
    const confirmed = window.confirm(
      `关闭「${student.name}」的密码后，对方可以直接用用户名登录，确定关闭吗？`,
    );
    if (!confirmed) return;

    setClosing(true);
    setError(null);
    setSuccess(null);
    try {
      await api.del(`/api/teacher/students/${student.id}/password`);
      setSuccess(`已关闭「${student.name}」的密码，学生现在可直接登录`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "关闭密码失败，请稍后重试"));
    } finally {
      setClosing(false);
    }
  }

  function toggleReset() {
    setResetting((value) => !value);
    setPassword("");
    setError(null);
    setSuccess(null);
  }

  return (
    <li className="aw-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={student.name} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-brand-900">{student.name}</p>
            <p className="mt-0.5 truncate text-xs text-ink-soft">
              用户名 {student.loginId}
              {student.createdAt ? ` · 创建于 ${formatDate(student.createdAt)}` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PasswordBadge hasPassword={student.hasPassword} />
          <Button type="button" variant="secondary" size="sm" onClick={toggleReset} disabled={pending || closing}>
            {resetting ? "收起" : "重置密码"}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={!student.hasPassword || closing || pending}
            title={student.hasPassword ? "清除密码，学生可直接登录" : "该学生当前没有密码"}
            onClick={() => void handleClosePassword()}
          >
            {closing ? "关闭中…" : "关闭密码"}
          </Button>
        </div>
      </div>

      {resetting ? (
        <form
          onSubmit={handleReset}
          className="mt-3 space-y-2 border-t border-line pt-3"
          noValidate
        >
          <Field
            label={`为「${student.name}」设置新密码`}
            htmlFor={passwordInputId}
            hint="设置后请通过安全方式告知学生；老师无法查看明文密码"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={passwordInputId}
                type="password"
                name="password"
                autoComplete="new-password"
                maxLength={128}
                placeholder="输入新密码"
                value={password}
                disabled={pending}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button type="submit" variant="primary" size="sm" className="shrink-0" disabled={pending}>
                {pending ? "保存中…" : "保存密码"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0"
                disabled={pending}
                onClick={toggleReset}
              >
                取消
              </Button>
            </div>
          </Field>
          <FormMessage error={error ?? undefined} />
        </form>
      ) : (
        <FormMessage error={error ?? undefined} success={success ?? undefined} />
      )}
    </li>
  );
}
