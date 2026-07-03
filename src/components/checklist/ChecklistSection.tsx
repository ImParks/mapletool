import type { ReactNode } from "react";
import { Clock, CheckCheck } from "lucide-react";
import { CATEGORY_LABEL, type ChecklistCategory } from "@/lib/presets";
import { cn } from "@/lib/cn";

const CATEGORY_TEXT_CLASS: Record<ChecklistCategory, string> = {
  daily: "text-maple-category-daily",
  weekly: "text-maple-category-weekly",
  boss: "text-maple-category-boss",
};

const CATEGORY_BAR_CLASS: Record<ChecklistCategory, string> = {
  daily: "bg-maple-category-daily",
  weekly: "bg-maple-category-weekly",
  boss: "bg-maple-category-boss",
};

interface ChecklistSectionProps {
  category: ChecklistCategory;
  done: number;
  total: number;
  /** 이 카테고리에 소요시간이 하나라도 설정돼 있을 때만 값(null 이면 시간 안내 숨김). */
  remainLabel: string | null;
  totalLabel: string | null;
  onBulkComplete: () => void;
  /** 남은시간 안내와 항목 목록 사이에 끼워 넣을 부가 컨텐츠(예: 보스 섹션의 "보스 편집" 버튼). */
  extraContent?: ReactNode;
  children: ReactNode;
}

/** 일일/주간/보스 카테고리 섹션 컨테이너. 진행바 + 일괄완료 + (있으면) 남은 예상시간. */
export function ChecklistSection({
  category,
  done,
  total,
  remainLabel,
  totalLabel,
  onBulkComplete,
  extraContent,
  children,
}: ChecklistSectionProps) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = total > 0 && done >= total;

  return (
    <section className="rounded-2xl border border-maple-line bg-maple-surface-card p-3 shadow-sm sm:p-4">
      <header className="flex items-center justify-between gap-3 px-1 pb-2">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-extrabold", CATEGORY_TEXT_CLASS[category])}>
            {CATEGORY_LABEL[category]}
          </span>
          <span className="text-xs font-extrabold tabular-nums text-maple-text-secondary">
            {done}/{total}
          </span>
        </div>
        <button
          type="button"
          onClick={onBulkComplete}
          disabled={total === 0 || complete}
          className="inline-flex h-8 flex-none items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-maple-text-secondary transition-colors hover:bg-maple-surface-inset disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
          일괄완료
        </button>
      </header>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-maple-surface-inset">
        <div
          className={cn("h-full rounded-full transition-all duration-280 ease-out", CATEGORY_BAR_CLASS[category])}
          style={{ width: `${pct}%` }}
        />
      </div>

      {remainLabel && (
        <div className="flex items-center gap-1.5 px-1 pb-1 pt-2.5 text-[11.5px] font-bold text-maple-text-muted">
          <Clock className="h-3 w-3 flex-none" aria-hidden="true" />
          <span>
            남은 예상 시간 <span className="font-extrabold text-maple-orange-300">~{remainLabel}</span>
            {totalLabel && <span className="text-maple-text-disabled"> · 전체 {totalLabel}</span>}
          </span>
        </div>
      )}

      {extraContent}

      <div className="mt-2 flex flex-col gap-1">
        {total === 0 ? (
          <p className="px-1 py-3 text-xs font-semibold text-maple-text-muted">표시할 항목이 없어요.</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
