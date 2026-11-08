import { Navigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { LoginForm } from "@/components/auth/LoginForm";
import { IconBook, IconClipboard, IconGraduation, IconUsers } from "@/components/ui/icons";
import { roleHome } from "@/lib/format";

const HIGHLIGHTS = [
  { icon: <IconUsers className="size-5" />, title: "班级与成员", desc: "邀请码入班，名单一目了然" },
  { icon: <IconBook className="size-5" />, title: "课程组织", desc: "按班级建课，课程内发布作业" },
  { icon: <IconClipboard className="size-5" />, title: "作业闭环", desc: "发布、提交、批改、反馈一处完成" },
];

export default function LoginPage() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to={roleHome(user.role)} replace />;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* 品牌区 */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-600 px-10 py-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-white/15">
            <IconGraduation className="size-6" />
          </span>
          <div>
            <p className="text-lg font-bold tracking-tight">AIWorkspace</p>
            <p className="text-xs font-medium text-white/70">面向学校的教学系统</p>
          </div>
        </div>

        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">
            Teaching Workspace
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight">
            让教师专注教学，
            <br />
            让学生看见成长。
          </h1>
          <p className="mt-4 text-sm leading-6 text-white/80">
            一个轻量的网页教学空间：班级、课程、作业、提交与成绩，全部收在一个工作台里。
          </p>

          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-white/15">
                  {item.icon}
                </span>
                <span>
                  <span className="block text-sm font-semibold">{item.title}</span>
                  <span className="block text-xs text-white/70">{item.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/60">
          © {new Date().getFullYear()} AIWorkspace · Docker 部署 · 端口 3100
        </p>
      </div>

      {/* 表单区 */}
      <div className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-600 text-white">
              <IconGraduation className="size-5" />
            </span>
            <div>
              <p className="text-base font-bold tracking-tight text-brand-900">AIWorkspace</p>
              <p className="text-xs text-ink-soft">教学系统</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-brand-900">登录</h2>
          <p className="mt-1.5 text-sm text-ink-soft">使用学校发放的教师或学生账号登录</p>

          <div className="mt-6">
            <LoginForm />
          </div>

          <p className="mt-8 text-xs leading-relaxed text-ink-soft">
            遇到问题请联系班主任或教务处。首次使用请先让教师创建班级，学生凭 6 位邀请码加入。
          </p>
        </div>
      </div>
    </div>
  );
}
