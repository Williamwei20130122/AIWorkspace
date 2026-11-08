import { useState } from "react";
import type { FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { IconCheck, IconUsers } from "@/components/ui/icons";
import { api, errorMessage } from "@/lib/api";
import type { MyGroup, StudentGroupSummary } from "@/lib/types";

type PendingAction = "create" | "leave" | `join:${string}` | null;

/**
 * 课题分组区（仅 GROUP 模式的课题展示）：
 * - 已分组：显示组名、组员、人数 x/max、退出小组（仅允许学生自组时）；
 * - 未分组 + allowStudentGroups：可加入未满小组、可创建小组（创建者自动入组）；
 * - 未分组 + 不可自组：提示「由老师分组」。
 */
export function GroupPanel({
  topicId,
  groupMin,
  groupMax,
  allowStudentGroups,
  myGroup,
  groups,
  onChanged,
}: {
  topicId: string;
  groupMin: number;
  groupMax: number;
  allowStudentGroups: boolean;
  myGroup: MyGroup | null;
  groups: StudentGroupSummary[];
  onChanged: () => void;
}) {
  const [groupName, setGroupName] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const members = myGroup?.members ?? [];
  const memberCount = members.length;
  const busy = pending !== null;

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setPending("create");
    setError(null);
    setSuccess(null);
    try {
      const trimmed = groupName.trim();
      await api.post<{ id?: string }>(
        `/api/student/topics/${topicId}/groups`,
        trimmed ? { name: trimmed } : {},
      );
      setGroupName("");
      setSuccess("小组创建成功，你已自动加入该小组。");
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "创建小组失败，请稍后重试。"));
    } finally {
      setPending(null);
    }
  }

  async function handleJoin(group: StudentGroupSummary) {
    if (busy) return;
    setPending(`join:${group.id}`);
    setError(null);
    setSuccess(null);
    try {
      await api.post<{ ok?: boolean }>(`/api/student/topics/${topicId}/groups/${group.id}/join`);
      setSuccess(`已加入「${group.name}」。`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "加入小组失败，请稍后重试。"));
    } finally {
      setPending(null);
    }
  }

  async function handleLeave() {
    if (busy || !myGroup) return;
    setPending("leave");
    setError(null);
    setSuccess(null);
    try {
      await api.post<{ ok?: boolean }>(`/api/student/topics/${topicId}/groups/leave`);
      setSuccess(`已退出「${myGroup.name}」。`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "退出小组失败，请稍后重试。"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <FormMessage error={error ?? undefined} success={success ?? undefined} />

      {myGroup ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink-soft">我的小组</p>
          <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
                <IconUsers className="size-4" />
              </span>
              <span className="truncate text-sm font-semibold text-brand-900">{myGroup.name}</span>
              <Badge tone={memberCount >= groupMin ? "success" : "warning"}>
                {memberCount}/{groupMax} 人
              </Badge>
            </span>
            {allowStudentGroups ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => void handleLeave()}
                disabled={busy}
              >
                {pending === "leave" ? "退出中…" : "退出小组"}
              </Button>
            ) : null}
          </div>

          <ul className="mt-3 flex flex-wrap gap-1.5">
            {members.map((member) => (
              <li
                key={member.id}
                className="rounded-lg border border-line bg-white px-2 py-1 text-xs font-medium text-brand-900"
              >
                {member.name}
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs leading-relaxed text-ink-soft">
            每组要求 {groupMin}–{groupMax} 人
            {memberCount < groupMin
              ? `，还差 ${groupMin - memberCount} 人才能提交。`
              : "，小组已满足提交人数要求。"}
          </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line bg-brand-50/30 p-4">
          <p className="text-sm font-semibold text-brand-900">你还没有加入小组</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            本课题按小组提交，先加入或创建小组后才能提交。
          </p>
        </div>
      )}

      {!myGroup && allowStudentGroups ? (
        <>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink-soft">可加入的小组</p>
              <span className="text-xs text-ink-soft">每组最多 {groupMax} 人</span>
            </div>
            {groups.length === 0 ? (
              <p className="mt-1 text-sm text-ink-soft">还没有小组，你可以创建第一个小组。</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {groups.map((group) => {
                  const count = group.memberCount ?? group.members?.length ?? 0;
                  const full = count >= groupMax;
                  return (
                    <li
                      key={group.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium text-brand-900">
                          {group.name}
                        </span>
                        <Badge tone={full ? "neutral" : "brand"}>
                          {count}/{groupMax} 人
                        </Badge>
                        {full ? <Badge tone="neutral">已满</Badge> : null}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleJoin(group)}
                        disabled={busy || full}
                      >
                        {pending === `join:${group.id}` ? "加入中…" : "加入"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-line pt-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
              <IconCheck className="size-3.5 text-brand-600" />
              创建小组（创建后自动加入）
            </p>
            <form onSubmit={handleCreate} className="mt-2 space-y-3">
              <Field
                label="小组名称"
                htmlFor="student-group-name"
                hint="留空则由系统按序号命名。"
              >
                <Input
                  id="student-group-name"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="例如：第 1 组"
                  maxLength={30}
                  disabled={busy}
                />
              </Field>
              <Button type="submit" variant="secondary" className="w-full sm:w-auto" disabled={busy}>
                {pending === "create" ? "创建中…" : "创建小组并加入"}
              </Button>
            </form>
          </div>
        </>
      ) : null}

      {!myGroup && !allowStudentGroups ? (
        <div className="rounded-xl border border-line bg-muted/40 px-3.5 py-3">
          <p className="text-sm font-semibold text-brand-900">由老师分组</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            本课题不允许学生自行组队，等待老师把你加入某个小组后即可提交。
          </p>
        </div>
      ) : null}
    </div>
  );
}
