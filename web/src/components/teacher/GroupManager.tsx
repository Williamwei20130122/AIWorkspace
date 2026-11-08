import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/form";
import { IconClose } from "@/components/ui/icons";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import type { SubmitMode, TopicGroup, TopicStudent } from "@/lib/types";

/**
 * 课题分组管理（创建者与助教都可操作）：
 * 建组 / 改名 / 删组 / 加人 / 移出 / 随机分组 + 未分组学生列表。
 */
export function GroupManager({
  topicId,
  groups,
  students,
  submitMode,
  groupMin,
  groupMax,
  canManage,
  onChanged,
}: {
  topicId: string;
  groups: TopicGroup[];
  students: TopicStudent[];
  submitMode: SubmitMode;
  groupMin: number;
  groupMax: number;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [createName, setCreateName] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [randomCount, setRandomCount] = useState("");
  const [randomPending, setRandomPending] = useState(false);
  const [randomError, setRandomError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingGroupId, setAddingGroupId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [addSelection, setAddSelection] = useState<Record<string, string>>({});

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const activeStudents = students.filter((student) => !student.removedAt);
  const groupedIds = new Set(groups.flatMap((group) => group.members.map((member) => member.id)));
  const ungrouped = activeStudents.filter((student) => !groupedIds.has(student.id));
  const groupedCount = activeStudents.filter((student) => groupedIds.has(student.id)).length;

  async function handleCreate() {
    if (!canManage || createPending) return;
    setCreatePending(true);
    setCreateError(null);
    setActionError(null);
    setActionSuccess(null);
    try {
      const name = createName.trim();
      await api.post(`/api/teacher/topics/${topicId}/groups`, name ? { name } : {});
      setCreateName("");
      setActionSuccess("已新建小组");
      onChanged();
    } catch (err) {
      setCreateError(errorMessage(err, "新建小组失败，请稍后重试"));
    } finally {
      setCreatePending(false);
    }
  }

  function startRename(group: TopicGroup) {
    setEditingId(group.id);
    setEditName(group.name);
    setRenameError(null);
    setActionError(null);
    setActionSuccess(null);
  }

  async function handleRename(group: TopicGroup) {
    if (!canManage || renamePending) return;
    const name = editName.trim();
    if (!name) {
      setRenameError("请填写小组名称");
      return;
    }
    setRenamePending(true);
    setRenameError(null);
    try {
      await api.patch(`/api/teacher/topics/${topicId}/groups/${group.id}`, { name });
      setEditingId(null);
      setActionSuccess("小组名称已更新");
      onChanged();
    } catch (err) {
      setRenameError(errorMessage(err, "小组改名失败，请稍后重试"));
    } finally {
      setRenamePending(false);
    }
  }

  async function handleDelete(group: TopicGroup) {
    if (!canManage || deletingId) return;
    const confirmed = window.confirm(
      `确定删除小组「${group.name}」吗？组内已有提交时无法删除。`,
    );
    if (!confirmed) return;

    setDeletingId(group.id);
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.del(`/api/teacher/topics/${topicId}/groups/${group.id}`);
      setActionSuccess(`已删除小组「${group.name}」`);
      onChanged();
    } catch (err) {
      setActionError(errorMessage(err, "删除小组失败，请稍后重试"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAddMember(group: TopicGroup) {
    if (!canManage || addingGroupId) return;
    const studentId = addSelection[group.id];
    if (!studentId) {
      setActionError("请先选择要加入小组的学生");
      return;
    }

    setAddingGroupId(group.id);
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.post(`/api/teacher/topics/${topicId}/groups/${group.id}/members`, { studentId });
      setAddSelection((prev) => {
        const next = { ...prev };
        delete next[group.id];
        return next;
      });
      setActionSuccess(`已把学生加入「${group.name}」`);
      onChanged();
    } catch (err) {
      setActionError(errorMessage(err, "加入小组失败，请稍后重试"));
    } finally {
      setAddingGroupId(null);
    }
  }

  async function handleRemoveMember(group: TopicGroup, studentId: string, name: string) {
    if (!canManage || removingMemberId) return;
    const confirmed = window.confirm(`把「${name}」移出小组「${group.name}」吗？`);
    if (!confirmed) return;

    setRemovingMemberId(studentId);
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.del(`/api/teacher/topics/${topicId}/groups/${group.id}/members/${studentId}`);
      setActionSuccess(`已把「${name}」移出小组`);
      onChanged();
    } catch (err) {
      setActionError(errorMessage(err, "移出小组成员失败，请稍后重试"));
    } finally {
      setRemovingMemberId(null);
    }
  }

  async function handleRandom() {
    if (!canManage || randomPending) return;

    let groupCount: number | undefined;
    if (randomCount.trim()) {
      const parsed = Number(randomCount);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        setRandomError("分组数需为 1–100 的整数，或留空自动计算");
        return;
      }
      groupCount = parsed;
    }

    setRandomPending(true);
    setRandomError(null);
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.post(
        `/api/teacher/topics/${topicId}/groups/random`,
        groupCount ? { groupCount } : {},
      );
      setActionSuccess("已随机分组，未分组学生已尽量均匀分配");
      onChanged();
    } catch (err) {
      setRandomError(errorMessage(err, "随机分组失败，请稍后重试"));
    } finally {
      setRandomPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-brand-50/40 px-3 py-2.5 text-xs leading-5 text-ink-soft">
        <span className="font-semibold text-brand-800">共 {groups.length} 组</span>
        <span className="mx-1.5">·</span>
        已分组 {groupedCount} 人
        <span className="mx-1.5">·</span>
        未分组 {ungrouped.length} 人
        <span className="mx-1.5">·</span>
        每组 {groupMin}–{groupMax} 人
        {submitMode === "INDIVIDUAL" ? (
          <p className="mt-1 font-medium text-amber-700">
            当前是个人提交模式：分组会保存，但只有切换为「小组提交」后才影响提交与评价。
          </p>
        ) : null}
      </div>

      {canManage ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            aria-label="新小组名称"
            placeholder="新小组名称（可留空自动命名）"
            maxLength={40}
            autoComplete="off"
            value={createName}
            disabled={createPending}
            onChange={(event) => setCreateName(event.target.value)}
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={createPending}
            onClick={() => void handleCreate()}
          >
            {createPending ? "新建中…" : "新建小组"}
          </Button>
        </div>
      ) : null}
      <FormMessage error={createError ?? undefined} />

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-6 text-center text-sm text-ink-soft">
          还没有小组。
          {canManage ? "先新建小组，或使用下方「随机分组」一键分配未分组学生。" : "等待老师分组。"}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => {
            const full = group.members.length >= groupMax;
            const belowMin = group.members.length < groupMin;
            return (
              <li key={group.id} className="rounded-xl border border-line bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  {editingId === group.id ? (
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <Input
                          aria-label="小组名称"
                          value={editName}
                          maxLength={40}
                          autoComplete="off"
                          disabled={renamePending}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={renamePending}
                        onClick={() => void handleRename(group)}
                      >
                        {renamePending ? "保存中…" : "保存"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={renamePending}
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </Button>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-brand-900">
                        <span className="truncate">{group.name}</span>
                        {group.createdBy === "student" ? <Badge tone="info">学生自建</Badge> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        人数{" "}
                        <span
                          className={cn(
                            "font-semibold tabular-nums",
                            full ? "text-amber-700" : "text-brand-800",
                          )}
                        >
                          {group.members.length}/{groupMax}
                        </span>
                        {belowMin ? (
                          <span className="ml-1.5 font-medium text-amber-700">
                            低于最少 {groupMin} 人
                          </span>
                        ) : null}
                      </p>
                    </div>
                  )}

                  {canManage && editingId !== group.id ? (
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={deletingId !== null}
                        onClick={() => startRename(group)}
                      >
                        改名
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={deletingId === group.id}
                        onClick={() => void handleDelete(group)}
                      >
                        {deletingId === group.id ? "删除中…" : "删组"}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {editingId === group.id ? (
                  <FormMessage error={renameError ?? undefined} />
                ) : null}

                {group.members.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed border-line px-2 py-2 text-xs text-ink-soft">
                    小组还没有成员
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {group.members.map((member) => (
                      <li
                        key={member.id}
                        className="flex items-center gap-2 rounded-lg bg-brand-50/50 px-2 py-1"
                      >
                        <Avatar name={member.name} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm text-brand-900">
                          {member.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-soft">{member.loginId}</span>
                        {canManage ? (
                          <button
                            type="button"
                            aria-label={`把${member.name}移出小组`}
                            disabled={removingMemberId !== null}
                            className="grid size-6 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-red-50 hover:text-danger disabled:cursor-not-allowed"
                            onClick={() => void handleRemoveMember(group, member.id, member.name)}
                          >
                            <IconClose className="size-3.5" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                {canManage ? (
                  group.members.length >= groupMax ? (
                    <p className="mt-2 border-t border-line pt-2 text-[11px] text-ink-soft">
                      小组已满（最多 {groupMax} 人）
                    </p>
                  ) : ungrouped.length === 0 ? (
                    <p className="mt-2 border-t border-line pt-2 text-[11px] text-ink-soft">
                      没有未分组学生可加入
                    </p>
                  ) : (
                    <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
                      <Select
                        aria-label={`选择学生加入 ${group.name}`}
                        value={addSelection[group.id] ?? ""}
                        disabled={addingGroupId !== null}
                        onChange={(event) =>
                          setAddSelection((prev) => ({ ...prev, [group.id]: event.target.value }))
                        }
                      >
                        <option value="">选择未分组学生</option>
                        {ungrouped.map((student) => (
                          <option key={student.id} value={student.id}>
                            {student.name}（{student.loginId}）
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        disabled={!addSelection[group.id] || addingGroupId !== null}
                        onClick={() => void handleAddMember(group)}
                      >
                        {addingGroupId === group.id ? "加入中…" : "加入小组"}
                      </Button>
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-brand-900">未分组学生（{ungrouped.length}）</h3>
          {canManage && ungrouped.length > 0 ? (
            <span className="text-xs text-ink-soft">在小组卡片里选择学生加入</span>
          ) : null}
        </div>
        {ungrouped.length === 0 ? (
          <p className="mt-2 text-xs text-ink-soft">全部学生都已分组。</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {ungrouped.map((student) => (
              <li
                key={student.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-xs"
              >
                <span className="font-medium text-brand-900">{student.name}</span>
                <span className="text-ink-soft">{student.loginId}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage ? (
        <div className="border-t border-line pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="随机分组" htmlFor="random-group-count" hint="留空则按未分组人数与每组上限自动计算组数">
              <div className="w-32">
                <Input
                  id="random-group-count"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  placeholder="组数（可选）"
                  value={randomCount}
                  disabled={randomPending}
                  onChange={(event) => setRandomCount(event.target.value)}
                />
              </div>
            </Field>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mb-0.5"
              disabled={randomPending || ungrouped.length === 0}
              onClick={() => void handleRandom()}
            >
              {randomPending ? "分组中…" : "随机分组"}
            </Button>
          </div>
          <FormMessage error={randomError ?? undefined} />
        </div>
      ) : null}

      <FormMessage error={actionError ?? undefined} success={actionSuccess ?? undefined} />
    </div>
  );
}
