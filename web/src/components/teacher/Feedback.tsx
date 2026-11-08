import { Button } from "@/components/ui/button";
import { IconClock } from "@/components/ui/icons";

/** 页面级加载占位：与卡片同一套边框/底色，不引入动画库 */
export function LoadingState({ label = "加载中…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-white/70 px-6 py-12 text-sm text-ink-soft"
    >
      <IconClock className="size-4 animate-pulse" />
      {label}
    </div>
  );
}

/** 页面级错误提示：说明发生了什么 + 提供重试 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center"
    >
      <div>
        <p className="text-sm font-semibold text-red-800">加载失败</p>
        <p className="mt-1 max-w-md text-sm leading-6 text-red-700">{message}</p>
      </div>
      {onRetry ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          重新加载
        </Button>
      ) : null}
    </div>
  );
}
