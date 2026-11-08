import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/api";
import type { ClassDetail, TeacherClass } from "@/lib/types";

type CreatedTopic = { id: string };

/**
 * 新建课题（v4）：选择班级 → 勾选该班参与学生（默认全选）→ 创建。
 * POST /api/teacher/topics {title, descriptionMd?, classId, studentIds}
 */
export function CreateTopicForm({
  onCreated,
  initialClassId,
}: {
  onCreated: (topicId: string) => void;
  initialClassId?: string;
}) {
  const [title, setTitle] = useState("");
  const [descriptionMd, setDescriptionMd] = useState("");

  const [classes, setClasses] = useState<TeacherClass[] | null>(null);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [classId, setClassId] = useState(initialClassId ?? "");

  const [classData, setClassData] = useState<ClassDetail | null>(null);
  const [classLoading, setClassLoading] = useState(false);
  const [classError, setClassError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 加载「我的班级」，未指定初始班级时默认选中第一个
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.get<TeacherClass[]>("/api/teacher/classes");
        if (cancelled) return;
        setClasses(list);
        setClassId((prev) => prev || list[0]?.id || "");
      } catch (err) {
        if (cancelled) return;
        setClasses([]);
        setClassesError(errorMessage(err, "班级列表加载失败，请稍后重试"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 选择班级后加载该班学生，默认全选
  useEffect(() => {
    if (!classId) {
      setClassData(null);
      setSelected([]);
      return;
    }
    let cancelled = false;
    setClassLoading(true);
    setClassError(null);
    void (async () => {
      try {
        const detail = await api.get<ClassDetail>(`/api/teacher/classes/${classId}`);
        if (cancelled) return;
        setClassData(detail);
        setSelected(detail.students.filter((student) => !student.removedAt).map((student) => student.id));
      } catch (err) {
        if (cancelled) return;
        setClassData(null);
        setSelected([]);
        setClassError(errorMessage(err, "班级学生加载失败，请重试"));
      } finally {
        if (!cancelled) setClassLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId]);

  const activeStudents = classData?.students.filter((student) => !student.removedAt) ?? [];

  function toggleStudent(studentId: string) {
    setSelected((prev) =>
      prev.includes(studentId) ? prev.filter((item) => item !== studentId) : [...prev, studentId],
    );
  }

  function selectAll() {
    setSelected(activeStudents.map((student) => student.id));
  }

  function clearSelection() {
    setSelected([]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setSuccess(null);
      setError("请填写课题标题");
      return;
    }
    if (!classId) {
      setSuccess(null);
      setError("请选择课题所属班级");
      return;
    }
    if (classLoading) {
      setSuccess(null);
      setError("正在加载班级学生，请稍候");
      return;
    }
    // 后端把空数组视为「班级全部有效学生」，这里显式拦截，避免和界面勾选状态不一致
    if (activeStudents.length > 0 && selected.length === 0) {
      setSuccess(null);
      setError("请至少勾选一名参与学生；如果不勾选，后端会按班级全部学生处理");
      return;
    }

    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await api.post<CreatedTopic>("/api/teacher/topics", {
        title: trimmedTitle,
        ...(descriptionMd.trim() ? { descriptionMd } : {}),
        classId,
        studentIds: selected,
      });
      setTitle("");
      setDescriptionMd("");
      setSuccess("课题创建成功，正在进入详情…");
      onCreated(created.id);
    } catch (err) {
      setError(errorMessage(err, "创建课题失败，请稍后重试"));
    } finally {
      setPending(false);
    }
  }

  const noClasses = classes !== null && classes.length === 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label="课题标题" htmlFor="new-topic-title" hint="学生会在课题列表里看到这个标题">
        <Input
          id="new-topic-title"
          name="title"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="校园气象站数据记录"
          value={title}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>

      <Field label="所属班级" htmlFor="new-topic-class" hint="课题必须属于一个班级，参与学生从该班勾选">
        {classes === null ? (
          <p className="text-sm text-ink-soft">正在加载班级…</p>
        ) : (
          <Select
            id="new-topic-class"
            name="classId"
            required
            value={classId}
            disabled={pending || noClasses}
            onChange={(event) => setClassId(event.target.value)}
          >
            <option value="">请选择班级</option>
            {classes.map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
                {klass.grade ? `（${klass.grade}）` : ""}
              </option>
            ))}
          </Select>
        )}
        {classesError ? <FormMessage error={classesError} /> : null}
        {noClasses && !classesError ? (
          <p className="mt-1 text-xs text-ink-soft">
            还没有班级，先
            <Link to="/teacher/classes" className="mx-1 font-semibold text-brand-600 hover:text-brand-700">
              去创建班级
            </Link>
            并添加学生。
          </p>
        ) : null}
      </Field>

      {classId ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink-soft">
              参与学生（{selected.length}/{activeStudents.length}）
            </span>
            {activeStudents.length > 0 ? (
              <span className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  className="font-medium text-brand-600 hover:text-brand-700"
                  onClick={selectAll}
                  disabled={pending}
                >
                  全选
                </button>
                <button
                  type="button"
                  className="font-medium text-ink-soft hover:text-brand-700"
                  onClick={clearSelection}
                  disabled={pending}
                >
                  全不选
                </button>
              </span>
            ) : null}
          </div>

          {classLoading ? (
            <p className="rounded-xl border border-line bg-white px-3 py-4 text-sm text-ink-soft">
              正在加载班级学生…
            </p>
          ) : classError ? (
            <FormMessage error={classError} />
          ) : activeStudents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-white/60 px-3 py-4 text-sm text-ink-soft">
              该班还没有学生。可以先到班级详情里添加学生，或先创建空课题稍后再加人。
            </p>
          ) : (
            <ul className="aw-scroll grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-line bg-white p-2 sm:grid-cols-2">
              {activeStudents.map((student) => {
                const checked = selected.includes(student.id);
                return (
                  <li key={student.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-brand-50">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-brand-600"
                        checked={checked}
                        disabled={pending}
                        onChange={() => toggleStudent(student.id)}
                      />
                      <span className="min-w-0 flex-1 truncate text-brand-900">{student.name}</span>
                      <span className="shrink-0 text-xs text-ink-soft">{student.loginId}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-1 text-xs text-ink-soft">默认全选；取消勾选的学生不会加入该课题，之后仍可在课题详情里增删。</p>
        </div>
      ) : null}

      <Field
        label="课题介绍（可选）"
        htmlFor="new-topic-description"
        hint="支持 Markdown，创建后还能在详情页继续编辑"
      >
        <Textarea
          id="new-topic-description"
          name="descriptionMd"
          rows={4}
          className="min-h-20"
          placeholder="用一两段话说明课题目标、要提交什么…"
          value={descriptionMd}
          disabled={pending}
          onChange={(event) => setDescriptionMd(event.target.value)}
        />
      </Field>

      <FormMessage error={error ?? undefined} success={success ?? undefined} />

      <Button type="submit" variant="accent" disabled={pending || noClasses} className="w-full">
        {pending ? "创建中…" : "创建课题"}
      </Button>
      <p className="text-[11px] leading-relaxed text-ink-soft">
        创建后你可以在详情页添加助教、调整成员、配置评价维度与分组。
      </p>
    </form>
  );
}
