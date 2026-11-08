import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { roleHome } from "@/lib/format";
import type { User } from "@/lib/types";

const DEMO_ACCOUNTS = [
  { label: "教师演示账号", email: "teacher@demo.edu", password: "demo1234" },
  { label: "学生演示账号", email: "student@demo.edu", password: "demo1234" },
];

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const data = await api.post<{ user: User }>("/api/auth/login", { email, password });
      setUser(data.user);
      navigate(roleHome(data.user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err, "登录失败，请检查邮箱和密码"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="邮箱" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@school.edu"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="密码" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="请输入密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <FormMessage error={error ?? undefined} />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "登录中…" : "登录"}
        </Button>
      </form>

      <div className="rounded-xl border border-line bg-brand-50/60 p-3">
        <p className="text-xs font-semibold text-brand-800">演示账号</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword(account.password);
              }}
              className="rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
            >
              {account.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
          教师 teacher@demo.edu · 学生 student@demo.edu · 密码均为 demo1234
        </p>
      </div>
    </div>
  );
}
