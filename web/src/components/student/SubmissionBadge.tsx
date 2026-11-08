import type { BadgeTone } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { scorePercent } from "@/lib/format";
import type { MySubmission } from "@/lib/types";

export type SubmissionStatus = "not-submitted" | "submitted" | "graded";

/** 依据「我的提交」判定状态：无提交=未提交；有提交无分数=已提交；有分数=已批改 */
export function submissionStatus(submission: MySubmission | null | undefined): SubmissionStatus {
  if (!submission) return "not-submitted";
  if (submission.score === null || submission.score === undefined) return "submitted";
  return "graded";
}

const TONE: Record<SubmissionStatus, BadgeTone> = {
  "not-submitted": "warning",
  submitted: "info",
  graded: "success",
};

const LABEL: Record<SubmissionStatus, string> = {
  "not-submitted": "未提交",
  submitted: "已提交",
  graded: "已批改",
};

/** 作业状态徽章；已批改时附带分数与得分率 */
export function SubmissionBadge({
  submission,
  points,
}: {
  submission: MySubmission | null | undefined;
  points: number;
}) {
  const status = submissionStatus(submission);
  if (status === "graded" && submission && submission.score !== null) {
    const percent = scorePercent(submission.score, points);
    return (
      <Badge tone="success">
        已批改 {submission.score}/{points}
        {percent === null ? "" : `（${percent}%）`}
      </Badge>
    );
  }
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
