"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie, setSessionCookie, verifyPassword } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { ROLES } from "@/lib/roles";

const loginSchema = z.object({
  email: z.string().trim().min(1, "请输入邮箱").email("邮箱格式不正确"),
  password: z.string().min(1, "请输入密码"),
});

/** 登录：成功跳转到对应角色首页，失败返回错误文案 */
export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入有误" };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return { error: "邮箱或密码不正确" };
  }

  await setSessionCookie(user.id);
  redirect(user.role === ROLES.STUDENT ? "/student" : "/teacher");
}

/** 退出登录 */
export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
