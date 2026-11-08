import { useMemo } from "react";
import { marked } from "marked";
import { cn } from "@/lib/format";

/**
 * 课题介绍页 Markdown 渲染。
 *
 * marked 默认会原样保留内联 HTML，因此渲染后必须做一次白名单清洗：
 * 只保留常见的排版标签与安全属性，去掉 script/style/iframe 等危险标签、
 * 所有 on* 事件属性以及非 http(s)/相对链接，避免教师在介绍页里粘贴的
 * 内容变成 XSS 载荷。
 */

const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "CODE",
  "STRONG",
  "EM",
  "B",
  "I",
  "U",
  "S",
  "DEL",
  "INS",
  "MARK",
  "SUP",
  "SUB",
  "KBD",
  "A",
  "IMG",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "TH",
  "TD",
  "SPAN",
  "DIV",
  "INPUT",
]);

const DROP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "FORM",
  "LINK",
  "META",
  "BASE",
  "TEMPLATE",
  "SVG",
  "MATH",
]);

const GLOBAL_ATTRS = new Set(["class", "title"]);

const TAG_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href"]),
  IMG: new Set(["src", "alt", "width", "height"]),
  TD: new Set(["colspan", "rowspan", "align"]),
  TH: new Set(["colspan", "rowspan", "align"]),
  OL: new Set(["start"]),
  INPUT: new Set(["type", "checked", "disabled"]),
};

function isSafeUrl(raw: string, allowDataImage: boolean): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (
    value.startsWith("#") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("?")
  ) {
    return true;
  }
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") return true;
    if (!allowDataImage && (url.protocol === "mailto:" || url.protocol === "tel:")) return true;
    if (allowDataImage && url.protocol === "data:" && /^data:image\/(png|jpe?g|gif|webp);/i.test(value)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function sanitizeHtml(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const elements = Array.from(doc.body.querySelectorAll("*"));

  for (const el of elements) {
    if (DROP_TAGS.has(el.tagName)) {
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(el.tagName)) {
      // 未授权标签：保留文字内容，去掉标签本身
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      if (type !== "checkbox") {
        el.remove();
        continue;
      }
      el.setAttribute("disabled", "");
    }

    const tagAttrs = TAG_ATTRS[el.tagName];
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const allowed = GLOBAL_ATTRS.has(name) || tagAttrs?.has(name);
      if (!allowed || name.startsWith("on") || name === "style") {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "href" && !isSafeUrl(attr.value, false)) {
        el.removeAttribute(attr.name);
      }
      if (name === "src" && !isSafeUrl(attr.value, true)) {
        el.removeAttribute(attr.name);
      }
    }

    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer nofollow");
    }
    if (el.tagName === "IMG") {
      el.setAttribute("loading", "lazy");
      el.setAttribute("referrerpolicy", "no-referrer");
    }
  }

  return doc.body.innerHTML;
}

const PROSE_CLASS = [
  "text-sm leading-7 text-ink",
  "[&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline [&_a]:underline-offset-2",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-brand-200 [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft",
  "[&_code]:rounded [&_code]:bg-brand-50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px]",
  "[&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-brand-900",
  "[&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-brand-900",
  "[&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-brand-900",
  "[&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-brand-900",
  "[&_hr]:my-5 [&_hr]:border-line",
  "[&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-xl",
  "[&_li]:mt-1",
  "[&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_p]:mt-2",
  "[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-line [&_pre]:bg-brand-50/60 [&_pre]:p-3",
  "[&_table]:mt-3 [&_table]:w-full [&_table]:border-collapse",
  "[&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1",
  "[&_th]:border [&_th]:border-line [&_th]:bg-brand-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5",
].join(" ");

export function Markdown({ content, className }: { content: string; className?: string }) {
  const html = useMemo(() => {
    const rendered = marked.parse(content, { async: false, gfm: true, breaks: true }) as string;
    if (typeof rendered !== "string" || rendered.trim() === "") return "";
    return sanitizeHtml(rendered);
  }, [content]);

  return <div className={cn(PROSE_CLASS, className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
