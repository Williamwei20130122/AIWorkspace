import { cn } from "@/lib/format";

/** 渲染维度分数只需要这三个字段（兼容不同接口返回） */
export type ScoreLike = {
  dimensionName: string;
  score: number;
  maxScore: number;
};

/** 评价维度分数：一行小标签，如「数据完整性 85/100」 */
export function EvaluationScores({ scores, className }: { scores: ScoreLike[]; className?: string }) {
  if (!scores || scores.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {scores.map((score, index) => (
        <li
          key={`${score.dimensionName}-${index}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-brand-50 px-2 py-1 text-xs"
        >
          <span className="text-ink-soft">{score.dimensionName}</span>
          <span className="font-semibold tabular-nums text-brand-800">
            {score.score}
            <span className="font-normal text-ink-soft">/{score.maxScore}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
