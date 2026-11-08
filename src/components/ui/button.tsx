import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/format";

export type ButtonVariant = "primary" | "secondary" | "accent" | "ghost" | "danger";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "aw-btn-primary",
  secondary: "aw-btn-secondary",
  accent: "aw-btn-accent",
  ghost: "aw-btn-ghost",
  danger: "aw-btn-danger",
};

/** 供 <Link className={buttonClass("secondary")}> 之类的场景复用 */
export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md"): string {
  return cn("aw-btn", VARIANT[variant], size === "sm" && "aw-btn-sm");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
};

export function Button({ variant = "primary", size = "md", className, type, ...props }: ButtonProps) {
  return (
    <button type={type ?? "button"} className={cn(buttonClass(variant, size), className)} {...props} />
  );
}
