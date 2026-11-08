import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { listStudentGrades } from "@/lib/data";
import { cn, formatDateTime, scorePercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent, SectionTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAward } from "@/components/ui/icons";

export const metadata: Metadata = { title: "成绩单" };

type GradeItem = Awaited<ReturnType<typeof listStudentGrades>>[number];
type ScoredEntry = { item: GradeItem; percent: number };

/** 百分比进度条颜色：优秀=teal、及格=琥珀、不及格=红 */
function barColor(percent: number): string {
  if (percent >= 85) return "bg-brand-600";
  if (percent >= 60) return "bg-amber-500";
  return "bg-red-500";
}

export default async function StudentGradesPage() {
  const user = await requireRole(ROLES.STUDENT);
  const grades = await listStudentGrades(user.id);

  const scored: ScoredEntry[] = [];
  for (const item of grades) {
    const percent = scorePercent(item.score, item.assignment.points);
    if (percent !== null) scored.push({ item, percent });
  }

  const average =
    scored.length > 0
      ? Math.round(scored.reduce((sum, entry) => sum + entry.percent, 0) / scored.length)
      : null;

  const averageTone: BadgeTone =
    average === null ? "neutral" : average >= 85 ? "success" : average >= 60 ? "brand" : "warning";
  const averageLabel =
    average === null
      ? "暂无成绩"
      : average >= 85
        ? "表现优秀"
        : average >= 60
          ? "继续努力"
          : "需要加油";

  // 按「班级 + 课程」分组，保持接口返回的提交时间倒序
  const groups = new Map<string, { title: string; className: string; entries: ScoredEntry[] }>();
  for (const entry of scored) {
    const course = entry.item.assignment.course;
    const key = `${course.class.name}｜${course.title}`;
    const group = groups.get(key) ?? {
      title: course.title,
      className: course.class.name,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(key, group);
  }

  return (
    <>
      <PageHeader
        eyebrow="学生工作台"
        title="成绩单"
        description="所有已批改作业的成绩汇总；百分比为得分占作业满分的比例。"
      />

      <Card className="mb-6">
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-ink-soft">平均分</p>
              <p className="mt-1 text-4xl font-semibold leading-none tracking-tight text-brand-900">
                {average === null ? "—" : `${average}%`}
              </p>
              <p className="mt-2 text-xs text-ink-soft">
                {average === null
                  ? "还没有已批改的作业，批改后会在这里生成平均分。"
                  : `基于 ${scored.length} 份已批改作业，按得分 / 满分折算`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">已批改 {scored.length} 份</Badge>
              <Badge tone="neutral">覆盖 {groups.size} 门课程</Badge>
              <Badge tone={averageTone}>{averageLabel}</Badge>
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-brand-50">
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${average ?? 0}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {scored.length === 0 ? (
        <EmptyState
          icon={<IconAward className="size-6" />}
          title="还没有成绩"
          description="作业被教师批改后，分数与评语会显示在这里。"
          action={
            <Link href="/student/assignments" className={buttonClass("secondary", "sm")}>
              查看我的作业
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          {[...groups.values()].map((group) => {
            const groupAverage = Math.round(
              group.entries.reduce((sum, entry) => sum + entry.percent, 0) / group.entries.length,
            );

            return (
              <section key={`${group.className}｜${group.title}`} aria-label={`${group.title}成绩`}>
                <SectionTitle
                  title={group.title}
                  action={
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{group.className}</Badge>
                      <Badge tone="brand">平均 {groupAverage}%</Badge>
                    </span>
                  }
                />
                <ul className="space-y-3">
                  {group.entries.map(({ item, percent }) => (
                    <li key={item.id}>
                      <Link
                        href={`/student/assignments/${item.assignment.id}`}
                        className="aw-card block p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-brand-900">
                              {item.assignment.title}
                            </p>
                            <p className="mt-1 text-xs text-ink-soft">
                              {item.assignment.course.title} · {item.assignment.course.class.name} ·
                              提交于 {formatDateTime(item.submittedAt)}
                            </p>
                          </div>
                          <div className="shrink-0 text-left sm:text-right">
                            <p className="text-sm font-semibold text-brand-900">
                              {item.score}
                              <span className="ml-1 text-xs font-medium text-ink-soft">
                                / {item.assignment.points} 分
                              </span>
                            </p>
                            <p className="mt-0.5 text-xs font-medium text-brand-700">{percent}%</p>
                          </div>
                        </div>
                        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-brand-50">
                          <div
                            className={cn("h-full rounded-full", barColor(percent))}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
