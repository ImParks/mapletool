import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  label?: string;
  leadingIcon?: ReactNode;
  helpText?: string;
  errorText?: string;
  /** 입력 wrapper(label 포함 전체 블록)에 적용할 클래스 */
  containerClassName?: string;
  /** <input> 엘리먼트 자체에 추가로 적용할 클래스 */
  className?: string;
}

/** 라벨 + 아이콘 + 도움말/에러 문구를 포함한 텍스트 입력 프리미티브. 높이 44px(터치 타깃 충족). */
export function Input({
  label,
  leadingIcon,
  helpText,
  errorText,
  containerClassName,
  className,
  id,
  name,
  required,
  ...rest
}: InputProps) {
  const inputId = id ?? name;

  return (
    <div className={cn("flex flex-col gap-1.5", containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-bold text-maple-text-secondary">
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-maple-danger">
              *
            </span>
          )}
        </label>
      )}
      <div className="relative flex items-center">
        {leadingIcon && (
          <span className="pointer-events-none absolute left-3.5 flex h-5 w-5 items-center justify-center text-maple-text-muted">
            {leadingIcon}
          </span>
        )}
        <input
          id={inputId}
          name={name}
          required={required}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={errorText ? `${inputId}-error` : helpText ? `${inputId}-help` : undefined}
          className={cn(
            "h-11 w-full rounded-xl border border-maple-line bg-maple-surface-card px-3.5 text-sm text-maple-text-primary outline-none transition-colors duration-180 ease-standard placeholder:text-maple-text-muted focus:border-maple-orange focus:ring-2 focus:ring-maple-orange/45 disabled:cursor-not-allowed disabled:bg-maple-surface-inset disabled:text-maple-text-disabled",
            leadingIcon && "pl-10",
            errorText && "border-maple-danger focus:border-maple-danger focus:ring-maple-danger/30",
            className
          )}
          {...rest}
        />
      </div>
      {errorText ? (
        <p id={`${inputId}-error`} className="text-xs font-semibold text-maple-danger">
          {errorText}
        </p>
      ) : helpText ? (
        <p id={`${inputId}-help`} className="text-xs font-semibold text-maple-text-muted">
          {helpText}
        </p>
      ) : null}
    </div>
  );
}
