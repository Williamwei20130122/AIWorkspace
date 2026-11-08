import type { BadgeTone } from "@/components/ui/badge";
import type { DueTone } from "@/lib/format";

/** 截止时间语气 → 徽章色调（已截止=红、临近=琥珀、正常=中性） */
export function dueBadgeTone(tone: DueTone): BadgeTone {
  if (tone === "overdue") return "danger";
  if (tone === "soon") return "warning";
  return "neutral";
}

export type SubmissionState = "pending" | "submitted" | "graded";

export type SubmissionStatus = {
  state: SubmissionState;
  label: string;
  tone: BadgeTone;
};

/**
 * 学生视角的提交状态徽章：
 * 未提交 = warning、已提交待批改 = info、已批改 = success
 */
export function submissionStatus(
  submission: { score: number | null } | null | undefined,
): SubmissionStatus {
  if (!submission) return { state: "pending", label: "未提交", tone: "warning" };
  if (submission.score === null) return { state: "submitted", label: "已提交", tone: "info" };
  return { state: "graded", label: "已批改", tone: "success" };
}
