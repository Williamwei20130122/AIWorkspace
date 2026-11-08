import { useState } from "react";
import type { FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { ApiError, api, errorMessage } from "@/lib/api";
import type { ManagedStudent } from "@/lib/types";

/** 创建前的用户名占用信息（GET /api/teacher/students/lookup 或创建 409 的 conflict 字段） */
type StudentAccountInfo = {
  id: string;
  name: string;
  loginId: string;
  hasPassword: boolean;
  managedByMe: boolean;
  createdBy: string[] | null;
};

type LookupResponse = { exists: boolean; user?: StudentAccountInfo };

/**
 * 创建学生：name + loginId。
 * 用户名被占用时（409 或创建前查询）展示已有账号信息，让老师判断：
 * 「是我管理的学生 → 加入」或「不是同一个人 → 换用户名」。
 */
export function CreateStudentForm({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [conflict, setConflict] = useState<StudentAccountInfo | null>(null);

  const loginInputId = "new-student-login";

  function focusLoginInput() {
    const input = document.getElementById(loginInputId);
    if (input instanceof HTMLInputElement) input.focus();
  }

  function resetMessages() {
    setError(null);
    setSuccess(null);
  }

  async function lookup(login: string): Promise<StudentAccountInfo | null> {
    const data = await api.get<LookupResponse>(
      `/api/teacher/students/lookup?loginId=${encodeURIComponent(login)}`,
    );
    return data.exists && data.user ? data.user : null;
  }

  async function handleCheckLoginId() {
    if (checking || pending) return;
    const login = loginId.trim();
    resetMessages();
    setConflict(null);
    if (!login) {
      setError("请先填写用户名（学号）");
      return;
    }

    setChecking(true);
    try {
      const info = await lookup(login);
      if (info) {
        setConflict(info);
      } else {
        setSuccess("这个用户名可以使用");
      }
    } catch (err) {
      setError(errorMessage(err, "查询用户名失败，请稍后重试"));
    } finally {
      setChecking(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || checking) return;

    const trimmedName = name.trim();
    const trimmedLogin = loginId.trim();
    resetMessages();
    setConflict(null);

    if (!trimmedName) {
      setError("请填写学生姓名");
      return;
    }
    if (!trimmedLogin) {
      setError("请填写学生用户名（学号）");
      return;
    }

    setPending(true);
    try {
      // 创建前先查重：已存在则展示账号信息，让老师决定「加入」还是「换用户名」。
      // 查询接口不可用时（老后端/网络问题）退回直接创建，由 409 兜底。
      let existing: StudentAccountInfo | null = null;
      try {
        existing = await lookup(trimmedLogin);
      } catch {
        existing = null;
      }
      if (existing) {
        setConflict(existing);
        return;
      }

      const created = await api.post<ManagedStudent>("/api/teacher/students", {
        name: trimmedName,
        loginId: trimmedLogin,
      });
      const createdName =
        (created as { name?: string } | null)?.name ?? trimmedName;
      setName("");
      setLoginId("");
      setSuccess(`已创建学生「${createdName}」，默认无密码，可直接用用户名登录`);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(errorMessage(err, "该用户名已存在"));
        // 优先用 409 响应体里的 conflict；老后端没有该字段时退回 lookup 查询
        const conflictFromBody =
          ((err.data as { conflict?: StudentAccountInfo } | null | undefined)?.conflict) ?? null;
        if (conflictFromBody) {
          setConflict(conflictFromBody);
        } else {
          try {
            const info = await lookup(trimmedLogin);
            if (info) setConflict(info);
          } catch {
            // 查询接口不可用时保留 409 的通用提示
          }
        }
      } else {
        setError(errorMessage(err, "创建学生失败，请稍后重试"));
      }
    } finally {
      setPending(false);
    }
  }

  async function handleLink() {
    if (!conflict || linking) return;
    setLinking(true);
    setError(null);
    try {
      await api.post(`/api/teacher/students/${conflict.id}/link`);
      setSuccess(`已把「${conflict.name}」加入你的学生列表`);
      setName("");
      setLoginId("");
      setConflict(null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "加入学生列表失败，请稍后重试"));
    } finally {
      setLinking(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label="学生姓名" htmlFor="new-student-name">
        <Input
          id="new-student-name"
          name="name"
          required
          maxLength={40}
          autoComplete="off"
          placeholder="李小明"
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field
        label="用户名（学号）"
        htmlFor={loginInputId}
        hint="学生用这个用户名登录；可填学号或姓名拼音，不能与已有账号重复"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={loginInputId}
            name="loginId"
            required
            maxLength={40}
            autoComplete="off"
            placeholder="S005"
            value={loginId}
            disabled={pending}
            onChange={(event) => {
              setLoginId(event.target.value);
              if (conflict) setConflict(null);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            disabled={checking || pending}
            onClick={() => void handleCheckLoginId()}
          >
            {checking ? "查询中…" : "检查用户名"}
          </Button>
        </div>
      </Field>

      {conflict ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              用户名「{conflict.loginId}」已被占用
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              请确认这是不是同一个学生：如果是我管理的学生，直接加入；如果不是，换一个用户名。
            </p>
          </div>

          <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[72px_minmax(0,1fr)]">
            <dt className="text-amber-900/80">姓名</dt>
            <dd className="font-medium text-amber-900">{conflict.name}</dd>
            <dt className="text-amber-900/80">用户名</dt>
            <dd className="font-medium text-amber-900">{conflict.loginId}</dd>
            <dt className="text-amber-900/80">创建者</dt>
            <dd className="text-amber-900">
              {conflict.createdBy && conflict.createdBy.length > 0
                ? conflict.createdBy.join("、")
                : "未记录 / 非学生账号"}
            </dd>
            <dt className="text-amber-900/80">密码</dt>
            <dd>
              <Badge tone={conflict.hasPassword ? "brand" : "neutral"}>
                {conflict.hasPassword ? "已有密码" : "无密码"}
              </Badge>
            </dd>
            <dt className="text-amber-900/80">我的学生</dt>
            <dd className="text-amber-900">{conflict.managedByMe ? "已在你的学生列表中" : "还不在你的列表中"}</dd>
          </dl>

          <div className="flex flex-wrap gap-2">
            {conflict.managedByMe ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConflict(null);
                  setSuccess("这个账号已经在你的学生列表中，可以直接在列表里管理密码");
                  onChanged();
                }}
              >
                知道了，去学生列表
              </Button>
            ) : (
              <Button
                type="button"
                variant="accent"
                size="sm"
                disabled={linking}
                onClick={() => void handleLink()}
              >
                {linking ? "加入中…" : "这是我管理的学生 → 加入"}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={linking}
              onClick={() => {
                setConflict(null);
                setLoginId("");
                setError(null);
                focusLoginInput();
              }}
            >
              不是同一个人，换用户名
            </Button>
          </div>

          <p className="text-[11px] leading-relaxed text-amber-800/80">
            提示：如果这个用户名被教师账号（邮箱 / 手机号）占用，请换一个学生用户名再创建。
          </p>
        </div>
      ) : null}

      <FormMessage error={error ?? undefined} success={success ?? undefined} />

      <Button type="submit" variant="accent" disabled={pending || checking} className="w-full">
        {pending ? "创建中…" : "创建学生"}
      </Button>
      <p className="text-[11px] leading-relaxed text-ink-soft">
        学生默认无密码，可直接用用户名登录；你也可以之后为学生重置或关闭密码。
      </p>
    </form>
  );
}
