import { Badge } from "@/components/ui/badge";
import { dueLabel } from "@/lib/format";

/** 截止时间徽章：已截止（红）/ 今天或 3 天内（琥珀）/ 普通（灰） */
export function DueBadge({ dueAt }: { dueAt: string | null | undefined }) {
  const { text, tone } = dueLabel(dueAt);
  const badgeTone = tone === "overdue" ? "danger" : tone === "soon" ? "warning" : "neutral";
  return <Badge tone={badgeTone}>{text}</Badge>;
}
