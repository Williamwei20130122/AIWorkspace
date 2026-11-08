import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Textarea } from "@/components/ui/form";
import { MarkdownView } from "@/components/teacher/markdown";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";

type EditorTab = "edit" | "preview";

/**
 * 课题介绍页：Markdown 编辑 + 预览，保存走 PATCH /api/teacher/topics/:id。
 * 仅创建者可编辑；助教只看预览。
 */
export function MarkdownEditor({
  topicId,
  value,
  canEdit,
  onSaved,
}: {
  topicId: string;
  value: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [tab, setTab] = useState<EditorTab>("edit");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function startEditing() {
    setDraft(value);
    setTab("edit");
    setError(null);
    setSuccess(null);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(value);
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    if (pending) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await api.patch(`/api/teacher/topics/${topicId}`, { descriptionMd: draft });
      setEditing(false);
      setSuccess("介绍页已保存");
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "保存介绍页失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        {value.trim() ? (
          <div className="rounded-xl border border-line bg-brand-50/40 p-4">
            <MarkdownView markdown={value} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-brand-900">还没有介绍页内容</p>
            <p className="mt-1 text-sm text-ink-soft">
              {canEdit ? "撰写课题介绍，学生打开课题时就能看到。" : "创建者还没有填写课题介绍。"}
            </p>
          </div>
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <span className="text-xs text-ink-soft">介绍页支持 Markdown，保存后立即对学生可见。</span>
            <Button type="button" variant="secondary" size="sm" onClick={startEditing}>
              编辑介绍
            </Button>
          </div>
        ) : null}
        <FormMessage error={error ?? undefined} success={success ?? undefined} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-line bg-white p-0.5 md:hidden">
          {(
            [
              { key: "edit", label: "编辑" },
              { key: "preview", label: "预览" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                tab === item.key ? "bg-brand-50 text-brand-700" : "text-ink-soft hover:text-brand-700",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="hidden text-xs text-ink-soft md:inline">左侧编辑，右侧实时预览（支持 Markdown）</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Textarea
          aria-label="介绍页 Markdown 内容"
          className={cn(
            "min-h-64 resize-y font-mono text-[13px] leading-5",
            tab === "edit" ? "" : "hidden md:block",
          )}
          placeholder={"## 课题目标\n\n- 记录每天的气温与降水\n- 用图表分析一周数据"}
          value={draft}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div
          className={cn(
            "min-h-64 overflow-x-auto rounded-xl border border-line bg-brand-50/40 p-3",
            tab === "preview" ? "" : "hidden md:block",
          )}
        >
          {draft.trim() ? (
            <MarkdownView markdown={draft} />
          ) : (
            <p className="text-sm text-ink-soft">预览区：输入内容后这里会显示渲染效果。</p>
          )}
        </div>
      </div>

      <FormMessage error={error ?? undefined} success={success ?? undefined} />

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={pending}>
          {pending ? "保存中…" : "保存介绍页"}
        </Button>
        <Button type="button" variant="secondary" onClick={cancelEditing} disabled={pending}>
          取消
        </Button>
      </div>
    </div>
  );
}
