"use client";

import { useActionState } from "react";
import { createClassAction } from "@/app/actions/teacher";
import { initialActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

/** 新建班级：成功后 action 内部 redirect 到班级详情页 */
export function CreateClassForm() {
  const [state, formAction, pending] = useActionState(createClassAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      <Field label="班级名称" htmlFor="new-class-name" hint="学生会看到的班级名称，如「高一（3）班」">
        <Input
          id="new-class-name"
          name="name"
          required
          maxLength={40}
          autoComplete="off"
          placeholder="高一（3）班"
        />
      </Field>
      <Field label="年级" htmlFor="new-class-grade" hint="可选，方便区分不同年级">
        <Input id="new-class-grade" name="grade" maxLength={20} autoComplete="off" placeholder="高一" />
      </Field>
      <FormMessage error={state.error} success={state.success} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "创建中…" : "创建班级"}
      </Button>
      <p className="text-[11px] leading-relaxed text-ink-soft">
        创建后会自动生成 6 位邀请码，并把学生加入的入口放在班级详情页。
      </p>
    </form>
  );
}
