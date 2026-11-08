import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { getStudentAssignmentDetail } from "@/lib/data";
import { dueLabel, formatDateTime, scorePercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconArrowLeft } from "@/components/ui/icons";
import { dueBadgeTone, submissionStatus } from "@/components/student/status";
import { SubmitAssignmentForm } from "@/components/student/submit-assignment-form";

export const metadata: Metadata = { title: "作业详情" };

export default async function StudentAssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole(ROLES.STUDENT);
  const assignment = await getStudentAssignmentDetail(id, user.id);
  if (!assignment) notFound();

  const submission = assignment.mySubmission;
  const status = submissionStatus(submission);
  const due = dueLabel(assignment.dueAt);
  const percent = scorePercent(submission?.score ?? null, assignment.points);

  return (
    <>
      <Link
        href="/student/assignments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800"
      >
        <IconArrowLeft className="size-4" />
        返回作业列表
      </Link>

      <PageHeader
        eyebrow={`${assignment.course.title} · ${assignment.course.class.name}`}
        title={assignment.title}
        description={`任课教师：${assignment.course.class.teacher.name}`}
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>作业要求</CardTitle>
              <Badge tone={dueBadgeTone(due.tone)}>{due.text}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="whitespace-pre-wrap text-sm leading-6 text-ink">
                {assignment.description || "教师没有填写具体作业要求，请按课堂布置完成。"}
              </p>
              <dl className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-brand-50/60 px-3 py-2.5">
                  <dt className="text-xs text-ink-soft">满分</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-brand-900">
                    {assignment.points} 分
                  </dd>
                </div>
                <div className="rounded-xl bg-brand-50/60 px-3 py-2.5">
                  <dt className="text-xs text-ink-soft">截止时间</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-brand-900">
                    {formatDateTime(assignment.dueAt)}
                  </dd>
                </div>
                <div className="rounded-xl bg-brand-50/60 px-3 py-2.5">
                  <dt className="text-xs text-ink-soft">提交状态</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-brand-900">{status.label}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {submission ? (
            <Card>
              <CardHeader>
                <CardTitle>我的提交</CardTitle>
                {submission.gradedAt ? (
                  <span className="text-xs text-ink-soft">
                    批改于 {formatDateTime(submission.gradedAt)}
                  </span>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="whitespace-pre-wrap rounded-xl border border-line bg-brand-50/30 p-4 text-sm leading-6 text-ink">
                  {submission.content}
                </p>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3 text-xs text-ink-soft">
                  <span>提交时间：{formatDateTime(submission.submittedAt)}</span>
                </div>

                {submission.score !== null ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-emerald-800">教师评分</p>
                        <p className="mt-1 text-2xl font-semibold leading-none text-brand-900">
                          {submission.score}
                          <span className="ml-1 text-sm font-medium text-ink-soft">
                            / {assignment.points} 分
                          </span>
                        </p>
                      </div>
                      {percent !== null ? <Badge tone="success">{percent}%</Badge> : null}
                    </div>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-emerald-100">
                      <div
                        className="h-full rounded-full bg-emerald-600"
                        style={{ width: `${percent ?? 0}%` }}
                      />
                    </div>
                    <div className="mt-3 border-t border-emerald-200 pt-3">
                      <p className="text-xs font-medium text-emerald-800">教师评语</p>
                      {submission.feedback ? (
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">
                          {submission.feedback}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-ink-soft">教师暂未留下评语。</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm text-sky-800">
                    已提交，等待教师批改。批改前你仍然可以重新提交。
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside aria-label="提交作业" className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>{submission ? "重新提交" : "提交作业"}</CardTitle>
            </CardHeader>
            <CardContent>
              {submission && submission.score !== null ? (
                <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  这份作业已经批改过。重新提交会覆盖原内容，并清空分数与教师评语。
                </p>
              ) : null}
              <SubmitAssignmentForm
                assignmentId={assignment.id}
                defaultContent={submission?.content ?? ""}
                hasSubmission={Boolean(submission)}
                isGraded={submission ? submission.score !== null : false}
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
