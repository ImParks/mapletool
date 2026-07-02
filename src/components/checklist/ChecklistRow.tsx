import { Check } from "lucide-react";
import { Checkbox } from "@/components/ui/Checkbox";
import { RESET_LABEL, type ResetType } from "@/lib/period";
import { cn } from "@/lib/cn";

interface ChecklistRowProps {
  id: string;
  name: string;
  resetType: ResetType;
  done: boolean;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}

/** 항목 1행. 행 전체가 히트 영역(label)이며 체크박스/이름/초기화 안내 문구를 포함한다. */
export function ChecklistRow({ id, name, resetType, done, onToggle, disabled, className }: ChecklistRowProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-180 ease-standard hover:bg-maple-surface-inset",
        disabled && "cursor-wait opacity-70",
        className
      )}
    >
      <Checkbox id={id} checked={done} onChange={() => onToggle()} disabled={disabled} ariaLabel={name} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-semibold",
            done ? "text-maple-text-muted line-through" : "text-maple-text-primary"
          )}
        >
          {name}
        </span>
        <span className="block text-[11px] font-semibold text-maple-text-muted">{RESET_LABEL[resetType]}</span>
      </span>
      {done && <Check className="h-4 w-4 flex-none text-maple-success" aria-hidden="true" />}
    </label>
  );
}
