import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { Avatar } from "@/components/ui/avatar";
import {
  IconBell,
  IconBook,
  IconChart,
  IconClipboard,
  IconClose,
  IconDashboard,
  IconGraduation,
  IconLogout,
  IconMenu,
  IconUsers,
} from "@/components/ui/icons";
import { cn, roleHome } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/roles";
import type { User } from "@/lib/types";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
};

function navForRole(role: string): NavItem[] {
  if (role === "TEACHER" || role === "ADMIN") {
    return [
      { href: "/teacher", label: "工作台", icon: <IconDashboard />, exact: true },
      { href: "/teacher/classes", label: "我的班级", icon: <IconUsers /> },
      { href: "/teacher/assignments", label: "作业与批改", icon: <IconClipboard /> },
    ];
  }
  return [
    { href: "/student", label: "工作台", icon: <IconDashboard />, exact: true },
    { href: "/student/classes", label: "我的班级", icon: <IconBook /> },
    { href: "/student/assignments", label: "我的作业", icon: <IconClipboard /> },
    { href: "/student/grades", label: "成绩单", icon: <IconChart /> },
  ];
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function BrandMark({ href }: { href: string }) {
  return (
    <Link to={href} className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white">
        <IconGraduation className="size-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-tight text-brand-900">AIWorkspace</span>
        <span className="block text-[11px] font-medium text-ink-soft">教学系统</span>
      </span>
    </Link>
  );
}

function NavList({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1" aria-label="主导航">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            to={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-brand-50 text-brand-700"
                : "text-ink-soft hover:bg-brand-50/70 hover:text-brand-800",
            )}
          >
            <span className={cn(active ? "text-brand-600" : "text-ink-soft/70")}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserCard({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5">
      <Avatar name={user.name} color={user.avatarColor} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-brand-900">{user.name}</p>
        <p className="truncate text-xs text-ink-soft">{ROLE_LABEL[user.role] ?? user.role}</p>
      </div>
      <button
        type="button"
        onClick={onLogout}
        title="退出登录"
        aria-label="退出登录"
        className="grid size-8 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-red-50 hover:text-danger"
      >
        <IconLogout className="size-4" />
      </button>
    </div>
  );
}

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const pathname = useLocation().pathname;
  const [open, setOpen] = useState(false);
  const items = navForRole(user.role);
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      {/* 桌面侧栏 */}
      <aside className="hidden border-r border-line bg-white lg:flex lg:h-dvh lg:flex-col lg:gap-6 lg:px-4 lg:py-5">
        <BrandMark href={roleHome(user.role)} />
        <div className="flex-1 overflow-y-auto aw-scroll">
          <NavList items={items} pathname={pathname} />
        </div>
        <div className="space-y-2">
          <Link
            to={user.role === "TEACHER" ? "/teacher/assignments" : "/student/assignments"}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            <IconBell className="size-4" />
            查看待办与通知
          </Link>
          <UserCard user={user} onLogout={handleLogout} />
        </div>
      </aside>

      {/* 移动端顶栏 */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <BrandMark href={roleHome(user.role)} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="打开导航"
          className="grid size-9 place-items-center rounded-lg border border-line text-brand-800"
        >
          <IconMenu className="size-5" />
        </button>
      </div>

      {/* 移动端抽屉 */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="关闭导航"
            className="absolute inset-0 bg-brand-900/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-6 bg-white px-4 py-5">
            <div className="flex items-center justify-between">
              <BrandMark href={roleHome(user.role)} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭导航"
                className="grid size-8 place-items-center rounded-lg text-ink-soft hover:bg-brand-50"
              >
                <IconClose className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto aw-scroll">
              <NavList items={items} pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
            <UserCard user={user} onLogout={handleLogout} />
          </div>
        </div>
      ) : null}

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
