import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** 数据加载中的占位卡片（学生端页面统一使用） */
export function LoadingCard({ label = "正在加载…" }: { label?: string }) {
  return (
    <Card className="p-6" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-ink-soft">
        <span
          className="size-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"
          aria-hidden="true"
        />
        {label}
      </div>
    </Card>
  );
}

/** 数据加载失败时展示错误文案 + 重试 */
export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-900">加载失败</p>
          <p role="alert" className="mt-1 text-sm text-ink-soft">
            {message}
          </p>
        </div>
        <Button variant="secondary" onClick={onRetry} className="sm:shrink-0">
          重新加载
        </Button>
      </div>
    </Card>
  );
}
