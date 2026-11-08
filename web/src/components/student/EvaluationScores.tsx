import type { EvaluationScore } from "@/lib/types";

/** 评价维度分数：维度名 + 得分/满分，学生端评价列表统一复用 */
export function EvaluationScores({ scores }: { scores: EvaluationScore[] | null | undefined }) {
  const list = scores ?? [];
  if (list.length === 0) {
    return <p className="text-sm text-ink-soft">这次评价没有维度分数。</p>;
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {list.map((score, index) => (
        <li
          key={`${score.dimensionName}-${index}`}
          className="flex items-baseline gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1"
        >
          <span className="text-xs font-medium text-ink-soft">{score.dimensionName}</span>
          <span className="text-sm font-semibold tabular-nums text-brand-800">
            {score.score}
            <span className="text-xs font-normal text-ink-soft"> / {score.maxScore}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
