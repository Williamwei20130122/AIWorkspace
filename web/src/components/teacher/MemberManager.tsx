import { useState } from "react";
import type { FormEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { TopicDetail } from "@/lib/types";

const MAX_ASSISTANTS = 3;

/**
 * 课题成员管理：
 * - 助教（仅创建者可增删，最多 3 名）
 * - 学生（创建者与助教都可添加/移出；移出保留历史记录）
 */
export function MemberManager({
  topic,
  isOwner,
  onChanged,
}: {
  topic: TopicDetail;
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [assistantLoginId, setAssistantLoginId] = useState("");
  const [assistantPending, setAssistantPending] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantSuccess, setAssistantSuccess] = useState<string | null>(null);

  const [studentLoginId, setStudentLoginId] = useState("");
  const [studentPending, setStudentPending] = useState(false);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [studentSuccess, setStudentSuccess] = useState<string | null>(null);

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const activeStudents = topic.students.filter((student) => !student.removedAt);
  const removedStudents = topic.students.filter((student) => student.removedAt);
  const assistantFull = topic.assistants.length >= MAX_ASSISTANTS;

  async function handleAddAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assistantPending || !isOwner) return;

    const loginId = assistantLoginId.trim();
    if (!loginId) {
      setAssistantSuccess(null);
      setAssistantError("请填写助教的教师工号");
      return;
    }
    if (assistantFull) {
      setAssistantSuccess(null);
      setAssistantError(`助教最多 ${MAX_ASSISTANTS} 名，请先移除一位`);
      return;
    }

    setAssistantPending(true);
    setAssistantError(null);
    setAssistantSuccess(null);
    try {
      await api.post(`/api/teacher/topics/${topic.id}/assistants`, { loginId });
      setAssistantLoginId("");
      setAssistantSuccess("已添加助教");
      onChanged();
    } catch (err) {
      setAssistantError(errorMessage(err, "添加助教失败，请检查工号是否正确"));
    } finally {
      setAssistantPending(false);
    }
  }

  async function handleRemoveAssistant(teacherId: string, name: string) {
    if (removingId) return;
    if (!window.confirm(`确定移除助教「${name}」吗？移除后对方将不能管理本课题。`)) return;

    setRemovingId(teacherId);
    setRemoveError(null);
    try {
      await api.del(`/api/teacher/topics/${topic.id}/assistants/${teacherId}`);
      onChanged();
    } catch (err) {
      setRemoveError(errorMessage(err, "移除助教失败，请稍后重试"));
    } finally {
      setRemovingId(null);
    }
  }

  async function handleAddStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (studentPending) return;

    const loginId = studentLoginId.trim();
    if (!loginId) {
      setStudentSuccess(null);
      setStudentError("请填写学生学号");
      return;
    }

    setStudentPending(true);
    setStudentError(null);
    setStudentSuccess(null);
    try {
      await api.post(`/api/teacher/topics/${topic.id}/students`, { loginId });
      setStudentLoginId("");
      setStudentSuccess("已添加学生");
      onChanged();
    } catch (err) {
      setStudentError(errorMessage(err, "添加学生失败，请确认学号已存在"));
    } finally {
      setStudentPending(false);
    }
  }

  async function handleRemoveStudent(studentId: string, name: string) {
    if (removingId) return;
    const confirmed = window.confirm(
      `确定把「${name}」移出课题吗？历史提交与评价会保留，之后可以重新添加。`,
    );
    if (!confirmed) return;

    setRemovingId(studentId);
    setRemoveError(null);
    try {
      await api.del(`/api/teacher/topics/${topic.id}/students/${studentId}`);
      onChanged();
    } catch (err) {
      setRemoveError(errorMessage(err, "移出学生失败，请稍后重试"));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* 助教 */}
      <section aria-label="助教">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-brand-900">
            助教
            <span className="ml-1.5 text-xs font-normal text-ink-soft">
              {topic.assistants.length}/{MAX_ASSISTANTS}
            </span>
          </h3>
          {isOwner ? (
            <span className="text-xs text-ink-soft">助教可管理学生、评价提交</span>
          ) : (
            <Badge tone="neutral">仅创建者可管理</Badge>
          )}
        </div>

        {topic.assistants.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-line bg-white/60 px-3 py-3 text-xs text-ink-soft">
            还没有助教。{isOwner ? "输入教师工号即可邀请一位。" : "创建者还没有邀请助教。"}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {topic.assistants.map((assistant) => (
              <li
                key={assistant.id}
                className="flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2"
              >
                <Avatar name={assistant.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-900">{assistant.name}</p>
                  <p className="truncate text-xs text-ink-soft">工号 {assistant.loginId}</p>
                </div>
                {isOwner ? (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={removingId !== null}
                    onClick={() => void handleRemoveAssistant(assistant.id, assistant.name)}
                  >
                    {removingId === assistant.id ? "移除中…" : "移除"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {isOwner ? (
          <form onSubmit={handleAddAssistant} className="mt-3 space-y-2" noValidate>
            <Field label="添加助教" htmlFor="new-assistant-login" hint={`最多 ${MAX_ASSISTANTS} 名，输入教师的工号`}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="new-assistant-login"
                  name="loginId"
                  autoComplete="off"
                  maxLength={40}
                  placeholder="如：T002"
                  value={assistantLoginId}
                  disabled={assistantPending || assistantFull}
                  onChange={(event) => setAssistantLoginId(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  disabled={assistantPending || assistantFull}
                >
                  {assistantPending ? "添加中…" : "添加助教"}
                </Button>
              </div>
            </Field>
            {assistantFull ? (
              <p className="text-xs text-ink-soft">已达到 {MAX_ASSISTANTS} 名助教上限，移除后才能继续添加。</p>
            ) : null}
            <FormMessage error={assistantError ?? undefined} success={assistantSuccess ?? undefined} />
          </form>
        ) : null}
      </section>

      {/* 学生 */}
      <section aria-label="学生" className="border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-brand-900">
            学生
            <span className="ml-1.5 text-xs font-normal text-ink-soft">{activeStudents.length} 人在课题中</span>
          </h3>
          {removedStudents.length > 0 ? (
            <span className="text-xs text-ink-soft">另有 {removedStudents.length} 人已移出（保留历史）</span>
          ) : null}
        </div>

        {topic.students.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-line bg-white/60 px-3 py-3 text-xs text-ink-soft">
            还没有学生。添加学生后，对方即可在课题里提交内容；学生不能自行加入。
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {[...activeStudents, ...removedStudents].map((student) => {
              const removed = Boolean(student.removedAt);
              return (
                <li
                  key={student.id}
                  className="flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2"
                >
                  <Avatar name={student.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-brand-900">
                      {student.name}
                      {removed ? (
                        <Badge tone="neutral" className="ml-2">
                          已移出
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-ink-soft">
                      学号 {student.loginId}
                      {removed && student.removedAt ? ` · ${formatDate(student.removedAt)} 移出` : ""}
                    </p>
                  </div>
                  {removed ? (
                    <span className="shrink-0 text-[11px] text-ink-soft">历史成员</span>
                  ) : (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={removingId !== null}
                      onClick={() => void handleRemoveStudent(student.id, student.name)}
                    >
                      {removingId === student.id ? "移出中…" : "移出"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={handleAddStudent} className="mt-3 space-y-2" noValidate>
          <Field
            label="添加学生"
            htmlFor="new-member-login"
            hint="输入学生学号；已移出的学生会自动恢复"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="new-member-login"
                name="loginId"
                autoComplete="off"
                maxLength={40}
                placeholder="如：S001"
                value={studentLoginId}
                disabled={studentPending}
                onChange={(event) => setStudentLoginId(event.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="shrink-0"
                disabled={studentPending}
              >
                {studentPending ? "添加中…" : "添加学生"}
              </Button>
            </div>
          </Field>
          <FormMessage error={studentError ?? undefined} success={studentSuccess ?? undefined} />
        </form>
        <FormMessage error={removeError ?? undefined} />
      </section>
    </div>
  );
}
