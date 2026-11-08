import { useMemo } from "react";
import { marked } from "marked";
import { cn } from "@/lib/format";

/**
 * 轻量 Markdown 渲染：marked 解析 + DOM 层面的基础过滤。
 * 介绍页由教师本人编辑，仍做一层 basic XSS 防护（去掉 script/iframe/事件属性等）。
 */
export function renderMarkdown(markdown: string): string {
  const raw = marked.parse(markdown ?? "") as unknown as string;
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return raw;

  const doc = new DOMParser().parseFromString(raw, "text/html");
  doc.body
    .querySelectorAll("script, iframe, object, embed, form, link, meta, style, base")
    .forEach((node) => node.remove());

  doc.body.querySelectorAll("*").forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const isEventAttr = name.startsWith("on");
      const isUnsafeUrl =
        (name === "href" || name === "src") && /^\s*(javascript|data|vbscript):/i.test(attr.value);
      if (isEventAttr || isUnsafeUrl) element.removeAttribute(attr.name);
    }
  });

  return doc.body.innerHTML;
}

/** 无 typography 插件时的 Markdown 排版（纯 Tailwind 任意变体，不新增全局样式） */
const MARKDOWN_STYLE = [
  "max-w-none text-sm leading-6 text-ink-soft",
  "[&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:leading-snug [&_h1]:text-brand-900",
  "[&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-brand-900",
  "[&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-brand-900",
  "[&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0 [&_p:first-child]:mt-0",
  "[&_p]:mt-3",
  "[&_a]:font-medium [&_a]:text-brand-600 [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-brand-700",
  "[&_strong]:font-semibold [&_strong]:text-brand-900",
  "[&_em]:italic",
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
  "[&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
  "[&_li]:leading-6 [&_li]:marker:text-brand-400",
  "[&_blockquote]:mt-3 [&_blockquote]:border-l-2 [&_blockquote]:border-brand-200 [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:text-brand-800",
  "[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-line [&_pre]:bg-brand-50 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:leading-5",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-ink",
  "[&_hr]:my-4 [&_hr]:border-line",
  "[&_img]:mt-3 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-line",
  "[&_table]:mt-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
  "[&_th]:border [&_th]:border-line [&_th]:bg-brand-50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-brand-900",
  "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1.5",
].join(" ");

/** 只读的 Markdown 展示区（介绍页预览、课题介绍） */
export function MarkdownView({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  return (
    <div
      className={cn(MARKDOWN_STYLE, className)}
      // 内容来自教师本人编辑的课题介绍，renderMarkdown 已做 basic XSS 过滤
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
