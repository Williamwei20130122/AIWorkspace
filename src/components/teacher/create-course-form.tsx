"use client";

import { useActionState } from "react";
import { createCourseAction } from "@/app/actions/teacher";
import { initialActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";

/** 班级详情页内新建课程：classId 用隐藏字段提交 */
export function CreateCourseForm({ classId }: { classId: string }) {
  const [state, formAction, pending] = useActionState(createCourseAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="classId" value={classId} />
      <Field label="课程名称" htmlFor="new-course-title">
        <Input
          id="new-course-title"
          name="title"
          required
          maxLength={60}
          autoComplete="off"
          placeholder="如：数学"
        />
      </Field>
      <Field label="课程简介" htmlFor="new-course-description" hint="可选，一句话说明这门课">
        <Textarea
          id="new-course-description"
          name="description"
          maxLength={500}
          placeholder="如：每周三节，围绕函数与几何展开。"
        />
      </Field>
      <FormMessage error={state.error} success={state.success} />
      <Button type="submit" variant="secondary" disabled={pending} className="w-full">
        {pending ? "创建中…" : "新建课程"}
      </Button>
    </form>
  );
}
