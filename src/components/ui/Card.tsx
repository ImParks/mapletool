import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CardProps {
  children: ReactNode;
  className?: string;
  /** false 면 내부 padding 없이 렌더(리스트를 카드로 감쌀 때 등). 기본 true. */
  padded?: boolean;
}

export function Card({ children, className, padded = true }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-maple-line bg-maple-surface-card shadow-sm",
        padded && "p-5 sm:p-6",
        className
      )}
    >
      {children}
    </div>
  );
}
