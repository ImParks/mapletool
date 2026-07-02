import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}

/** 44x44 아이콘 전용 버튼(터치 타깃 충족). 앱바 동기화/설정 버튼 등에서 사용. */
export function IconButton({ ariaLabel, children, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl text-maple-text-secondary transition-colors duration-180 ease-standard hover:bg-maple-surface-inset active:bg-maple-surface-sunken disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maple-orange/45",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
