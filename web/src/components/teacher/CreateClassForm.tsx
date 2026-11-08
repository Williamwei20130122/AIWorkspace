import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";

type CreatedClass = { id: string };

/** 新建班级：POST /api/teacher/classes {name, grade?} */
export function CreateClassForm({ onCreated }: { onCreated: (classId: string) => void }) {
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
      setSuccess("班级创建成功，正在进入详情…");
      onCreated(created.id);
    } catch (err) {
      setError(errorMessage(err, "创建班级失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label="班级名称" htmlFor="new-class-name" hint="学生会看到的班级名称，如「初二（3）班」">
        <Input
          id="new-class-name"
          name="name"
          required
          maxLength={40}
          autoComplete="off"
          placeholder="初二（3）班"
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="年级" htmlFor="new-class-grade" hint="可选，例如「初二」">
        <Input
          id="new-class-grade"
          name="grade"
          maxLength={20}
          autoComplete="off"
          placeholder="初二"
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
        创建后可以在班级详情里添加学生；课题创建时从班级学生中勾选参与学生。
      </p>
    </form>
  );
}
