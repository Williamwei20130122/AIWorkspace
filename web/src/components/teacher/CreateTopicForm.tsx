import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";

type CreatedTopic = { id: string };

/** 新建课题：POST /api/teacher/topics，成功后由页面跳到课题详情 */
export function CreateTopicForm({ onCreated }: { onCreated: (topicId: string) => void }) {
  const [title, setTitle] = useState("");
  const [descriptionMd, setDescriptionMd] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setSuccess(null);
      setError("请填写课题标题");
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await api.post<CreatedTopic>("/api/teacher/topics", {
        title: trimmedTitle,
        ...(descriptionMd.trim() ? { descriptionMd } : {}),
      });
      setTitle("");
      setDescriptionMd("");
      setSuccess("课题创建成功，正在进入详情…");
      onCreated(created.id);
    } catch (err) {
      setError(errorMessage(err, "创建课题失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label="课题标题" htmlFor="new-topic-title" hint="学生会在课题列表里看到这个标题">
        <Input
          id="new-topic-title"
          name="title"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="校园气象站数据记录"
          value={title}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field
        label="课题介绍（可选）"
        htmlFor="new-topic-description"
        hint="支持 Markdown，创建后还能在详情页继续编辑"
      >
        <Textarea
          id="new-topic-description"
          name="descriptionMd"
          rows={5}
          className="min-h-24"
          placeholder="用一两段话说明课题目标、要提交什么…"
          value={descriptionMd}
          disabled={pending}
          onChange={(event) => setDescriptionMd(event.target.value)}
        />
      </Field>
      <FormMessage error={error ?? undefined} success={success ?? undefined} />
      <Button type="submit" variant="accent" disabled={pending} className="w-full">
        {pending ? "创建中…" : "创建课题"}
      </Button>
      <p className="text-[11px] leading-relaxed text-ink-soft">
        创建后你可以在详情页添加助教、学生与评价维度，学生提交后即可评价。
      </p>
    </form>
  );
}
