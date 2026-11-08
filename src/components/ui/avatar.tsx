import { cn, initials } from "@/lib/format";

export function Avatar({
  name,
  color,
  size = "md",
  className,
}: {
  name: string;
  color?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClass = {
    sm: "size-8 text-xs",
    md: "size-10 text-sm",
    lg: "size-14 text-lg",
  }[size];

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-white",
        sizeClass,
        className,
      )}
      style={{ backgroundColor: color || "#0d9488" }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
