import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import type { Dimension } from "@/lib/types";

function parseMaxScore(value: string): number | null {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 10000) return null;
  return num;
}

/** 课题评价维度管理：增 / 改 / 删（POST/PATCH/DELETE /api/teacher/topics/:id/dimensions） */
export function DimensionManager({
  topicId,
  dimensions,
  onChanged,
}: {
  topicId: string;
  dimensions: Dimension[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [maxScore, setMaxScore] = useState("100");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMaxScore, setEditMaxScore] = useState("100");
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmed = name.trim();
    const parsed = parseMaxScore(maxScore);
    if (!trimmed) {
      setSuccess(null);
      setError("请填写维度名称");
      return;
    }
    if (parsed === null) {
      setSuccess(null);
      setError("满分需为 1–10000 的整数");
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/api/teacher/topics/${topicId}/dimensions`, { name: trimmed, maxScore: parsed });
      setName("");
      setMaxScore("100");
      setSuccess(`已添加维度「${trimmed}」`);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "添加维度失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  function startEdit(dimension: Dimension) {
    setEditingId(dimension.id);
    setEditName(dimension.name);
    setEditMaxScore(String(dimension.maxScore));
    setEditError(null);
    setError(null);
    setSuccess(null);
  }

  async function handleUpdate(dimensionId: string) {
    if (editPending) return;

    const trimmed = editName.trim();
    const parsed = parseMaxScore(editMaxScore);
    if (!trimmed) {
      setEditError("请填写维度名称");
      return;
    }
    if (parsed === null) {
      setEditError("满分需为 1–10000 的整数");
      return;
    }

    setEditPending(true);
    setEditError(null);
    try {
      await api.patch(`/api/teacher/topics/${topicId}/dimensions/${dimensionId}`, {
        name: trimmed,
        maxScore: parsed,
      });
      setEditingId(null);
      setSuccess("维度已更新");
      onChanged();
    } catch (err) {
      setEditError(errorMessage(err, "更新维度失败，请稍后重试"));
    } finally {
      setEditPending(false);
    }
  }

  async function handleDelete(dimension: Dimension) {
    if (deletingId) return;
    const confirmed = window.confirm(`确定删除维度「${dimension.name}」吗？之后评价不能再给这个维度打分。`);
    if (!confirmed) return;

    setDeletingId(dimension.id);
    setDeleteError(null);
    setSuccess(null);
    try {
      await api.del(`/api/teacher/topics/${topicId}/dimensions/${dimension.id}`);
      setSuccess(`已删除维度「${dimension.name}」`);
      onChanged();
    } catch (err) {
      setDeleteError(errorMessage(err, "删除维度失败，请稍后重试"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {dimensions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-6 text-center text-sm text-ink-soft">
          还没有评价维度。先添加至少一个维度，评价时才能按维度打分。
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {dimensions.map((dimension) => (
            <li key={dimension.id} className="py-2.5 first:pt-0 last:pb-0">
              {editingId === dimension.id ? (
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                    <Input
                      aria-label="维度名称"
                      value={editName}
                      maxLength={40}
                      disabled={editPending}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                    <Input
                      aria-label="满分"
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      value={editMaxScore}
                      disabled={editPending}
                      onChange={(event) => setEditMaxScore(event.target.value)}
                    />
                  </div>
                  <FormMessage error={editError ?? undefined} />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={editPending}
                      onClick={() => void handleUpdate(dimension.id)}
                    >
                      {editPending ? "保存中…" : "保存"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={editPending}
                      onClick={() => setEditingId(null)}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-brand-900">{dimension.name}</span>
                    <span className="text-xs text-ink-soft">满分 {dimension.maxScore}</span>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => startEdit(dimension)}
                      disabled={deletingId !== null || editPending}
                    >
                      编辑
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => void handleDelete(dimension)}
                      disabled={deletingId === dimension.id || editPending}
                    >
                      {deletingId === dimension.id ? "删除中…" : "删除"}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <FormMessage error={deleteError ?? undefined} />

      <form onSubmit={handleCreate} className="space-y-3 border-t border-line pt-4" noValidate>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
          <Field label="维度名称" htmlFor="new-dimension-name">
            <Input
              id="new-dimension-name"
              name="name"
              maxLength={40}
              autoComplete="off"
              placeholder="如：数据完整性"
              value={name}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="满分" htmlFor="new-dimension-max" hint="建议 100">
            <Input
              id="new-dimension-max"
              name="maxScore"
              type="number"
              min={1}
              max={10000}
              step={1}
              value={maxScore}
              disabled={pending}
              onChange={(event) => setMaxScore(event.target.value)}
            />
          </Field>
        </div>
        <FormMessage error={error ?? undefined} success={success ?? undefined} />
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "添加中…" : "添加维度"}
        </Button>
      </form>
    </div>
  );
}
