import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";

/**
 * 学生自助设置/清除密码。
 * 空字符串表示清除密码（之后用学号直接登录）；密码哈希只有后端知道，老师看不到明文。
 */
export function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const { refresh } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post<{ ok: boolean }>("/api/me/password", { newPassword });
      await refresh();
      setSuccess(
        newPassword === ""
          ? "已清除密码，之后用学号直接登录。"
          : "密码已更新，下次登录需要使用新密码。",
      );
      setNewPassword("");
    } catch (err) {
      setError(errorMessage(err, "保存失败，请稍后重试。"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>账号安全</CardTitle>
          <CardDescription>密码仅用于保护账号，老师看不到明文。</CardDescription>
        </div>
        <Badge tone={hasPassword ? "success" : "neutral"}>
          {hasPassword ? "已设置密码" : "无密码"}
        </Badge>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field
            label="新密码"
            htmlFor="student-new-password"
            hint={
              hasPassword
                ? "留空并保存表示清除密码，之后用学号直接登录。"
                : "当前无密码，学号可直接登录；设置密码后登录需要输入密码。"
            }
          >
            <Input
              id="student-new-password"
              type="password"
              name="newPassword"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="留空表示清除密码"
              autoComplete="new-password"
              disabled={pending}
            />
          </Field>
          <FormMessage error={error ?? undefined} success={success ?? undefined} />
          <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
            {pending ? "保存中…" : "保存密码设置"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
