import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";

type CourseOption = { id: string; title: string };

/** 发布作业：POST /api/teacher/assignments，成功后由页面跳转到作业详情 */
export function CreateAssignmentForm({
  courses,
  onCreated,
}: {
  courses: CourseOption[];
  onCreated: (assignmentId: string) => void;
}) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [points, setPoints] = useState("100");
  const [dueAt, setDueAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 课程列表刷新后（例如刚新建课程）保持下拉选项有效
  useEffect(() => {
    if (!courses.some((course) => course.id === courseId)) {
      setCourseId(courses[0]?.id ?? "");
    }
  }, [courses, courseId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedTitle = title.trim();
    const numericPoints = Number(points);
    if (!courseId) {
      setSuccess(null);
      setError("请先选择所属课程");
      return;
    }
    if (!trimmedTitle) {
      setSuccess(null);
      setError("请填写作业标题");
      return;
    }
    if (!Number.isFinite(numericPoints) || numericPoints <= 0 || numericPoints > 1000) {
      setSuccess(null);
      setError("分值需为 1 到 1000 之间的数字");
      return;
    }

    let dueIso: string | undefined;
    if (dueAt.trim()) {
      const parsed = new Date(dueAt);
      if (Number.isNaN(parsed.getTime())) {
        setSuccess(null);
        setError("截止时间格式不正确，请重新选择");
        return;
      }
      dueIso = parsed.toISOString();
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await api.post<{ id: string }>("/api/teacher/assignments", {
        courseId,
        title: trimmedTitle,
        points: Math.round(numericPoints),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(dueIso ? { dueAt: dueIso } : {}),
      });
      setSuccess(`作业「${trimmedTitle}」已发布`);
      setTitle("");
      setDescription("");
      setPoints("100");
      setDueAt("");
      onCreated(created.id);
    } catch (err) {
      setError(errorMessage(err, "发布作业失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  if (courses.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-brand-50/50 px-4 py-3 text-sm leading-relaxed text-ink-soft">
        本班还没有课程，先在上面新建一门课程，就可以发布作业了。
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label="所属课程" htmlFor="new-assignment-course">
        <Select
          id="new-assignment-course"
          name="courseId"
          required
          value={courseId}
          disabled={pending}
          onChange={(event) => setCourseId(event.target.value)}
        >
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="作业标题" htmlFor="new-assignment-title">
        <Input
          id="new-assignment-title"
          name="title"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="如：第三单元练习"
          value={title}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="作业要求" htmlFor="new-assignment-description" hint="可选，学生提交时会看到">
        <Textarea
          id="new-assignment-description"
          name="description"
          maxLength={2000}
          placeholder="说明题目范围、提交格式与注意事项…"
          value={description}
          disabled={pending}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="分值" htmlFor="new-assignment-points">
          <Input
            id="new-assignment-points"
            name="points"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            required
            value={points}
            disabled={pending}
            onChange={(event) => setPoints(event.target.value)}
          />
        </Field>
        <Field label="截止时间" htmlFor="new-assignment-due" hint="可选">
          <Input
            id="new-assignment-due"
            name="dueAt"
            type="datetime-local"
            value={dueAt}
            disabled={pending}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </Field>
      </div>
      <FormMessage error={error ?? undefined} success={success ?? undefined} />
      <Button type="submit" variant="accent" disabled={pending} className="w-full">
        {pending ? "发布中…" : "发布作业"}
      </Button>
    </form>
  );
}
