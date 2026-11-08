"use client";

import { useActionState } from "react";
import { createAnnouncementAction } from "@/app/actions/teacher";
import { initialActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Textarea } from "@/components/ui/form";

/** 班级详情页发布公告：classId 用隐藏字段提交 */
export function CreateAnnouncementForm({ classId }: { classId: string }) {
  const [state, formAction, pending] = useActionState(createAnnouncementAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="classId" value={classId} />
      <Field label="公告标题" htmlFor="new-announcement-title">
        <Input
          id="new-announcement-title"
          name="title"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="如：本周五期中测验安排"
        />
      </Field>
      <Field label="公告内容" htmlFor="new-announcement-content">
        <Textarea
          id="new-announcement-content"
          name="content"
          required
          maxLength={2000}
          placeholder="写清楚时间、地点与需要准备的内容…"
        />
      </Field>
      <FormMessage error={state.error} success={state.success} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "发布中…" : "发布公告"}
      </Button>
    </form>
  );
}
