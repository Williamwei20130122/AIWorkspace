"use client";

import { useActionState } from "react";
import { createAssignmentAction } from "@/app/actions/teacher";
import { initialActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";

type CourseOption = { id: string; title: string };

/** 发布作业：课程下拉 + 标题/要求/分值/截止时间；成功后 action 内部 redirect 到作业详情 */
export function CreateAssignmentForm({ courses }: { courses: CourseOption[] }) {
  const [state, formAction, pending] = useActionState(createAssignmentAction, initialActionState);

  if (courses.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-brand-50/50 px-4 py-3 text-sm text-ink-soft">
        本班还没有课程，先在上面新建一门课程，就可以发布作业了。
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label="所属课程" htmlFor="new-assignment-course">
        <Select id="new-assignment-course" name="courseId" required defaultValue={courses[0]?.id}>
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
        />
      </Field>
      <Field label="作业要求" htmlFor="new-assignment-description" hint="可选，学生提交时会看到">
        <Textarea
          id="new-assignment-description"
          name="description"
          maxLength={2000}
          placeholder="说明题目范围、提交格式与注意事项…"
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
            defaultValue={100}
          />
        </Field>
        <Field label="截止时间" htmlFor="new-assignment-due" hint="可选">
          <Input id="new-assignment-due" name="dueAt" type="datetime-local" />
        </Field>
      </div>
      <FormMessage error={state.error} success={state.success} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "发布中…" : "发布作业"}
      </Button>
    </form>
  );
}
