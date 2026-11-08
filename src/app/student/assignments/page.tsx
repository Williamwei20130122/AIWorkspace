import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { listStudentAssignments } from "@/lib/data";
import { dueLabel, scorePercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconClipboard } from "@/components/ui/icons";
import { submissionStatus, dueBadgeTone, type SubmissionState } from "@/components/student/status";

export const metadata: Metadata = { title: "我的作业" };

type FilterKey = "all" | SubmissionState;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "pending", label: "未提交" },
  { key: "submitted", label: "已提交" },
  { key: "graded", label: "已批改" },
];

function parseFilter(value: string | string[] | undefined): FilterKey {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "pending" || raw === "submitted" || raw === "graded") return raw;
  return "all";
}

function hrefFor(filter: FilterKey): string {
  return filter === "all" ? "/student/assignments" : `/student/assignments?status=${filter}`;
}

export default async function StudentAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const filter = parseFilter(params.status);
  const user = await requireRole(ROLES.STUDENT);

  const assignments = await listStudentAssignments(user.id);
  // 截止时间早的排前面，没有截止时间的排最后
  const sorted = [...assignments].sort(
    (a, b) =>
      (a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) -
      (b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY),
  );

  const items = sorted.map((assignment) => ({
    assignment,
    status: submissionStatus(assignment.mySubmission),
  }));

  const counts: Record<FilterKey, number> = {
    all: items.length,
    pending: items.filter((item) => item.status.state === "pending").length,
    submitted: items.filter((item) => item.status.state === "submitted").length,
    graded: items.filter((item) => item.status.state === "graded").length,
  };

  const visible = items.filter((item) => filter === "all" || item.status.state === filter);

  return (
    <>
      <PageHeader
        eyebrow="学生工作台"
        title="我的作业"
        description={`共 ${counts.all} 份作业，其中 ${counts.pending} 份还未提交。点击作业可以查看要求并提交。`}
      />

      <nav className="mb-4 flex flex-wrap gap-2" aria-label="按提交状态筛选">
        {FILTERS.map((tab) => {
          const active = tab.key === filter;
          return (
            <Link
              key={tab.key}
              href={hrefFor(tab.key)}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "inline-flex items-center gap-1.5 rounded-full border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white"
                  : "inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-700"
              }
            >
              {tab.label}
              <span className={active ? "text-xs text-white/80" : "text-xs text-ink-soft/80"}>
                {counts[tab.key]}
              </span>
            </Link>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <EmptyState
          icon={<IconClipboard className="size-6" />}
          title={filter === "all" ? "还没有作业" : "这个状态下没有作业"}
          description={
            filter === "all"
              ? "加入班级后，教师发布的作业会出现在这里。"
              : "换个筛选条件看看，或查看全部作业。"
          }
          action={
            filter === "all" ? (
              <Link href="/student/classes" className={buttonClass("secondary", "sm")}>
                去我的班级
              </Link>
            ) : (
              <Link href="/student/assignments" className={buttonClass("secondary", "sm")}>
                查看全部作业
              </Link>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {visible.map(({ assignment, status }) => {
            const due = dueLabel(assignment.dueAt);
            const percent = scorePercent(assignment.mySubmission?.score ?? null, assignment.points);
            return (
              <li key={assignment.id}>
                <Link
                  href={`/student/assignments/${assignment.id}`}
                  className="aw-card block p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-brand-900">{assignment.title}</h3>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-soft">
                        {assignment.course.title} · {assignment.course.class.name}
                      </p>
                      {assignment.description ? (
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-soft">
                          {assignment.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <Badge tone={dueBadgeTone(due.tone)}>{due.text}</Badge>
                      {percent !== null ? (
                        <span className="text-sm font-semibold text-brand-900">
                          {assignment.mySubmission?.score} / {assignment.points} 分
                          <span className="ml-1 text-xs font-medium text-ink-soft">（{percent}%）</span>
                        </span>
                      ) : (
                        <span className="text-xs text-ink-soft">满分 {assignment.points} 分</span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
