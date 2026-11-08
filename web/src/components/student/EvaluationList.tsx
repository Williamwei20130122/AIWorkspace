import { Link } from "react-router-dom";
import { EvaluationScores } from "@/components/student/EvaluationScores";
import { cn, formatDateTime } from "@/lib/format";
import type { MyEvaluationItem } from "@/lib/types";

/** 「我的评价」列表：工作台最近评价与评价汇总页共用，compact 时评语截断两行 */
export function EvaluationList({
  items,
  compact = false,
}: {
  items: MyEvaluationItem[];
  compact?: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        const comment = item.comment?.trim() ?? "";
        return (
          <li key={item.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link
                to={`/student/topics/${item.topic.id}`}
                className="text-sm font-semibold text-brand-900 transition-colors hover:text-brand-700"
              >
                {item.topic.title}
              </Link>
              <span className="text-xs text-ink-soft">{formatDateTime(item.createdAt)}</span>
            </div>
            <div className="mt-2">
              <EvaluationScores scores={item.scores} />
            </div>
            <p
              className={cn(
                "mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-soft",
                compact && "line-clamp-2",
              )}
            >
              {comment || "老师没有填写评语。"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
