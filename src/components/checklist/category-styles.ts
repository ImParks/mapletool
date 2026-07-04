// 카테고리(일일/주간/보스)별 Tailwind 클래스 맵 공용 모듈.
// MainScreenClient / ChecklistSection 등 여러 컴포넌트가 같은 맵을 중복 정의하지 않도록 모았다.
// 값은 tailwind.config.ts 의 maple.category.* 토큰을 참조하는 유틸 클래스 문자열이다
// (Tailwind 는 소스에 문자열로 존재하는 클래스만 생성하므로 동적 조합 금지 — 맵으로 고정).
import type { ChecklistCategory } from "@/lib/presets";

/** 캐릭터 카드 3줄 라벨용 축약 라벨(일일/주간/보스) */
export const CATEGORY_LABEL_SHORT: Record<ChecklistCategory, string> = {
  daily: "일일",
  weekly: "주간",
  boss: "보스",
};

/** 카테고리 색 텍스트 */
export const CATEGORY_TEXT_CLASS: Record<ChecklistCategory, string> = {
  daily: "text-maple-category-daily",
  weekly: "text-maple-category-weekly",
  boss: "text-maple-category-boss",
};

/** 카테고리 색 배경(진행바 fill 등) */
export const CATEGORY_BG_CLASS: Record<ChecklistCategory, string> = {
  daily: "bg-maple-category-daily",
  weekly: "bg-maple-category-weekly",
  boss: "bg-maple-category-boss",
};

/** 카테고리 소프트 배경 + 색 텍스트(호버 상태창의 칩 라벨 등) */
export const CATEGORY_SOFT_CLASS: Record<ChecklistCategory, string> = {
  daily: "bg-maple-category-daily/[.13] text-maple-category-daily",
  weekly: "bg-maple-category-weekly/[.12] text-maple-category-weekly",
  boss: "bg-maple-category-boss/[.13] text-maple-category-boss",
};
