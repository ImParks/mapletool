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
import type { ResetType } from "./period";

/** 넥슨 콘텐츠 종류 */
export type SchedulerContentType = "contents" | "quest";

/**
 * 넥슨 스케줄러가 쓰는 보스 난이도 값 전체(실측 확정 — 캐릭터 12명 표본에서 이 5개만 관측됨).
 * **영문 소문자다.** 관리자 화면의 난이도 입력을 자유 텍스트가 아니라 이 목록의 선택지로
 * 제한하는 데 쓴다 — 예전에는 자유 입력이었고 문서 예시가 한글 '하드' 여서 DB 에 한글이
 * 들어갔고, 그 결과 findBossMatch 가 단 한 건도 매칭하지 못했다.
 *
 * 넥슨이 새 난이도를 추가할 수 있으므로 DB 에 값 열거 CHECK 제약은 걸지 않는다(걸면
 * discover_boss_preset 이 통째로 막힌다). 여기는 어디까지나 사람 입력용 선택지다.
 */
export const NEXON_BOSS_DIFFICULTIES = ["easy", "normal", "hard", "chaos", "extreme"] as const;

/**
 * 넥슨 응답으로 내린 완료 판정.
 *
 * **"unknown"(판정 불가)을 "not_done"(미완료)과 반드시 구분한다** — 예전에는 boolean 하나라
 * 판정할 수 없는 항목까지 전부 "미완료"로 뭉갰고, 그 결과 사용자가 수동 체크해둔 항목마다
 * "게임에서는 아직 미완료로 표시돼요" 라는 **넥슨이 하지도 않은 말**을 지어내 통보했다.
 * 실측 근거: `[길드] 지하 수로` 는 now_count=10144, max_count=0 으로 온다 — max 가 0 인
 * 콘텐츠의 now 는 완료 횟수가 아니라 점수라서 어떤 값으로도 완료를 판정할 수 없다.
 */
export type DoneState = "done" | "not_done" | "unknown";

