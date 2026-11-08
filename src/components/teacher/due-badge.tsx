import { Badge, type BadgeTone } from "@/components/ui/badge";
import { dueLabel, type DueTone } from "@/lib/format";

const TONE: Record<DueTone, BadgeTone> = {
  normal: "neutral",
  soon: "warning",
  overdue: "danger",
};

/** 截止时间徽章：正常（灰）/ 临近（琥珀）/ 已截止（红），文案统一走 dueLabel */
export function DueBadge({ dueAt }: { dueAt: Date | string | null | undefined }) {
  const due = dueLabel(dueAt);
  return <Badge tone={TONE[due.tone]}>{due.text}</Badge>;
}
