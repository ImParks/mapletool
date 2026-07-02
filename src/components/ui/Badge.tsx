import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type BadgeTone = "success" | "neutral" | "warning" | "danger";

const TONE_CLASS: Record<BadgeTone, string> = {
  success: "bg-maple-success-soft text-maple-success-text",
  neutral: "bg-maple-surface-inset text-maple-text-secondary",
  warning: "bg-maple-warning-soft text-maple-warning",
  danger: "bg-maple-danger-soft text-maple-danger",
};

const DOT_CLASS: Record<BadgeTone, string> = {
  success: "bg-maple-success",
  neutral: "bg-maple-text-muted",
  warning: "bg-maple-warning",
  danger: "bg-maple-danger",
};

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", dot, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold",
        TONE_CLASS[tone],
        className
      )}
    >
      {dot && <span aria-hidden="true" className={cn("h-1.5 w-1.5 flex-none rounded-full", DOT_CLASS[tone])} />}
      {children}
    </span>
  );
}
