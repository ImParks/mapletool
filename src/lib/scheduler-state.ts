// 넥슨 스케줄러 응답(CharacterStateResponse) → 우리 체크리스트가 소비할 수 있는
// "정규화된 완료 현황"으로 변환하는 순수 모듈.
//
// 역할 경계:
//  - 이 모듈은 넥슨 응답의 "완료 의미"만 해석한다(이게 done인가? 진행도는?).
//  - period_key 계산(완료 기록 저장/리셋)은 period.ts, 화면은 src/app 담당.
//  - 어떤 콘텐츠가 일일/주간/보스인지의 "목록"은 넥슨이 내려준 응답을 그대로 따르며,
//    여기에 콘텐츠 이름을 하드코딩하지 않는다(패치마다 바뀜).
//
// 서버 전용 모듈인 maple.ts에서 "타입만" import 하므로(import type),
// 이 파일 자체는 순수 모듈이라 서버·클라이언트 양쪽에서 import 가능하다.
import type {
  CharacterStateResponse,
  SchedulerContent,
  SchedulerBoss,
} from "./maple";

/** 넥슨 콘텐츠 종류 */
export type SchedulerContentType = "contents" | "quest";

/** 정규화된 일일/주간 콘텐츠 항목 */
export interface NormalizedContent {
  /** 콘텐츠/퀘스트 명 (넥슨 원문) */
  name: string;
  /** 종류 ('contents' | 'quest', 그 외 값은 원문 그대로 보존) */
  type: SchedulerContentType | string;
  /** 인게임 스케줄러 등록 여부 */
  registered: boolean;
  /** 완료 여부 (퀘스트는 quest_state, 콘텐츠는 now>=max로 판정) */
  done: boolean;
  /** 현재 완료 횟수/점수 */
  now: number;
  /** 최대 완료 가능 횟수/점수 */
  max: number;
  /** 퀘스트 진행 상태 ("0":기타, "1":진행 중, "2":완료). 콘텐츠면 빈 문자열일 수 있음 */
  questState: string;
}

/** 정규화된 보스 콘텐츠 항목 */
export interface NormalizedBoss {
  /** 보스 명 (넥슨 원문) */
  name: string;
  /** 보스 난이도 */
  difficulty: string;
  /** 보스 초기화 주기 (넥슨 원문) */
  cycle: string;
  /** 리스트 순서 */
  order: number;
  /** 인게임 스케줄러 등록 여부 */
  registered: boolean;
  /** 처치 완료 여부 */
  done: boolean;
}

/** 정규화된 스케줄러 현황 전체 */
export interface NormalizedSchedulerState {
  /** 조회 기준일 (YYYY-MM-DD) 또는 null */
  date: string | null;
  characterName: string;
  worldName: string;
  level: number;
  job: string;
  daily: NormalizedContent[];
  weekly: NormalizedContent[];
  /** list_order_no 오름차순 정렬됨 */
  boss: NormalizedBoss[];
  /** 주간 보스 처치 수 / 제한 */
  weeklyBossClear: { count: number; limit: number };
  /** 일일/주간/보스가 모두 비어 있는지(미접속 등으로 응답 결과 없음) */
  empty: boolean;
}

/** 매칭 결과의 구분(어느 그룹의 항목과 매칭됐는지) */
export type SchedulerMatchKind = "daily" | "weekly" | "boss";

/** 이름 매칭으로 찾아낸 넥슨 항목의 완료 현황 */
export interface SchedulerMatch {
  kind: SchedulerMatchKind;
  name: string;
  registered: boolean;
  done: boolean;
}

/** 넥슨의 "true"/"false" 문자열 플래그를 boolean으로. 대소문자/공백 무시. */
export function parseFlag(flag: string | undefined | null): boolean {
  return String(flag ?? "").trim().toLowerCase() === "true";
}

/**
 * 이름 비교용 정규화: 공백 제거 + 소문자화.
 * 넥슨 원문과 우리 항목명을 같은 기준으로 비교하기 위한 키.
 */
export function normalizeName(name: string | undefined | null): string {
  return String(name ?? "").replace(/\s+/g, "").toLowerCase();
}

