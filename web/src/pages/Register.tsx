import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { IconGraduation } from "@/components/ui/icons";
import { api, errorMessage } from "@/lib/api";
import { roleHome } from "@/lib/format";
import type { User } from "@/lib/types";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("密码至少 8 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const data = await api.post<{ user: User }>("/api/auth/register", {
        name: name.trim(),
        loginId: loginId.trim(),
        password,
      });
      setUser(data.user);
      navigate(roleHome(data.user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err, "注册失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-brand-600 text-white">
            <IconGraduation className="size-6" />
          </span>
          <div>
            <p className="text-lg font-bold tracking-tight text-brand-900">AIWorkspace</p>
            <p className="text-xs text-ink-soft">教师账号注册</p>
          </div>
        </div>

        <div className="aw-card p-6">
          <h1 className="text-xl font-semibold tracking-tight text-brand-900">注册教师账号</h1>
          <p className="mt-1.5 text-sm text-ink-soft">使用邮箱或手机号作为账号，学生账号请登录后在「学生管理」中创建。</p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <Field label="姓名" htmlFor="name">
              <Input
                id="name"
                name="name"
                required
                placeholder="例如 王老师"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="邮箱或手机号" htmlFor="loginId" hint="二选一，作为登录账号">
              <Input
                id="loginId"
                name="loginId"
                required
                autoComplete="username"
                placeholder="teacher@school.edu 或 13800000000"
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
              />
            </Field>
            <Field label="密码" htmlFor="password" hint="至少 8 位">
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="至少 8 位"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="确认密码" htmlFor="confirm">
              <Input
                id="confirm"
                name="confirm"
                type="password"
                required
                autoComplete="new-password"
                placeholder="再输入一次"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </Field>
            <FormMessage error={error ?? undefined} />
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "注册中…" : "注册并登录"}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-ink-soft">
            已有账号？
            <Link to="/login" className="ml-1 font-medium text-brand-700 hover:underline">
              返回登录
            </Link>
          </p>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-soft">
          教师账号用邮箱或手机号；学生账号由老师创建，学号登录、密码可选。
        </p>
      </div>
    </div>
  );
}