/** 정규화된 일일/주간 콘텐츠 항목 */
export interface NormalizedContent {
  /** 콘텐츠/퀘스트 명 (넥슨 원문) */
  name: string;
  /** 종류 ('contents' | 'quest', 그 외 값은 원문 그대로 보존) */
  type: SchedulerContentType | string;
  /** 인게임 스케줄러 등록 여부 */
  registered: boolean;
  /**
   * 완료 판정 (퀘스트는 quest_state, 콘텐츠는 now>=max). 판정 근거가 없으면 "unknown".
   * 필드명이 예전 `done: boolean` 에서 바뀐 것은 의도적이다 — 이름을 그대로 두면
   * `if (c.done)` 같은 truthy 검사가 "not_done"/"unknown" 모두에서 참이 되어 조용히
   * 오작동한다. 이름을 바꿔 모든 소비처가 컴파일 에러로 드러나게 했다.
   */
  doneState: DoneState;
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
  /** 보스 난이도 (넥슨 원문 — 영문 소문자: easy/normal/hard/chaos/extreme) */
  difficulty: string;
  /** 보스 초기화 주기 (넥슨 원문: bossDaily / bossWeekly / bossMonthly) */
  cycle: string;
  /**
   * cycle 을 우리 ResetType 으로 옮긴 값. 넥슨이 모르는 주기를 내려주면 null
   * (호출부는 null 이면 보수적으로 건너뛴다 — 틀린 주기로 완료를 기록하면 초기화 시점이
   * 어긋나 사용자가 숙제를 빼먹는다).
   */
  resetType: ResetType | null;
  /** 리스트 순서 */
  order: number;
  /** 인게임 스케줄러 등록 여부 */
  registered: boolean;
  /**
   * 처치 완료 여부. 콘텐츠(doneState)와 달리 boolean 인 이유: 보스는 complete_flag 가
   * 항상 "true"/"false" 로 명시돼 판정 불가 상태가 없다. 넥슨이 아예 모르는 보스는
   * boss_contents 에 행 자체가 없어 findBossMatch 가 null 을 돌려주므로 "판정 불가"는
   * 매칭 실패(unmatched)로 표현된다.
   */
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
  /**
   * 이 캐릭터에 보스 데이터가 존재하는지. false 면 넥슨이 이 캐릭터의 보스를 아무것도
   * 모르는 상태라 "미완료"가 아니라 "판정 불가"다.
   * 실측: 인게임 스케줄러를 쓴 적 없는 캐릭터는 날짜와 무관하게 boss_contents=[] 이고
   * weekly_boss_clear_limit_count=0 이다(Lv.260 캐릭터도 그랬다).
   */
  hasBossData: boolean;
  /**
   * 조회 기준일에 이 캐릭터의 **일일** 스냅샷이 존재하는지.
   * 실측: 그날 접속하지 않은 캐릭터는 daily_contents 에 몬스터파크 1개만 오고
   * cycle="bossDaily" 항목이 통째로 빠진다(접속한 날은 daily 18개 + bossDaily 24개).
   * 같은 캐릭터라도 날짜에 따라 달라지므로 캐릭터 속성이 아니라 그날의 상태다.
   */
  hasDailyData: boolean;
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
 *  - 퀘스트(type==='quest'): quest_state가 권위 있는 신호 → "2"=완료, "0"/"1"=미완료.
 *    (실측상 퀘스트도 now/max 를 가질 수 있다 — 예: `[일일 퀘스트] 세르니움 조사` 가
 *     now=0/max=100/state="1". 그래도 완료 판정은 quest_state 만 따른다.)
 *    quest_state 가 비어 있으면 근거가 없으므로 "unknown".
 *  - 그 외 콘텐츠: max>0 일 때만 now>=max 로 판정하고, **max===0 이면 "unknown"**.
 *    max===0 인 콘텐츠(에픽 던전 3종/무릉도장/[길드] 지하 수로/[길드] 플래그 레이스)의
 *    now 는 완료 횟수가 아니다 — `[길드] 지하 수로` 가 now=10144(점수), `에픽 던전 : 악몽선경`
 *    이 now=5>max=0 으로 온다. 여기서 "now>0 이면 완료"로 뭉개면 무릉도장 1층만 찍고 나와도
 *    완료가 되므로, 오매칭보다 수동 체크가 안전하다는 이 파일의 보수적 정책(아래 findContentMatch
 *    주석)에 따라 판정을 포기한다.
 * quest_state는 enum 문자열이라 누락/공백("2 " 등)에 대비해 trim 후 비교한다
 * (parseFlag/normalizeName과 동일한 방어).
 */
function contentDoneState(c: SchedulerContent): DoneState {
  if (c.type === "quest") {
    const state = (c.quest_state ?? "").trim();
    if (state === "") return "unknown";
    return state === "2" ? "done" : "not_done";
  }
  const max = c.max_count ?? 0;
  if (max <= 0) return "unknown";
  return (c.now_count ?? 0) >= max ? "done" : "not_done";
}

/**
 * 넥슨의 보스 초기화 주기(cycle)를 우리 ResetType 으로 옮긴다.
 * 실측 확정: bossDaily / bossWeekly / bossMonthly 3종.
 *
 * **주기는 보스 이름이 아니라 (이름, 난이도) 쌍에 종속된다** — 자쿰/매그너스/파풀라투스/
 * 피에르/반반/블러디퀸/벨룸은 낮은 난이도가 bossDaily, 높은 난이도가 bossWeekly 다
 * (예: 자쿰 easy·normal=일일, 자쿰 chaos=주간). 이름만으로 주기를 역추정하면 틀린다.
 *
 * 모르는 값이면 null — 넥슨이 새 주기를 추가했을 때 아무 주기로나 단정해 완료를 잘못된
 * 초기화 시점에 묶는 것보다, 자동 판정을 포기하고 수동 체크로 남기는 쪽이 안전하다.
 */
export function bossCycleToResetType(cycle: string | undefined | null): ResetType | null {
  switch (String(cycle ?? "").trim()) {
    case "bossDaily":
      return "daily";
    case "bossWeekly":
      return "weekly_thu";
    case "bossMonthly":
      return "monthly";
    default:
      return null;
  }
}

function toContent(c: SchedulerContent): NormalizedContent {
  return {
    name: c.content_name,
    type: c.type,
    registered: parseFlag(c.registration_flag),
    doneState: contentDoneState(c),
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
    resetType: bossCycleToResetType(b.cycle),
    order: b.list_order_no ?? 0,
    registered: parseFlag(b.registration_flag),
    done: parseFlag(b.complete_flag),
  };
}

/**
 * 넥슨 스케줄러 응답을 정규화한다.
 * 미접속 등으로 필드가 비거나 누락돼도 안전하게(빈 배열/0) 처리한다.
 *
 * 예전에는 "세 배열이 모두 비었는가"를 `empty` 플래그로 내보냈는데, 실측 결과 **그 조건은
 * 절대 성립하지 않는다** — 데이터가 없는 캐릭터도 daily_contents 1개(몬스터파크)와
 * weekly_contents 6개는 항상 받는다. 쓸모없는 플래그 대신 실제로 판별 가능한 두 신호
 * (hasBossData / hasDailyData)를 내보낸다.
 */
export function normalizeCharacterState(
  state: CharacterStateResponse
): NormalizedSchedulerState {
  const daily = (state.daily_contents ?? []).map(toContent);
  const weekly = (state.weekly_contents ?? []).map(toContent);
  const boss = (state.boss_contents ?? [])
    .map(toBoss)
    .sort((a, b) => a.order - b.order);

  const clearLimit = state.weekly_boss_clear_limit_count ?? 0;

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
      limit: clearLimit,
    },
    hasBossData: boss.length > 0 || clearLimit > 0,
    // 일일 스냅샷의 유일하게 신뢰할 수 있는 신호. daily_contents 길이로 판단하지 않는 이유는
    // 미접속일에도 몬스터파크 1개가 항상 오기 때문이다(길이 기준이면 임계값을 손으로 정해야 한다).
    hasDailyData: boss.some((b) => b.cycle === "bossDaily"),
  };
}

