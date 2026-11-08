"use client";

import { useActionState } from "react";
import { gradeSubmissionAction } from "@/app/actions/teacher";
import { initialActionState } from "@/lib/action-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";
import { scorePercent } from "@/lib/format";

/**
 * 批改表单（文件名按任务书命名）：score + feedback + submissionId，
 * 显示当前分数与「已批改」徽章，提交后停留本页并提示保存结果。
 */
export function GradeForm({
  submissionId,
  points,
  score,
  feedback,
}: {
  submissionId: string;
  points: number;
  score: number | null;
  feedback: string | null;
}) {
  const [state, formAction, pending] = useActionState(gradeSubmissionAction, initialActionState);
  const graded = score !== null;
  const percent = scorePercent(score, points);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="submissionId" value={submissionId} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-ink-soft">批改</span>
        {graded ? <Badge tone="success">已批改</Badge> : <Badge tone="warning">待批改</Badge>}
        {graded ? (
          <span className="text-xs text-ink-soft">
            当前得分 {score} / {points} 分{percent === null ? "" : `（${percent}%）`}
          </span>
        ) : (
          <span className="text-xs text-ink-soft">填写分数并保存后，学生即可看到成绩</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <Field label="分数" htmlFor={`grade-score-${submissionId}`} hint={`满分 ${points} 分`}>
          <Input
            id={`grade-score-${submissionId}`}
            name="score"
            type="number"
            inputMode="numeric"
            min={0}
            max={points}
            required
            defaultValue={score ?? undefined}
            placeholder="0"
          />
        </Field>
        <Field label="评语" htmlFor={`grade-feedback-${submissionId}`} hint="可选，学生成绩单里可见">
          <Textarea
            id={`grade-feedback-${submissionId}`}
            name="feedback"
            maxLength={2000}
            defaultValue={feedback ?? ""}
            placeholder="写下给学生的反馈…"
          />
        </Field>
      </div>

      <FormMessage error={state.error} success={state.success} />

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "保存中…" : graded ? "更新批改" : "保存批改"}
      </Button>
    </form>
  );
}
