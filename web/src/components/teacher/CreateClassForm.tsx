import { useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

/** POST /api/teacher/classes 的返回（契约只保证 id/name/joinCode，其余字段不依赖） */
export type CreatedClass = {
  id: string;
  name: string;
  joinCode: string;
};

/** 新建班级：成功后由页面决定跳转到新班级详情 */
export function CreateClassForm({ onCreated }: { onCreated: (created: CreatedClass) => void }) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setSuccess(null);
      setError("请填写班级名称");
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await api.post<CreatedClass>("/api/teacher/classes", {
        name: trimmedName,
        ...(grade.trim() ? { grade: grade.trim() } : {}),
      });
      setName("");
      setGrade("");
      setSuccess(`班级「${created.name}」创建成功`);
      onCreated(created);
    } catch (err) {
      setError(errorMessage(err, "创建班级失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label="班级名称" htmlFor="new-class-name" hint="学生会看到的班级名称，如「高一（3）班」">
        <Input
          id="new-class-name"
          name="name"
          required
          maxLength={40}
          autoComplete="off"
          placeholder="高一（3）班"
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="年级" htmlFor="new-class-grade" hint="可选，方便区分不同年级">
        <Input
          id="new-class-grade"
          name="grade"
          maxLength={20}
          autoComplete="off"
          placeholder="高一"
          value={grade}
          disabled={pending}
          onChange={(event) => setGrade(event.target.value)}
        />
      </Field>
      <FormMessage error={error ?? undefined} success={success ?? undefined} />
      <Button type="submit" variant="accent" disabled={pending} className="w-full">
        {pending ? "创建中…" : "创建班级"}
      </Button>
      <p className="text-[11px] leading-relaxed text-ink-soft">
        创建后会自动生成 6 位邀请码，学生凭邀请码加入班级。
      </p>
    </form>
  );
}
