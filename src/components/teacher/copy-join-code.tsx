"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconCheck } from "@/components/ui/icons";

/**
 * 班级邀请码展示 + 一键复制（复制属于交互，所以是 Client Component）。
 * 邀请码本身可选中（select-all），复制失败时提示手动选中。
 */
export function CopyJoinCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function handleCopy() {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <span className="select-all rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 font-mono text-xl font-bold tracking-[0.25em] text-brand-800">
          {code}
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
          {copied ? <IconCheck className="size-4" /> : null}
          {copied ? "已复制" : "复制邀请码"}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-[11px] leading-relaxed text-ink-soft">
        {failed
          ? "复制失败，请手动选中邀请码复制"
          : copied
            ? "邀请码已复制，发给学生即可加入本班"
            : "学生登录后输入这 6 位邀请码即可加入本班"}
      </p>
    </div>
  );
}
