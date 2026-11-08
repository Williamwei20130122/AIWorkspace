import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 教师端页面里的分区卡片：标题 + 说明 + 右侧操作 + 内容。
 * 纯展示组件（Server Component），不需要 "use client"。
 */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <div className={cn("px-5 pb-5 pt-3", bodyClassName)}>{children}</div>
    </Card>
  );
}
