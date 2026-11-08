import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";
import { listStudentClasses } from "@/lib/data";
import { PageHeader } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBook, IconUsers } from "@/components/ui/icons";
import { JoinClassForm } from "@/components/student/join-class-form";

export const metadata: Metadata = { title: "我的班级" };

export default async function StudentClassesPage() {
  const user = await requireRole(ROLES.STUDENT);
  const classes = await listStudentClasses(user.id);

  return (
    <>
      <PageHeader
        eyebrow="学生工作台"
        title="我的班级"
        description="你加入的班级与课程都在这里；拿到新的邀请码可以随时加入班级。"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="已加入的班级">
          {classes.length === 0 ? (
            <EmptyState
              icon={<IconBook className="size-6" />}
              title="还没有加入班级"
              description="输入教师提供的 6 位邀请码，即可加入班级并看到课程与作业。"
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {classes.map((klass) => (
                <li key={klass.id} className="aw-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-brand-900">
                        {klass.name}
                      </h3>
                      {klass.grade ? (
                        <p className="mt-0.5 text-xs text-ink-soft">{klass.grade}</p>
                      ) : null}
                    </div>
                    {klass.grade ? <Badge tone="brand">{klass.grade}</Badge> : null}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <Avatar name={klass.teacher.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-brand-900">
                        {klass.teacher.name}
                      </p>
                      <p className="truncate text-xs text-ink-soft">{klass.teacher.email}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-4 border-t border-line pt-3 text-xs text-ink-soft">
                    <span className="inline-flex items-center gap-1.5">
                      <IconUsers className="size-4 text-brand-600" />
                      {klass._count.enrollments} 人
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <IconBook className="size-4 text-brand-600" />
                      {klass.courses.length} 门课程
                    </span>
                  </div>

                  {klass.courses.length === 0 ? (
                    <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-ink-soft">
                      教师还没有创建课程
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {klass.courses.map((course) => (
                        <li
                          key={course.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-brand-50/50 px-3 py-2"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: course.color }}
                              aria-hidden="true"
                            />
                            <span className="truncate text-sm text-brand-900">{course.title}</span>
                          </span>
                          <span className="shrink-0 text-xs text-ink-soft">
                            {course._count.assignments} 份作业
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside aria-label="加入班级" className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>加入班级</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm leading-6 text-ink-soft">
                输入任课教师提供的 6 位邀请码，即可加入班级并查看课程与作业。
              </p>
              <JoinClassForm />
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
