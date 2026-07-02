import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-maple-orange text-maple-text-onaccent shadow-glow-orange hover:bg-maple-orange-hover active:bg-maple-orange-pressed",
  secondary:
    "border border-maple-line bg-maple-surface-card text-maple-text-primary shadow-xs hover:bg-maple-surface-raised active:bg-maple-surface-inset",
  ghost: "text-maple-text-secondary hover:bg-maple-surface-inset active:bg-maple-surface-sunken",
  danger: "bg-maple-danger text-white hover:brightness-95 active:brightness-90",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-11 px-4 text-sm gap-2",
  lg: "h-[52px] px-5 text-base gap-2.5",
};

/**
 * Button 과 동일한 시각 스타일을 <button> 이 아닌 요소(예: next/link 로 만든 "버튼처럼 보이는
 * 링크")에 적용할 때 쓰는 클래스 생성 헬퍼. 랜딩 화면의 "시작하기" 링크 버튼 등에서 사용한다.
 */
export function buttonClassName({ variant = "primary", size = "md", block, className }: ButtonStyleOptions = {}): string {
  return cn(
    "inline-flex items-center justify-center rounded-xl font-bold transition-all duration-180 ease-standard active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maple-orange/45 focus-visible:ring-offset-2 focus-visible:ring-offset-maple-surface-app",
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    block && "w-full",
    className
  );
}

interface ButtonProps extends ButtonStyleOptions, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  /** 서버 액션 pending 중일 때 스피너 표시 + 비활성화 */
  pending?: boolean;
  leadingIcon?: ReactNode;
  children: ReactNode;
}

/** 최소 44px 터치 타깃을 만족하는 기본(md) 높이 44px, sm/lg 는 용도에 맞게 선택. */
export function Button({
  variant,
  size,
  block,
  pending,
  leadingIcon,
  className,
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonProps) {
  const icon = pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : leadingIcon;

  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, block, className })}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
