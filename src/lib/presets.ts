// 신규 사용자 가입 시 기본으로 채워지는 체크리스트 프리셋.
// 사용자는 가입 후 자유롭게 추가/삭제/수정할 수 있다.
import type { ResetType } from "./period";

export type ChecklistCategory = "daily" | "weekly" | "boss";

export interface PresetItem {
  name: string;
  category: ChecklistCategory;
  reset_type: ResetType;
}

export const PRESET_ITEMS: PresetItem[] = [
  // 일일 컨텐츠
  { name: "일일 보스 (자유/카오스 등)", category: "daily", reset_type: "daily" },
  { name: "심볼 일일 (아케인/어센틱)", category: "daily", reset_type: "daily" },
  { name: "몬스터파크", category: "daily", reset_type: "daily" },
  { name: "유니온 출석/배치", category: "daily", reset_type: "daily" },
  { name: "일일 의뢰 (소멸의 여로 등)", category: "daily", reset_type: "daily" },

  // 주간 퀘스트 (월요일 초기화)
  { name: "무릉도장", category: "weekly", reset_type: "weekly_mon" },
  { name: "주간 의뢰 (에르다 등)", category: "weekly", reset_type: "weekly_mon" },
  { name: "플래그 레이스 / 길드 컨텐츠", category: "weekly", reset_type: "weekly_mon" },

  // 주간 보스 (목요일 초기화)
  { name: "주간 윌", category: "boss", reset_type: "weekly_thu" },
  { name: "주간 루시드", category: "boss", reset_type: "weekly_thu" },
  { name: "주간 데미안", category: "boss", reset_type: "weekly_thu" },
  { name: "주간 검은 마법사", category: "boss", reset_type: "weekly_thu" },
  { name: "하드 스우 / 듄켈", category: "boss", reset_type: "weekly_thu" },
  { name: "선택 아케인 (진힐라 등)", category: "boss", reset_type: "weekly_thu" },
];

export const CATEGORY_LABEL: Record<ChecklistCategory, string> = {
  daily: "일일 컨텐츠",
  weekly: "주간 퀘스트",
  boss: "주간 보스",
};

export const CATEGORY_ORDER: ChecklistCategory[] = ["daily", "weekly", "boss"];
