import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";
import { scorePercent } from "@/lib/format";

/**
 * 批改表单：POST /api/teacher/submissions/{id}/grade。
 * 已批改的提交可反复修改，保存成功后由页面刷新数据。
 */
export function GradeForm({
  submissionId,
  points,
  score,
  feedback,
  onSaved,
}: {
  submissionId: string;
  points: number;
  score: number | null;
  feedback: string | null;
  onSaved: () => void;
}) {
  const [scoreInput, setScoreInput] = useState(score === null ? "" : String(score));
  const [feedbackInput, setFeedbackInput] = useState(feedback ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 页面刷新后把最新的分数/评语同步回表单，保证「更新批改」显示当前值
  useEffect(() => {
    setScoreInput(score === null ? "" : String(score));
  }, [score]);

  useEffect(() => {
    setFeedbackInput(feedback ?? "");
  }, [feedback]);

  const graded = score !== null;
  const percent = scorePercent(score, points);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const numericScore = Number(scoreInput);
    if (scoreInput.trim() === "" || !Number.isFinite(numericScore)) {
      setSuccess(null);
      setError("请填写分数");
      return;
    }
    if (numericScore < 0 || numericScore > points) {
      setSuccess(null);
      setError(`分数需在 0 到 ${points} 之间`);
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post<unknown>(`/api/teacher/submissions/${submissionId}/grade`, {
        score: Math.round(numericScore),
        // 始终传评语（可为空字符串），便于教师清空原有评语
        feedback: feedbackInput.trim(),
      });
      setSuccess("批改已保存，学生端已更新");
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "保存批改失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
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
            value={scoreInput}
            disabled={pending}
            placeholder="0"
            onChange={(event) => setScoreInput(event.target.value)}
          />
        </Field>
        <Field label="评语" htmlFor={`grade-feedback-${submissionId}`} hint="可选，学生成绩单里可见">
          <Textarea
            id={`grade-feedback-${submissionId}`}
            name="feedback"
            maxLength={2000}
            value={feedbackInput}
            disabled={pending}
            placeholder="写下给学生的反馈…"
            onChange={(event) => setFeedbackInput(event.target.value)}
          />
        </Field>
      </div>

      <FormMessage error={error ?? undefined} success={success ?? undefined} />

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "保存中…" : graded ? "更新批改" : "保存批改"}
      </Button>
    </form>
  );
}
