import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "brand",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "brand" | "accent" | "success" | "warning" | "neutral";
}) {
  const toneClass: Record<string, string> = {
    brand: "bg-brand-50 text-brand-700 border-brand-200",
    accent: "bg-amber-50 text-amber-700 border-amber-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-orange-50 text-orange-700 border-orange-200",
    neutral: "bg-muted text-ink-soft border-line",
  };

  return (
    <div className="aw-card flex items-start gap-3 p-4">
      {icon ? (
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border", toneClass[tone])}>
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-xs font-medium text-ink-soft">{label}</p>
        <p className="mt-1 text-2xl font-semibold leading-none tracking-tight text-brand-900">{value}</p>
        {hint ? <p className="mt-2 text-xs text-ink-soft">{hint}</p> : null}
      </div>
    </div>
  );
}