/**
 * 콘텐츠 항목의 완료 판정.
 *  - 퀘스트(type==='quest'): quest_state가 권위 있는 신호 → "2"(완료)일 때만 완료.
 *    (넥슨 응답상 퀘스트도 now/max를 함께 가질 수 있으나, 완료 판정은 quest_state를 따른다.)
 *  - 그 외 콘텐츠: now_count >= max_count (max>0) 일 때 완료.
 * quest_state는 enum 문자열이라 누락/공백("2 " 등)에 대비해 trim 후 비교한다
 * (parseFlag/normalizeName과 동일한 방어).
 */
function isContentDone(c: SchedulerContent): boolean {
  if (c.type === "quest") {
    return (c.quest_state ?? "").trim() === "2";
  }
  const max = c.max_count ?? 0;
  return max > 0 && (c.now_count ?? 0) >= max;
}

function toContent(c: SchedulerContent): NormalizedContent {
  return {
    name: c.content_name,
    type: c.type,
    registered: parseFlag(c.registration_flag),
    done: isContentDone(c),
    now: c.now_count ?? 0,
    max: c.max_count ?? 0,
    questState: c.quest_state ?? "",
  };
}

function toBoss(b: SchedulerBoss): NormalizedBoss {
  return {
    name: b.content_name,
    difficulty: b.difficulty,
    cycle: b.cycle,
    order: b.list_order_no ?? 0,
    registered: parseFlag(b.registration_flag),
    done: parseFlag(b.complete_flag),
  };
}

/**
 * 넥슨 스케줄러 응답을 정규화한다.
 * 미접속 등으로 필드가 비거나 누락돼도 안전하게(빈 배열/0) 처리한다.
 */
export function normalizeCharacterState(
  state: CharacterStateResponse
): NormalizedSchedulerState {
  const daily = (state.daily_contents ?? []).map(toContent);
  const weekly = (state.weekly_contents ?? []).map(toContent);
  const boss = (state.boss_contents ?? [])
    .map(toBoss)
    .sort((a, b) => a.order - b.order);

  return {
    date: state.date ?? null,
    characterName: state.character_name ?? "",
    worldName: state.world_name ?? "",
    level: state.character_level ?? 0,
    job: state.character_class ?? "",
    daily,
    weekly,
    boss,
    weeklyBossClear: {
      count: state.weekly_boss_clear_count ?? 0,
      limit: state.weekly_boss_clear_limit_count ?? 0,
    },
    empty:
      daily.length === 0 && weekly.length === 0 && boss.length === 0,
  };
}

/**
 * 우리 체크리스트 항목명으로 넥슨 스케줄러 현황에서 완료 상태를 찾는다.
 *
 * 매칭 정책(보수적): 이름을 공백 제거+소문자화(`normalizeName`)한 뒤
 * **정확히 일치**할 때만 매칭으로 본다. 잘못된 자동 체크(오매칭)보다,
 * 매칭 실패 시 수동 체크로 남기는 쪽이 안전하기 때문이다(하이브리드 원칙).
 * 더 느슨한 매칭이 필요하면 호출부에서 `normalizeName`을 재사용해 확장한다.
 *
 * 같은 정규화 이름이 여러 그룹에 있으면 daily → weekly → boss 순으로 먼저 찾은 것을 반환한다.
 *
 * @returns 매칭된 항목의 완료 현황, 매칭 실패 시 `null`(호출부는 수동 상태 유지).
 */
export function findSchedulerMatch(
  state: NormalizedSchedulerState,
  itemName: string
): SchedulerMatch | null {
  const target = normalizeName(itemName);
  if (target === "") return null;

  for (const c of state.daily) {
    if (normalizeName(c.name) === target) {
      return { kind: "daily", name: c.name, registered: c.registered, done: c.done };
    }
  }
  for (const c of state.weekly) {
    if (normalizeName(c.name) === target) {
      return { kind: "weekly", name: c.name, registered: c.registered, done: c.done };
    }
  }
  for (const b of state.boss) {
    if (normalizeName(b.name) === target) {
      return { kind: "boss", name: b.name, registered: b.registered, done: b.done };
    }
  }
  return null;
}
