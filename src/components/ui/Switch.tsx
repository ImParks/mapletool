"use client";

import { cn } from "@/lib/cn";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Pill 형태의 on/off 스위치. 실제 요소는 `role="switch"` + `aria-checked` 버튼이라
 * 스크린리더/키보드(Space·Enter) 로 조작 가능하다. 시각적 트랙은 디자인 스펙대로 46x26 이지만,
 * 버튼 자체는 h-11(44px)로 감싸 터치 타깃 최소 44px 규칙을 만족한다(트랙은 그 안에서 중앙 정렬).
 */
export function Switch({ checked, onChange, ariaLabel, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-11 w-[46px] flex-none items-center justify-center rounded-full transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maple-orange/45 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none flex h-[26px] w-[46px] flex-none items-center rounded-full border transition-colors duration-180 ease-standard",
          checked ? "border-maple-orange bg-maple-orange" : "border-maple-line bg-maple-surface-inset"
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 flex-none rounded-full bg-white shadow-sm transition-transform duration-180 ease-standard",
            checked ? "translate-x-[23px]" : "translate-x-[3px]"
          )}
        />
      </span>
    </button>
  );
}
