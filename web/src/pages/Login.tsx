import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { LoginForm } from "@/components/auth/LoginForm";
import { IconAward, IconBook, IconClipboard, IconGraduation } from "@/components/ui/icons";
import { roleHome } from "@/lib/format";

const HIGHLIGHTS = [
  { icon: <IconBook className="size-5" />, title: "课题介绍", desc: "老师建课题，学生被动加入" },
  { icon: <IconClipboard className="size-5" />, title: "提交作品", desc: "文本与任意文件，随时重新提交" },
  { icon: <IconAward className="size-5" />, title: "多维评价", desc: "自定义评分维度 + 文字评语" },
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
            Topic · Submission · Evaluation
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight">
            从课题开始，
            <br />
            让每一次提交都被看见。
          </h1>
          <p className="mt-4 text-sm leading-6 text-white/80">
            老师创建课题、管理学生与助教；学生用学号进入，提交作品；多维度评价沉淀成长记录。
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
          <p className="mt-1.5 text-sm text-ink-soft">使用老师分配的学号，或教师的用户名 / ID 登录</p>

          <div className="mt-6">
            <LoginForm />
          </div>

          <p className="mt-8 text-xs leading-relaxed text-ink-soft">
            学生账号由老师创建，默认没有密码，可直接用学号进入；也可以登录后自行设置密码。
          </p>
          <p className="mt-3 text-xs text-ink-soft">
            还没有教师账号？
            <Link to="/register" className="ml-1 font-medium text-brand-700 hover:underline">
              教师注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
