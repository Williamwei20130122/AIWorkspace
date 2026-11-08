import { useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";

/** 班级详情页发布公告：POST /api/teacher/classes/{id}/announcements */
export function CreateAnnouncementForm({
  classId,
  onCreated,
}: {
  classId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle || !trimmedContent) {
      setSuccess(null);
      setError(!trimmedTitle ? "请填写公告标题" : "请填写公告内容");
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post<unknown>(`/api/teacher/classes/${classId}/announcements`, {
        title: trimmedTitle,
        content: trimmedContent,
      });
      setTitle("");
      setContent("");
      setSuccess("公告已发布，本班学生现在可以看到");
      onCreated();
    } catch (err) {
      setError(errorMessage(err, "发布公告失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label="公告标题" htmlFor="new-announcement-title">
        <Input
          id="new-announcement-title"
          name="title"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="如：本周五期中测验安排"
          value={title}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="公告内容" htmlFor="new-announcement-content">
        <Textarea
          id="new-announcement-content"
          name="content"
          required
          maxLength={2000}
          placeholder="写清楚时间、地点与需要准备的内容…"
          value={content}
          disabled={pending}
          onChange={(event) => setContent(event.target.value)}
        />
      </Field>
      <FormMessage error={error ?? undefined} success={success ?? undefined} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "发布中…" : "发布公告"}
      </Button>
    </form>
  );
}
