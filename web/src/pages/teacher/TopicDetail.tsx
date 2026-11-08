import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { IconArrowLeft } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { DimensionManager } from "@/components/teacher/DimensionManager";
import { ErrorState, LoadingState } from "@/components/teacher/Feedback";
import { GroupManager } from "@/components/teacher/GroupManager";
import { GroupSettings } from "@/components/teacher/GroupSettings";
import { MarkdownEditor } from "@/components/teacher/MarkdownEditor";
import { MemberManager } from "@/components/teacher/MemberManager";
import { Panel } from "@/components/teacher/Panel";
import { SubmissionList } from "@/components/teacher/SubmissionList";
import { TopicStatusBadge } from "@/components/teacher/StatusBadge";
import type { TeacherTopicDetail } from "@/components/teacher/v4types";
import { ApiError, api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import type { TopicStatus } from "@/lib/types";

export default function TeacherTopicDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [topic, setTopic] = useState<TeacherTopicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const [statusPending, setStatusPending] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotFound(false);
    setForbidden(false);
    try {
      setTopic(await api.get<TeacherTopicDetail>(`/api/teacher/topics/${id}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setTopic(null);
        setNotFound(true);
      } else if (err instanceof ApiError && err.status === 403) {
        setTopic(null);
        setForbidden(true);
      } else {
        setError(errorMessage(err, "课题详情加载失败，请刷新页面重试"));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  const isOwner = Boolean(topic && topic.owner.id === user.id);

  async function toggleStatus(next: TopicStatus) {
    if (!topic || statusPending) return;
    if (next === "CLOSED" && !window.confirm("关闭后学生将不能继续提交，确定关闭课题吗？")) return;

    setStatusPending(true);
    setStatusError(null);
    try {
      await api.patch(`/api/teacher/topics/${topic.id}`, { status: next });
      await load();
    } catch (err) {
      setStatusError(errorMessage(err, "课题状态更新失败，请稍后重试"));
    } finally {
      setStatusPending(false);
    }
  }

  return (
    <AppShell user={user}>
      {notFound ? (
        <div className="mx-auto max-w-md rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">404</p>
          <p className="mt-2 text-base font-semibold text-brand-900">课题不存在</p>
          <p className="mt-1 text-sm leading-6 text-ink-soft">
            这个课题可能已被删除，或者不属于你的账号。
          </p>
          <Link to="/teacher/topics" className={cn(buttonClass("secondary", "sm"), "mt-4")}>
            返回课题列表
          </Link>
        </div>
      ) : forbidden ? (
        <div className="mx-auto max-w-md rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">403</p>
          <p className="mt-2 text-base font-semibold text-brand-900">无权访问该课题</p>
          <p className="mt-1 text-sm leading-6 text-ink-soft">
            只有课题创建者和助教可以查看这个课题。如果你认为这是错误，请联系创建者把你加为助教。
          </p>
          <Link to="/teacher/topics" className={cn(buttonClass("secondary", "sm"), "mt-4")}>
            返回课题列表
          </Link>
        </div>
      ) : loading && !topic ? (
        <LoadingState label="正在加载课题详情…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : topic ? (
        <div className="space-y-6">
          <PageHeader
            eyebrow="课题详情"
            title={topic.title}
            description={`${topic.class ? `${topic.class.name} · ` : ""}负责人 ${topic.owner.name} · ${topic.students.filter((student) => !student.removedAt).length} 名学生 · ${topic.submissions.length} 份提交`}
            actions={
              <Link to="/teacher/topics" className={buttonClass("secondary", "sm")}>
                <IconArrowLeft className="size-4" />
                返回课题列表
              </Link>
            }
          />

          {/* 状态与概览 */}
          <div className="aw-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <TopicStatusBadge status={topic.status} />
                {topic.class ? (
                  <Link
                    to={`/teacher/classes/${topic.class.id}`}
                    className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 hover:border-brand-300 hover:bg-brand-100"
                  >
                    班级 {topic.class.name}
                  </Link>
                ) : (
                  <Badge tone="neutral">未关联班级</Badge>
                )}
                <Badge tone={topic.submitMode === "GROUP" ? "info" : "neutral"}>
                  {topic.submitMode === "GROUP" ? "小组提交" : "个人提交"}
                </Badge>
                <Badge tone="neutral">负责人 {topic.owner.name}</Badge>
                {!isOwner ? <Badge tone="brand">助教</Badge> : null}
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
                <span>{topic.assistants.length} 名助教</span>
                <span>{topic.students.filter((student) => !student.removedAt).length} 名在册学生</span>
                <span>{topic.groups.length} 个小组</span>
                <span>{topic.dimensions.length} 个评价维度</span>
                <span className={topic.submissions.some((item) => item.pending) ? "font-medium text-amber-700" : ""}>
                  {topic.submissions.filter((item) => item.pending).length} 份待评价
                </span>
              </p>
              {!isOwner ? (
                <p className="mt-2 text-xs leading-5 text-ink-soft">
                  你是本课题的助教：可以添加/移出学生、管理分组、管理评价维度、评价提交；介绍页、助教管理与分组设置仅创建者可操作。
                </p>
              ) : null}
            </div>

            {isOwner ? (
              <Button
                type="button"
                variant={topic.status === "ACTIVE" ? "danger" : "primary"}
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={statusPending}
                onClick={() => void toggleStatus(topic.status === "ACTIVE" ? "CLOSED" : "ACTIVE")}
              >
                {statusPending ? "处理中…" : topic.status === "ACTIVE" ? "关闭课题" : "恢复课题"}
              </Button>
            ) : null}
          </div>
          <FormMessage error={statusError ?? undefined} />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-6">
              <Panel
                title="课题介绍"
                description={isOwner ? "Markdown 编辑，学生打开课题时看到渲染后的介绍页" : "只有创建者可以编辑介绍页"}
              >
                <MarkdownEditor
                  topicId={topic.id}
                  value={topic.descriptionMd}
                  canEdit={isOwner}
                  onSaved={() => void load()}
                />
              </Panel>

              <Panel
                title={`分组管理（${topic.groups.length} 组）`}
                description={
                  topic.submitMode === "GROUP"
                    ? "小组提交模式下，组员共享一份提交与评价；可在下方建组、加人、随机分组"
                    : "当前是个人提交模式；分组会保存，切换为「小组提交」后才影响提交与评价"
                }
                action={
                  topic.submitMode === "GROUP" ? (
                    <Badge tone="info">{topic.allowStudentGroups ? "学生可自行组队" : "由老师分组"}</Badge>
                  ) : null
                }
              >
                <GroupManager
                  topicId={topic.id}
                  groups={topic.groups}
                  students={topic.students}
                  submitMode={topic.submitMode}
                  groupMin={topic.groupMin}
                  groupMax={topic.groupMax}
                  canManage
                  onChanged={() => void load()}
                />
              </Panel>

              <Panel
                title={`提交与评价（${topic.submissions.length}）`}
                description="展开提交可查看内容、附件与评价历史，并直接新增评价"
                action={
                  topic.submissions.some((item) => item.pending) ? (
                    <Badge tone="warning">
                      {topic.submissions.filter((item) => item.pending).length} 份待评价
                    </Badge>
                  ) : (
                    <Badge tone="success">全部已评价</Badge>
                  )
                }
              >
                <SubmissionList
                  submissions={topic.submissions}
                  dimensions={topic.dimensions}
                  onChanged={() => void load()}
                />
              </Panel>
            </div>

            <div className="min-w-0 space-y-6">
              <Panel title="成员管理" description="学生从班级学生中勾选；助教最多 3 名，移出后保留历史">
                <MemberManager topic={topic} isOwner={isOwner} onChanged={() => void load()} />
              </Panel>

              <Panel title="分组设置" description="提交模式、每组人数与是否允许学生自行组队">
                <GroupSettings topic={topic} canEdit={isOwner} onChanged={() => void load()} />
              </Panel>

              <Panel title="评价维度" description="维度属于课题，评价时按维度打分（0 到满分）">
                <DimensionManager
                  topicId={topic.id}
                  dimensions={topic.dimensions}
                  onChanged={() => void load()}
                />
              </Panel>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
