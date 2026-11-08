import { Badge } from "@/components/ui/badge";
import type { TopicStatus } from "@/lib/types";

/** 课题状态：进行中 / 已关闭 */
export function TopicStatusBadge({ status }: { status: TopicStatus }) {
  return status === "ACTIVE" ? <Badge tone="success">进行中</Badge> : <Badge tone="neutral">已关闭</Badge>;
}

/** 提交的评价状态：待评价 / 已评价 */
export function PendingBadge({ pending }: { pending: boolean }) {
  return pending ? <Badge tone="warning">待评价</Badge> : <Badge tone="success">已评价</Badge>;
}

/** 学生密码状态：无密码可直接登录 / 已有密码 */
export function PasswordBadge({ hasPassword }: { hasPassword: boolean }) {
  return hasPassword ? <Badge tone="brand">已有密码</Badge> : <Badge tone="neutral">无密码</Badge>;
}
