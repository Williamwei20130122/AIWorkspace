import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { roleHome } from "@/lib/format";
import type { Role } from "@/lib/types";

/** 路由守卫：未登录跳 /login；角色不符跳自己角色的首页 */
export function ProtectedRoute({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="text-sm text-ink-soft">加载中…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (role && user.role !== role) {
    return <Navigate to={roleHome(user.role)} replace />;
  }

  return <>{children}</>;
}
