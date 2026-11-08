/** 纯展示用的格式化工具（客户端/服务端通用，不依赖任何 Node API） */

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const dateFmt = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFmt = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt.format(d);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateTimeFmt.format(d);
}

/** 把 datetime-local input 的字符串（"2026-11-20T18:00"）转成 Date；空值返回 null */
export function parseDateTimeLocal(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type DueTone = "normal" | "soon" | "overdue";

export function dueLabel(dueAt: Date | string | null | undefined): {
  text: string;
  tone: DueTone;
} {
  if (!dueAt) return { text: "无截止时间", tone: "normal" };
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(d.getTime())) return { text: "无截止时间", tone: "normal" };
  const diff = d.getTime() - Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (diff < 0) return { text: `已截止 · ${formatDateTime(d)}`, tone: "overdue" };
  if (diff < day) return { text: `今天截止 · ${formatDateTime(d)}`, tone: "soon" };
  if (diff < 3 * day) return { text: `还剩 ${Math.ceil(diff / day)} 天 · ${formatDateTime(d)}`, tone: "soon" };
  return { text: `截止 ${formatDateTime(d)}`, tone: "normal" };
}

/** 得分百分比（0-100，取整）；无分数返回 null */
export function scorePercent(score: number | null | undefined, points: number): number | null {
  if (score === null || score === undefined || points <= 0) return null;
  return Math.round((score / points) * 100);
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // 中文取最后一个字更符合习惯，英文取首字母
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed.slice(-1);
  return trimmed.slice(0, 1).toUpperCase();
}

export function roleHome(role: string): string {
  return role === "TEACHER" || role === "ADMIN" ? "/teacher" : "/student";
}
