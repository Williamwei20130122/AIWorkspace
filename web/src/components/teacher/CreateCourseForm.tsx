import { useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";

/** 班级详情页内新建课程：POST /api/teacher/classes/{id}/courses */
export function CreateCourseForm({
  classId,
  onCreated,
}: {
  classId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setSuccess(null);
      setError("请填写课程名称");
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post<unknown>(`/api/teacher/classes/${classId}/courses`, {
        title: trimmedTitle,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setTitle("");
      setDescription("");
      setSuccess(`课程「${trimmedTitle}」已创建`);
      onCreated();
    } catch (err) {
      setError(errorMessage(err, "创建课程失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label="课程名称" htmlFor="new-course-title">
        <Input
          id="new-course-title"
          name="title"
          required
          maxLength={60}
          autoComplete="off"
          placeholder="如：数学"
          value={title}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="课程简介" htmlFor="new-course-description" hint="可选，一句话说明这门课">
        <Textarea
          id="new-course-description"
          name="description"
          maxLength={500}
          placeholder="如：每周三节，围绕函数与几何展开。"
          value={description}
          disabled={pending}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <FormMessage error={error ?? undefined} success={success ?? undefined} />
      <Button type="submit" variant="secondary" disabled={pending} className="w-full">
        {pending ? "创建中…" : "新建课程"}
      </Button>
    </form>
  );
}
