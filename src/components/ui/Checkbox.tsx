import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

interface CheckboxProps {
  id?: string;
  name?: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

/**
 * 26x26 히트 영역(터치 타깃)을 가진 체크박스. 실제 <input type="checkbox"> 는 시각적으로
 * 숨기되(sr-only 아님, opacity-0 로 처리해 여전히 클릭/포커스 가능) 접근성을 유지한다.
 */
export function Checkbox({ id, name, checked, onChange, disabled, ariaLabel, className }: CheckboxProps) {
  return (
    <span className={cn("relative inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center", className)}>
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange?.(event.target.checked)}
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none flex h-5 w-5 items-center justify-center rounded-md border transition-colors duration-180 ease-standard peer-focus-visible:ring-2 peer-focus-visible:ring-maple-orange/45 peer-focus-visible:ring-offset-2",
          checked ? "border-maple-orange bg-maple-orange" : "border-maple-line bg-maple-surface-card",
          disabled && "opacity-50"
        )}
      >
        {checked && <Check className="h-3.5 w-3.5 text-maple-text-onaccent" strokeWidth={3} aria-hidden="true" />}
      </span>
    </span>
  );
}
