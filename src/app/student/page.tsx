import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { getStudentOverview } from "@/lib/data";
import { dueLabel, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { SectionTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  IconAward,
  IconBell,
  IconCheck,
  IconClipboard,
  IconClock,
  IconUsers,
} from "@/components/ui/icons";
import { dueBadgeTone } from "@/components/student/status";

export const metadata: Metadata = { title: "工作台" };

export default async function StudentDashboardPage() {
  const user = await requireRole(ROLES.STUDENT);
  const overview = await getStudentOverview(user.id);

  return (
    <>
      <PageHeader
        eyebrow="学生工作台"
        title={`你好，${user.name}`}
        description="这里汇总了你的班级、待交作业与最新公告，先看看今天有没有要交的作业吧。"
        actions={
          <Link href="/student/assignments" className={buttonClass("accent")}>
            查看我的作业
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="我的班级"
          value={overview.classCount}
          hint={`共 ${overview.courseCount} 门课程`}
          icon={<IconUsers className="size-5" />}
          tone="brand"
        />
        <StatCard
          label="待交作业"
          value={overview.pendingCount}
          hint={overview.pendingCount > 0 ? "别错过截止时间" : "全部完成，继续保持"}
          icon={<IconClipboard className="size-5" />}
          tone="warning"
        />
        <StatCard
          label="已提交"
          value={overview.submittedCount}
          hint="含已批改的作业"
          icon={<IconCheck className="size-5" />}
          tone="success"
        />
        <StatCard
          label="平均分"
          value={overview.averagePercent === null ? "—" : `${overview.averagePercent}%`}
          hint={overview.averagePercent === null ? "暂无已批改作业" : "按得分 / 满分折算"}
          icon={<IconAward className="size-5" />}
          tone="accent"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section aria-label="即将截止">
          <SectionTitle
            title="即将截止"
            action={
              <Link
                href="/student/assignments"
                className="text-sm font-medium text-brand-700 hover:text-brand-800"
              >
                全部作业
              </Link>
            }
          />
          {overview.dueSoon.length === 0 ? (
            <EmptyState
              icon={<IconClock className="size-6" />}
              title="暂时没有待交作业"
              description="教师发布新作业后会出现在这里。"
            />
          ) : (
            <ul className="space-y-3">
              {overview.dueSoon.map((assignment) => {
                const due = dueLabel(assignment.dueAt);
                return (
                  <li key={assignment.id}>
                    <Link
                      href={`/student/assignments/${assignment.id}`}
                      className="aw-card block p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-brand-900">
                            {assignment.title}
                          </p>
                          <p className="mt-1 text-xs text-ink-soft">
                            {assignment.course.title} · {assignment.course.class.name}
                          </p>
                        </div>
                        <Badge tone={dueBadgeTone(due.tone)}>{due.text}</Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="最近公告">
          <SectionTitle
            title="最近公告"
            action={
              <Link
                href="/student/classes"
                className="text-sm font-medium text-brand-700 hover:text-brand-800"
              >
                我的班级
              </Link>
            }
          />
          {overview.recentAnnouncements.length === 0 ? (
            <EmptyState
              icon={<IconBell className="size-6" />}
              title="暂无班级公告"
              description="教师发布公告后会显示在这里。"
            />
          ) : (
            <ul className="space-y-3">
              {overview.recentAnnouncements.map((announcement) => (
                <li key={announcement.id} className="aw-card p-4">
                  <p className="text-sm font-semibold text-brand-900">{announcement.title}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {announcement.class.name} · {formatDate(announcement.createdAt)}
                  </p>
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-ink-soft">
                    {announcement.content}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
