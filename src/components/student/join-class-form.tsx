"use client";

import { useActionState } from "react";
import { joinClassAction } from "@/app/actions/student";
import { initialActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";

/** 学生用 6 位邀请码加入班级 */
export function JoinClassForm() {
  const [state, formAction, pending] = useActionState(joinClassAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <Field label="班级邀请码" htmlFor="joinCode" hint="由任课教师提供，6 位字母或数字">
        <Input
          id="joinCode"
          name="joinCode"
          placeholder="例如 MATH01"
          required
          maxLength={6}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="uppercase tracking-[0.35em]"
        />
      </Field>
      <FormMessage error={state.error} success={state.success} />
      <Button type="submit" variant="accent" disabled={pending} className="w-full">
        {pending ? "加入中…" : "加入班级"}
      </Button>
    </form>
  );
}
