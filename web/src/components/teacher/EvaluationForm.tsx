import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import type { Dimension } from "@/lib/types";

type InitialScore = { dimensionId: string; score: number };

/** 对一个提交新增评价：按课题维度动态打分 + 文字评语 */
export function EvaluationForm({
  submissionId,
  dimensions,
  initialScores,
  onSubmitted,
}: {
  submissionId: string;
  dimensions: Dimension[];
  initialScores: InitialScore[];
  onSubmitted: () => void | Promise<void>;
}) {
  const [scoreInputs, setScoreInputs] = useState<Record<string, string>>(() => {
    const inputs: Record<string, string> = {};
    for (const dimension of dimensions) {
      const existing = initialScores.find((item) => item.dimensionId === dimension.id);
      inputs[dimension.id] = existing ? String(existing.score) : "";
    }
    return inputs;
  });
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const filledScores = dimensions.map((dimension) => Number(scoreInputs[dimension.id]));
  const totalScore = filledScores.reduce((sum, score) => (Number.isFinite(score) ? sum + score : sum), 0);
  const totalMax = dimensions.reduce((sum, dimension) => sum + dimension.maxScore, 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    if (dimensions.length === 0) {
      setError("课题还没有评价维度，请先在维度管理中添加");
      return;
    }

    for (const dimension of dimensions) {
      const raw = scoreInputs[dimension.id];
      if (raw === undefined || raw.trim() === "") {
        setError(`请填写「${dimension.name}」的分数`);
        return;
      }
      const score = Number(raw);
      if (!Number.isInteger(score) || score < 0 || score > dimension.maxScore) {
        setError(`「${dimension.name}」的分数需为 0–${dimension.maxScore} 的整数`);
        return;
      }
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/api/teacher/submissions/${submissionId}/evaluations`, {
        comment: comment.trim(),
        scores: dimensions.map((dimension) => ({
          dimensionId: dimension.id,
          score: Number(scoreInputs[dimension.id]),
        })),
      });
      setComment("");
      setSuccess("评价已保存");
      await onSubmitted();
    } catch (err) {
      setError(errorMessage(err, "保存评价失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  if (dimensions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-white/60 px-3 py-4 text-sm text-ink-soft">
        课题还没有评价维度。请先在「维度管理」中添加维度，然后才能对提交打分。
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-line bg-brand-50/40 p-3" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-brand-900">新增评价</h4>
        <span className="text-xs text-ink-soft">
          合计 <span className="font-semibold tabular-nums text-brand-800">{totalScore}</span> / {totalMax}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {dimensions.map((dimension) => (
          <Field
            key={dimension.id}
            label={`${dimension.name}（0–${dimension.maxScore}）`}
            htmlFor={`score-${submissionId}-${dimension.id}`}
          >
            <Input
              id={`score-${submissionId}-${dimension.id}`}
              type="number"
              min={0}
              max={dimension.maxScore}
              step={1}
              inputMode="numeric"
              placeholder="0"
              value={scoreInputs[dimension.id] ?? ""}
              disabled={pending}
              onChange={(event) =>
                setScoreInputs((prev) => ({ ...prev, [dimension.id]: event.target.value }))
              }
            />
          </Field>
        ))}
      </div>

      <Field label="评语" htmlFor={`comment-${submissionId}`} hint="可选；写清楚亮点和可以改进的地方，学生会看到这段评语">
        <Textarea
          id={`comment-${submissionId}`}
          rows={3}
          className="min-h-20"
          maxLength={2000}
          placeholder="这次的数据记录很完整，如果图表再标注单位会更好。"
          value={comment}
          disabled={pending}
          onChange={(event) => setComment(event.target.value)}
        />
      </Field>

      <FormMessage error={error ?? undefined} success={success ?? undefined} />

      <Button type="submit" variant="accent" size="sm" disabled={pending}>
        {pending ? "保存中…" : "保存评价"}
      </Button>
    </form>
  );
}
