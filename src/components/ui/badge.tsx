import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export type BadgeTone = "brand" | "success" | "warning" | "danger" | "neutral" | "info";

const TONE_CLASS: Record<BadgeTone, string> = {
  brand: "aw-badge-brand",
  success: "aw-badge-success",
  warning: "aw-badge-warning",
  danger: "aw-badge-danger",
  neutral: "aw-badge-neutral",
  info: "aw-badge-info",
};

export function Badge({
  children,
  tone = "brand",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return <span className={cn("aw-badge", TONE_CLASS[tone], className)}>{children}</span>;
}
