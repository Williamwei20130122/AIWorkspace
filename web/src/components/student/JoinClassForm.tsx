import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { IconPlus } from "@/components/ui/icons";
import { api, errorMessage } from "@/lib/api";

/** 学生端「加入班级」表单：邀请码入班，成功后通知页面刷新列表 */
export function JoinClassForm({ onJoined }: { onJoined?: (className: string) => void }) {
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError("请输入老师发给你的邀请码");
      setSuccess(null);
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await api.post<{ ok: boolean; className: string }>("/api/student/classes/join", {
        joinCode: code,
      });
      setSuccess(`已加入「${data.className}」，班级列表已更新。`);
      setJoinCode("");
      onJoined?.(data.className);
    } catch (err) {
      setError(errorMessage(err, "加入班级失败，请确认邀请码是否正确后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>加入班级</CardTitle>
          <CardDescription>输入老师提供的 6 位邀请码</CardDescription>
        </div>
        <span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-700">
          <IconPlus />
        </span>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="邀请码" htmlFor="join-code" hint="邀请码由任课教师创建班级时生成。">
            <Input
              id="join-code"
              name="joinCode"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              placeholder="例如 MATH01"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={6}
              disabled={pending}
              className="tracking-widest uppercase"
            />
          </Field>
          <FormMessage error={error ?? undefined} success={success ?? undefined} />
          <Button type="submit" variant="accent" className="w-full" disabled={pending}>
            {pending ? "加入中…" : "加入班级"}
          </Button>
        </form>
        <p className="mt-3 text-xs leading-relaxed text-ink-soft">
          重复加入同一个班级不会出错，也不会重复计算人数。
        </p>
      </CardContent>
    </Card>
  );
}
