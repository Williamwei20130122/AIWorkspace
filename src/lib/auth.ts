import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { type Role, ROLES } from "@/lib/roles";

export const SESSION_COOKIE = "aw_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarColor: string;
};

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret === "change-me-to-a-long-random-string") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET 未配置：生产环境必须设置强随机密钥");
    }
    return "aiworkspace-dev-secret-do-not-use-in-production";
  }
  return secret;
}

function signPayload(payload: string): string {
  return crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, iat: Date.now() }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signPayload(payload)}`;
}

export function verifySessionToken(token: string): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = signPayload(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
    };
    return typeof data.sub === "string" ? data.sub : null;
  } catch {
    return null;
  }
}

/** scrypt 口令哈希，格式：scrypt$<salt>$<hash> */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = verifySessionToken(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, avatarColor: true },
  });
  if (!user) return null;
  return { ...user, role: user.role as Role };
}

/** 页面/布局里取当前用户，未登录直接跳登录页 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** 要求指定角色，角色不符跳到自己角色的首页 */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== role) {
    redirect(user.role === ROLES.TEACHER ? "/teacher" : "/student");
  }
  return user;
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
