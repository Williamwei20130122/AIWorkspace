"use client";

import { useActionState, useState } from "react";
import { submitAssignmentAction } from "@/app/actions/student";
import { initialActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/format";

const MAX_LENGTH = 5000;

/** 学生提交 / 重新提交作业（含字数统计与反馈提示） */
export function SubmitAssignmentForm({
  assignmentId,
  defaultContent = "",
  hasSubmission,
  isGraded = false,
}: {
  assignmentId: string;
  defaultContent?: string;
  hasSubmission?: boolean;
  isGraded?: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitAssignmentAction, initialActionState);
  const [content, setContent] = useState(defaultContent);
  const length = content.length;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="assignmentId" value={assignmentId} />

      <Field label="作业内容" htmlFor="content" hint="文字提交，最多 5000 字；重新提交会覆盖之前的版本。">
        <Textarea
          id="content"
          name="content"
          required
          maxLength={MAX_LENGTH}
          rows={8}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="在这里写下你的答案、解题过程或实验结论…"
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "font-medium",
            length > MAX_LENGTH - 200 ? "text-amber-700" : "text-ink-soft",
          )}
        >
          已输入 {length} / {MAX_LENGTH} 字
        </span>
        {isGraded ? <span className="text-amber-700">重交会清空分数与评语</span> : null}
      </div>

      <FormMessage error={state.error} success={state.success} />

      <Button type="submit" variant="accent" disabled={pending} className="w-full">
        {pending ? "提交中…" : hasSubmission ? "重新提交" : "提交作业"}
      </Button>
    </form>
  );
}
