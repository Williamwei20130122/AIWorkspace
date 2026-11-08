import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import type { MySubmission } from "@/lib/types";

const MAX_LENGTH = 5000;

/** 作业提交 / 重新提交表单；已批改时提示重交会清空分数 */
export function SubmitAssignmentForm({
  assignmentId,
  submission,
  onSubmitted,
}: {
  assignmentId: string;
  submission: MySubmission | null;
  onSubmitted?: () => void;
}) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const graded = submission !== null && submission.score !== null;
  const length = content.length;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) {
      setError("请先填写作业内容再提交");
      setSuccess(null);
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post<{ ok: boolean }>(`/api/student/assignments/${assignmentId}/submit`, {
        content: content.trim(),
      });
      setSuccess("提交成功，老师批改后会显示分数和评语。");
      onSubmitted?.();
    } catch (err) {
      setError(errorMessage(err, "提交失败，请检查网络后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {graded ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          注意：这份作业已经批改，重新提交会清空当前分数与评语，需要老师重新批改。
        </p>
      ) : null}

      <Field
        label="作业内容"
        htmlFor="submission-content"
        hint="写下思路与步骤，老师批改时会看到最新一次提交。"
      >
        <Textarea
          id="submission-content"
          name="content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="在这里输入你的作业内容…"
          maxLength={MAX_LENGTH}
          disabled={pending}
          className="min-h-40"
        />
      </Field>

      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-ink-soft">
          字数：{length} / {MAX_LENGTH}
        </span>
        {length === 0 ? <span className="text-ink-soft/70">至少写 1 个字</span> : null}
      </div>

      <FormMessage error={error ?? undefined} success={success ?? undefined} />

      <Button
        type="submit"
        variant="accent"
        className="w-full"
        disabled={pending || length === 0}
      >
        {pending ? "提交中…" : submission ? "重新提交" : "提交作业"}
      </Button>
    </form>
  );
}
