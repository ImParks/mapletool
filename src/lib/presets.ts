// 신규 사용자 가입 시 기본으로 채워지는 체크리스트 프리셋.
// daily/weekly 항목은 "코드 프리셋"(안정적 id 보유), 주간 보스 항목은 DB(boss_presets)로
// 이관되었다. 완료 기록(completions)/소요시간(quest_durations)/보스선택(character_boss_selection)의
// item_id(text)는 이 코드 id(d1..d5, w1..w3) 또는 boss_presets.id(b1..)와 매칭된다.
import type { ResetType } from "./period";

export type ChecklistCategory = "daily" | "weekly" | "boss";

export interface PresetItem {
  /** 안정적 항목 식별자. completions/quest_durations 등의 item_id(text)와 매칭. */
  id: string;
  name: string;
  category: ChecklistCategory;
  reset_type: ResetType;
  /**
   * 넥슨 스케줄러 API(daily_contents/weekly_contents) 원문 콘텐츠명과의 1:1 매칭 후보.
   * scheduler-state.ts의 findContentMatch가 이 배열 중 정규화(normalizeName) 기준 정확히
   * 일치하는 항목을 찾는다. **반드시 실제 콘텐츠 1개를 가리키는 항목에만 채운다** — d1/d2/d4/d5,
   * w2/w3처럼 여러 콘텐츠를 묶은 그룹 라벨에는 절대 채우지 않는다(오매칭 위험 — b5/b7 분리와
   * 동일한 이유, boss_preset_nexon_match.sql 참고).
   */
  nexonMatch?: string[];
}

// daily/weekly 코드 프리셋. boss(category "boss") 항목은 boss_presets(DB)에서 관리하므로 여기 없음.
// UI는 이 목록(일일/주간)에 boss_presets 조회 결과(주간 보스)를 합쳐 CATEGORY_ORDER 순으로 표시한다.
export const PRESET_ITEMS: PresetItem[] = [
  // 일일 컨텐츠 (매일 00시 초기화)
  { id: "d1", name: "일일 보스 (자유/카오스 등)", category: "daily", reset_type: "daily" },
  { id: "d2", name: "심볼 일일 (아케인/어센틱)", category: "daily", reset_type: "daily" },
  { id: "d3", name: "몬스터파크", category: "daily", reset_type: "daily", nexonMatch: ["몬스터파크"] },
  { id: "d4", name: "유니온 출석/배치", category: "daily", reset_type: "daily" },
  { id: "d5", name: "일일 의뢰 (소멸의 여로 등)", category: "daily", reset_type: "daily" },

  // 주간 퀘스트 (월요일 초기화)
  { id: "w1", name: "무릉도장", category: "weekly", reset_type: "weekly_mon", nexonMatch: ["무릉도장"] },
  { id: "w2", name: "주간 의뢰 (에르다 등)", category: "weekly", reset_type: "weekly_mon" },
  { id: "w3", name: "플래그 레이스 / 길드 컨텐츠", category: "weekly", reset_type: "weekly_mon" },
];

export const CATEGORY_LABEL: Record<ChecklistCategory, string> = {
  daily: "일일 컨텐츠",
  weekly: "주간 퀘스트",
  boss: "주간 보스",
};

export const CATEGORY_ORDER: ChecklistCategory[] = ["daily", "weekly", "boss"];
