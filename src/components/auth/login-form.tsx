"use client";

import { useActionState, useState } from "react";
import { loginAction } from "@/app/actions/auth";
import { initialActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

const DEMO_ACCOUNTS = [
  { label: "教师演示账号", email: "teacher@demo.edu", password: "demo1234" },
  { label: "学生演示账号", email: "student@demo.edu", password: "demo1234" },
];

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialActionState);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-4">
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
        <FormMessage error={state.error} />
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
