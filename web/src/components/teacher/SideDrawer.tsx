import { useEffect, useId } from "react";
import type { ReactNode } from "react";
import { IconClose } from "@/components/ui/icons";

/** 右侧抽屉：新建班级 / 新建课题等表单用，桌面右侧滑出、移动端全宽 */
export function SideDrawer({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="关闭面板"
        className="absolute inset-0 bg-brand-900/40"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-white"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-brand-900">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-xs leading-5 text-ink-soft">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="关闭面板"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-800"
            onClick={onClose}
          >
            <IconClose className="size-5" />
          </button>
        </div>
        <div className="aw-scroll flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}
