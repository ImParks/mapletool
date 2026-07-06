// 체크리스트 항목 병합/필터링을 위한 순수 계산 헬퍼. 서버(main 페이지 서버 컴포넌트, 서버
// 액션)에서만 사용한다 — DB/넥슨 호출은 하지 않고, 호출자가 이미 조회한 데이터를 넘겨받아
// 순수 계산만 수행한다. 클라이언트 컴포넌트는 이 모듈을 import 하지 않는다: 계산에 필요한
// 원본 데이터(항목 목록/캐릭터별 완료·보스선택/소요시간)를 서버 컴포넌트가 직렬화 가능한
// props 로 내려주면, 클라이언트는 동일한 파생 계산(관련 항목/진행률/남은 시간)을 자체적으로
// 다시 수행한다(디자인 프로토타입의 renderVals() 와 동일한 패턴 — 매 렌더 파생 계산).
import { PRESET_ITEMS, CATEGORY_ORDER, type ChecklistCategory, type PresetItem } from "./presets";
import type { ResetType } from "./period";

export interface BossPreset {
  id: string;
  name: string;
  reset_type: ResetType;
  req_level: number | null;
  symbol_type: "arcane" | "authentic" | null;
  req_force: number | null;
  rec_hexa: number | null;
}

/**
 * boss_presets 의 daily/weekly 버전(quest_presets 테이블, DB). 넥슨 스케줄러에서 발견됐지만
 * 코드 프리셋(PRESET_ITEMS)에 없는 일일/주간 콘텐츠를 담는다(discover_quest_preset RPC 로 생성).
 */
export interface QuestPreset {
  id: string;
  name: string;
  category: Extract<ChecklistCategory, "daily" | "weekly">;
  reset_type: ResetType;
}

export interface ChecklistItem {
  id: string;
  name: string;
  category: ChecklistCategory;
  reset_type: ResetType;
}

/** daily/weekly 코드 프리셋 + quest_presets(DB) + boss_presets(DB) 를 CATEGORY_ORDER 순으로 합친 전체 항목 목록 */
export function buildAllItems(bossPresets: BossPreset[], questPresets: QuestPreset[]): ChecklistItem[] {
  const bossItems: ChecklistItem[] = bossPresets.map((b) => ({
    id: b.id,
    name: b.name,
    category: "boss",
    reset_type: b.reset_type,
  }));
  const questItems: ChecklistItem[] = questPresets.map((q) => ({
    id: q.id,
    name: q.name,
    category: q.category,
    reset_type: q.reset_type,
  }));
  const byCategory: Record<ChecklistCategory, ChecklistItem[]> = {
    daily: [...PRESET_ITEMS.filter((i) => i.category === "daily"), ...questItems.filter((q) => q.category === "daily")],
    weekly: [...PRESET_ITEMS.filter((i) => i.category === "weekly"), ...questItems.filter((q) => q.category === "weekly")],
    boss: bossItems,
  };
  return CATEGORY_ORDER.flatMap((cat) => byCategory[cat]);
}

/** item_id → PresetItem(daily/weekly) 조회. boss 항목은 여기 없다(호출자가 boss_presets 를 직접 조회). */
export function findPresetItem(itemId: string): PresetItem | undefined {
  return PRESET_ITEMS.find((i) => i.id === itemId);
}

/**
 * 캐릭터에게 "관련 있는" 항목만 필터링한다.
 * daily/weekly 는 항상 포함, boss 는 bossSelection 이 null(그 캐릭터에 선택 행이 하나도
 * 없음 = 전체 선택으로 간주)이거나 해당 item.id 를 포함할 때만 포함한다.
 */
export function relevantItems(allItems: ChecklistItem[], bossSelection: Set<string> | null): ChecklistItem[] {
  return allItems.filter((i) => i.category !== "boss" || bossSelection === null || bossSelection.has(i.id));
}
