import type { ReactNode } from "react";
import { ChevronDown, Clock, CheckCheck } from "lucide-react";
import { CATEGORY_BG_CLASS, CATEGORY_TEXT_CLASS } from "@/components/checklist/category-styles";
import { CATEGORY_LABEL, type ChecklistCategory } from "@/lib/presets";
import { cn } from "@/lib/cn";

interface ChecklistSectionProps {
  category: ChecklistCategory;
  done: number;
  /**
   * 진행바/배지의 분모. 대부분은 실제 항목 개수와 같지만, 주간·월간 보스 섹션은 우리가
   * 추적하는 프리셋 개수가 아니라 **게임 실제 보상 상한(주 12회 고정)**을 분모로 보여준다
   * (호출부 progressFor 에서 결정). 그래서 "항목이 있는지" 판정에는 이 값 대신 아래
   * itemCount 를 따로 받는다 — total 은 이제 "항목이 0개"와 무관하게 항상 양수일 수 있다.
   */
  total: number;
  /** 실제 항목 개수. "표시할 항목이 없어요" 판정과 일괄완료 비활성화는 total 이 아니라
   * 이 값 기준이다(total 이 보스 섹션처럼 고정값일 때도 정확하게 판단하기 위해). */
  itemCount: number;
  /** 이 카테고리에 소요시간이 하나라도 설정돼 있을 때만 값(null 이면 시간 안내 숨김). */
  remainLabel: string | null;
  totalLabel: string | null;
  onBulkComplete: () => void;
  /** 남은시간 안내와 항목 목록 사이에 끼워 넣을 부가 컨텐츠(예: 보스 섹션의 "보스 편집" 버튼). */
  extraContent?: ReactNode;
  /** 접힘 여부. true 면 진행바 아래(남은시간/부가컨텐츠/항목 목록)를 감춘다 — 헤더(라벨/
   * 배지/일괄완료/펼치기 버튼)와 진행바까지는 접혀 있어도 항상 보여 요약 정보를 유지한다. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  children: ReactNode;
}

/** 일일/주간/보스 카테고리 섹션 컨테이너. 진행바 + 일괄완료 + (있으면) 남은 예상시간. */
export function ChecklistSection({
  category,
  done,
  total,
  itemCount,
  remainLabel,
  totalLabel,
  onBulkComplete,
  extraContent,
  collapsed,
  onToggleCollapsed,
  children,
}: ChecklistSectionProps) {
  // total 이 실제 항목 수보다 클 수 있어(보스 섹션의 12 고정) 퍼센트가 100 을 넘지 않게 막는다.
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const complete = total > 0 && done >= total;

  return (
    <section className="rounded-2xl border border-maple-line bg-maple-surface-card p-3 shadow-sm sm:p-4">
      <header className="flex items-center justify-between gap-3 px-1 pb-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 flex-none text-maple-text-muted transition-transform duration-180",
              collapsed && "-rotate-90"
            )}
            aria-hidden="true"
          />
          <span className={cn("text-sm font-extrabold", CATEGORY_TEXT_CLASS[category])}>
            {CATEGORY_LABEL[category]}
          </span>
          <span className="text-xs font-extrabold tabular-nums text-maple-text-secondary">
            {done}/{total}
          </span>
        </button>
        <button
          type="button"
          onClick={onBulkComplete}
          disabled={itemCount === 0 || complete}
          className="inline-flex h-8 flex-none items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-maple-text-secondary transition-colors hover:bg-maple-surface-inset disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
          일괄완료
        </button>
      </header>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-maple-surface-inset">
        <div
          className={cn("h-full rounded-full transition-all duration-280 ease-out", CATEGORY_BG_CLASS[category])}
          style={{ width: `${pct}%` }}
        />
      </div>

      {!collapsed && (
        <>
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
            {itemCount === 0 ? (
              <p className="px-1 py-3 text-xs font-semibold text-maple-text-muted">표시할 항목이 없어요.</p>
            ) : (
              children
            )}
          </div>
        </>
      )}
    </section>
  );
}
