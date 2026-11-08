import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { formatFileSize } from "@/components/student/files";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Textarea } from "@/components/ui/form";
import { IconFile } from "@/components/ui/icons";
import { api, errorMessage } from "@/lib/api";
import type { StudentTopicDetail } from "@/lib/types";

const MAX_FILES = 10;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

type MySubmission = StudentTopicDetail["mySubmission"];

/**
 * 课题提交 / 重新提交表单。
 *
 * - 文本内容原样提交（后端按纯文本展示，不渲染 Markdown/LaTeX）。
 * - 附件任意类型、可多选；提交用 FormData（api.upload 不手动设置 Content-Type）。
 * - 重新提交会覆盖当前文本与全部附件，因此表单明确提示。
 */
export function SubmitForm({
  topicId,
  closed,
  evaluated,
  blockedReason,
  groupMode = false,
  submission,
  onSubmitted,
}: {
  topicId: string;
  closed: boolean;
  evaluated: boolean;
  /** GROUP 模式下未分组/人数不足等提交前置条件未满足时的提示 */
  blockedReason?: string | null;
  groupMode?: boolean;
  submission: MySubmission;
  onSubmitted?: () => void;
}) {
  const [text, setText] = useState(() => submission?.textContent ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 提交成功、页面刷新后，用服务端最新文本同步表单（附件已被覆盖，保持为空等待重新选择）
  useEffect(() => {
    setText(submission?.textContent ?? "");
  }, [submission?.updatedAt]);

  const updateFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    const merged = [...files];
    for (const file of picked) {
      const duplicated = merged.some(
        (item) =>
          item.name === file.name && item.size === file.size && item.lastModified === file.lastModified,
      );
      if (!duplicated) merged.push(file);
    }
    if (merged.length > MAX_FILES) {
      setError(`最多上传 ${MAX_FILES} 个附件，请先移除多余文件。`);
      setSuccess(null);
      return;
    }
    const oversized = merged.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) {
      setError(`附件「${oversized.name}」超过 100MB，请压缩后再上传。`);
      setSuccess(null);
      return;
    }
    setFiles(merged);
    setError(null);
  };

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const picked = Array.from(input.files ?? []);
    input.value = "";
    updateFiles(picked);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || closed) return;

    if (text.trim() === "" && files.length === 0) {
      setError("请填写文本内容或选择附件后再提交。");
      setSuccess(null);
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const formData = new FormData();
      formData.append("textContent", text);
      for (const file of files) formData.append("files", file);

      await api.upload<{ ok: boolean }>(`/api/student/topics/${topicId}/submission`, formData);

      setSuccess(
        groupMode
          ? submission
            ? "小组重新提交成功：文本与附件已覆盖，组员都会看到最新内容。"
            : "小组提交成功，组员都能看到本次提交。"
          : submission
            ? "重新提交成功：文本与附件已覆盖，老师会看到最新内容。"
            : "提交成功，老师评价后会显示在这里。",
      );
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSubmitted?.();
    } catch (err) {
      setError(errorMessage(err, "提交失败，请检查网络后重试。"));
    } finally {
      setPending(false);
    }
  }

  if (evaluated) {
    return (
      <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm leading-relaxed text-brand-800">
        老师已评价，不能重新提交。你可以在「我的提交」和「我的评价」里查看提交内容与评价详情。
      </p>
    );
  }

  if (closed) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-800">
        该课题已关闭，不能再提交或修改内容。你仍然可以查看课题介绍、历史提交与评价。
      </p>
    );
  }

  if (blockedReason) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-800">
        {blockedReason}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {submission ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          {groupMode
            ? "你所在小组已提交过。重新提交会覆盖小组当前的文本内容与全部附件（组员都会看到最新内容）。"
            : "你已提交过。重新提交会覆盖当前的文本内容与全部附件（原附件不会保留，请重新选择需要保留的文件）。"}
        </p>
      ) : null}

      <Field
        label="文本内容"
        htmlFor="submission-text"
        hint="按纯文本展示给老师，不渲染 Markdown 或公式。"
      >
        <Textarea
          id="submission-text"
          name="textContent"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="在这里输入你的提交内容…"
          disabled={pending}
          className="min-h-40"
        />
      </Field>
      <p className="text-xs text-ink-soft">共 {text.length} 字</p>

      <Field
        label="附件"
        htmlFor="submission-files"
        hint={`任意类型文件，单个不超过 100MB，最多 ${MAX_FILES} 个。`}
      >
        <input
          id="submission-files"
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          disabled={pending}
          className="block w-full cursor-pointer rounded-xl border border-dashed border-line bg-brand-50/40 px-3 py-2.5 text-sm text-ink-soft transition-colors file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:border-brand-300 disabled:cursor-not-allowed"
        />
      </Field>

      {files.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-soft">
            已选择 {files.length} / {MAX_FILES} 个附件
          </p>
          <ul className="space-y-1.5">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <IconFile className="size-4 shrink-0 text-brand-600" />
                  <span className="truncate font-medium text-brand-900">{file.name}</span>
                  <span className="shrink-0 text-xs text-ink-soft">{formatFileSize(file.size)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  disabled={pending}
                  aria-label={`移除附件 ${file.name}`}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <FormMessage error={error ?? undefined} success={success ?? undefined} />

      <Button type="submit" variant="accent" className="w-full" disabled={pending}>
        {pending ? "提交中…" : submission ? "重新提交" : "提交"}
      </Button>
      <p className="text-xs leading-relaxed text-ink-soft">
        {groupMode
          ? "本次提交归你所在的小组所有，组员都能查看并重新提交。"
          : "提交后仍可随时重新提交，老师会看到最新一次提交。"}
      </p>
    </form>
  );
}
