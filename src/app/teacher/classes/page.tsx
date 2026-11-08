import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { listTeacherClasses } from "@/lib/data";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/card";
import { IconArrowRight, IconUsers } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { CreateClassForm } from "@/components/teacher/create-class-form";
import { Panel } from "@/components/teacher/panel";

type TeacherClass = Awaited<ReturnType<typeof listTeacherClasses>>[number];

export const metadata: Metadata = { title: "我的班级" };

export default async function TeacherClassesPage() {
  const user = await requireRole(ROLES.TEACHER);
  const classes = await listTeacherClasses(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="教师工作台"
        title="我的班级"
        description="管理班级成员、课程与公告。把 6 位邀请码发给学生，他们登录后即可加入班级。"
        actions={
          <Link href="/teacher/assignments" className={buttonClass("secondary", "sm")}>
            查看全部作业
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section>
          <SectionTitle title={`全部班级（${classes.length}）`} />
          {classes.length === 0 ? (
            <EmptyState
              icon={<IconUsers />}
              title="还没有班级"
              description="创建第一个班级，生成邀请码后学生就能加入。"
              action={
                <Link href="#create-class" className={buttonClass("primary", "sm")}>
                  去创建班级
                </Link>
              }
            />
          ) : (
            <ul className="space-y-3">
              {classes.map((klass) => (
                <ClassCard key={klass.id} klass={klass} />
              ))}
            </ul>
          )}
        </section>

        <aside id="create-class" className="scroll-mt-24">
          <Panel
            title="新建班级"
            description="创建后会自动生成 6 位邀请码"
            className="xl:sticky xl:top-6"
          >
            <CreateClassForm />
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function ClassCard({ klass }: { klass: TeacherClass }) {
  return (
    <li>
      <Link
        href={`/teacher/classes/${klass.id}`}
        className="aw-card group flex flex-col gap-3 p-4 transition-colors hover:border-brand-300 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-brand-900 group-hover:text-brand-700">
                {klass.name}
              </h3>
              {klass.grade ? <Badge tone="neutral">{klass.grade}</Badge> : null}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              {klass._count.enrollments} 名学生 · {klass._count.courses} 门课程
            </p>
          </div>
          <span className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-xs font-semibold tracking-[0.18em] text-brand-700">
            {klass.joinCode}
          </span>
        </div>

        {klass.courses.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {klass.courses.slice(0, 4).map((course) => (
              <li
                key={course.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2 py-0.5 text-[11px] font-medium text-ink-soft"
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: course.color }}
                />
                {course.title}
              </li>
            ))}
            {klass.courses.length > 4 ? (
              <li className="px-1 py-0.5 text-[11px] text-ink-soft">等 {klass.courses.length} 门</li>
            ) : null}
          </ul>
        ) : (
          <p className="text-[11px] text-ink-soft">还没有课程，进入班级即可创建</p>
        )}

        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 group-hover:text-brand-700">
          查看班级详情
          <IconArrowRight className="size-3.5" />
        </span>
      </Link>
    </li>
  );
}