/**
 * daily/weekly 콘텐츠 정밀 매칭. 후보 이름 배열(`PresetItem.nexonMatch` 또는
 * `quest_presets.nexon_content_name` 1개짜리 배열) 중 하나라도 `normalizeName` 기준
 * **정확히 일치**하는 콘텐츠를 `contents`(state.daily 또는 state.weekly)에서 찾는다.
 *
 * 매칭 정책(보수적): 잘못된 자동 체크(오매칭)보다 매칭 실패 시 수동 체크로 남기는 쪽이
 * 안전하다(하이브리드 원칙). 후보가 여러 개면 배열 순서대로 먼저 찾은 것을 반환한다.
 *
 * @returns 매칭된 콘텐츠, 후보가 비어있거나 매칭 실패 시 `null`.
 */
export function findContentMatch(
  contents: NormalizedContent[],
  candidates: string[]
): NormalizedContent | null {
  const targets = candidates.map(normalizeName).filter((t) => t !== "");
  if (targets.length === 0) return null;

  for (const c of contents) {
    if (targets.includes(normalizeName(c.name))) return c;
  }
  return null;
}

/**
 * 보스 콘텐츠 정밀 매칭. `content_name`+`difficulty`가 둘 다 `normalizeName` 기준
 * 정확히 일치하고 **`registered === true`**인 항목만 매칭으로 인정한다(registered 조건은
 * 오매칭 방지용 추가 안전장치 — 인게임 스케줄러에 등록 안 된 보스까지 이름만으로 매칭돼
 * 잘못 완료 처리되는 걸 막는다).
 *
 * @returns 매칭된 보스, 매칭 실패 시 `null`.
 */
export function findBossMatch(
  bosses: NormalizedBoss[],
  contentName: string,
  difficulty: string
): NormalizedBoss | null {
  const targetName = normalizeName(contentName);
  const targetDifficulty = normalizeName(difficulty);
  if (targetName === "" || targetDifficulty === "") return null;

  for (const b of bosses) {
    if (b.registered && normalizeName(b.name) === targetName && normalizeName(b.difficulty) === targetDifficulty) {
      return b;
    }
  }
  return null;
}
