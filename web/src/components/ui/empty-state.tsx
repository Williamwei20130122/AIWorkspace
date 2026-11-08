import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
      {icon ? <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">{icon}</span> : null}
      <div>
        <p className="text-sm font-semibold text-brand-900">{title}</p>
        {description ? <p className="mt-1 text-sm text-ink-soft">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
