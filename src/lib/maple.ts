// 넥슨 메이플스토리 OpenAPI 클라이언트 (서버 전용)
// 문서: https://openapi.nexon.com/game/maplestory/

const BASE_URL = "https://open.api.nexon.com";

export class MapleApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "MapleApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  apiKey: string,
  path: string,
  params?: Record<string, string | undefined>,
  // 엔드포인트 특성에 맞는 캐시 주기(초). 기본 60초 — 자주 안 바뀌는 응답(기본정보 등)은
  // 호출부에서 더 길게 지정해 레이트리밋(개발단계 5건/초) 소모를 줄인다.
  // 캐시 키에는 URL과 헤더(x-nxopen-api-key)가 포함되므로 사용자 간 응답이 섞이지 않는다.
  revalidate: number = 60
): Promise<T> {
  const url = new URL(BASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "x-nxopen-api-key": apiKey },
    next: { revalidate },
  });

  if (!res.ok) {
    let code: string | undefined;
    let message = `넥슨 API 오류 (${res.status})`;
    try {
      const body = await res.json();
      code = body?.error?.name;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // ignore parse error
    }
    if (res.status === 401 || res.status === 403) {
      message = "API 키가 유효하지 않거나 권한이 없습니다. 설정에서 키를 확인해 주세요.";
    }
    throw new MapleApiError(message, res.status, code);
  }

  return res.json() as Promise<T>;
}

// ---- 응답 타입 ----

export interface AccountCharacter {
  ocid: string;
  character_name: string;
  world_name: string;
  character_class: string;
  character_level: number;
}

export interface CharacterListResponse {
  account_list: {
    account_id: string;
    character_list: AccountCharacter[];
  }[];
}

export interface CharacterBasic {
  date: string | null;
  character_name: string;
  world_name: string;
  character_gender: string;
  character_class: string;
  character_class_level: string;
  character_level: number;
  character_exp: number;
  character_exp_rate: string;
  character_guild_name: string | null;
  character_image: string;
  /** 캐릭터 생성일 (KST ISO, 예: "2023-12-21T00:00+09:00") */
  character_date_create: string | null;
  /** 최근 7일 이내 접속 여부 ("true" | "false") */
  access_flag: string;
  /** 해방(제네시스 무기) 퀘스트 완료 여부 ("true" | "false") */
  liberation_quest_clear: string;
}

export interface StatEntry {
  stat_name: string;
  stat_value: string;
}

export interface CharacterStat {
  date: string | null;
  character_class: string;
  final_stat: StatEntry[];
  remain_ap: number;
}

/** 스케줄러 일일/주간 콘텐츠 항목 (content_state 응답 내 contents/quest) */
export interface SchedulerContent {
  /** 콘텐츠/퀘스트 명 */
  content_name: string;
  /** 타입 ('contents' | 'quest') */
  type: string;
  /** 인게임 스케줄러 등록 여부 ("true" | "false") */
  registration_flag: string;
  /**
   * 현재 완료 횟수/점수. **max_count 가 0 이면 완료 횟수가 아니다** — `[길드] 지하 수로` 는
   * now_count=10144(점수), `에픽 던전 : 악몽선경` 은 now=5 > max=0 으로 온다.
   */
  now_count: number;
  /**
   * 최대 완료 가능 횟수/점수. **0 이 흔하다**(에픽 던전 3종/무릉도장/[길드] 지하 수로/
   * [길드] 플래그 레이스). 0 이면 now/max 로 완료를 판정할 수 없다 — scheduler-state.ts 가
   * "unknown"(판정 불가)으로 처리한다.
   */
  max_count: number;
  /**
   * 퀘스트 진행 상태 ("0":기타, "1":진행 중, "2":완료). 세 값 모두 실측 확인됨.
   * **type==="contents" 면 이 필드가 null 로 온다**(빈 문자열이 아니다).
   */
  quest_state: string | null;
}

/** 스케줄러 보스 콘텐츠 항목 */
export interface SchedulerBoss {
  /** 보스 명 */
  content_name: string;
  /**
   * 보스 난이도. **영문 소문자**: "easy" | "normal" | "hard" | "chaos" | "extreme"
   * (한글 '하드'가 아니다 — 이 착각이 boss_presets.nexon_difficulty 에 한글을 넣어
   * 자동 매칭을 통째로 무력화시킨 적이 있다).
   * 같은 보스가 난이도별로 별도 행이다(스우 normal/hard/extreme = 3행).
   */
  difficulty: string;
  /**
   * 보스 초기화 주기: "bossDaily" | "bossWeekly" | "bossMonthly" (실측 확정).
   * **주기는 이름이 아니라 (이름, 난이도) 쌍에 종속된다** — 자쿰 easy·normal 은 bossDaily,
   * 자쿰 chaos 는 bossWeekly 다(매그너스/파풀라투스/피에르/반반/블러디퀸/벨룸도 동일).
   * bossMonthly 는 현재 검은 마법사(hard/extreme)뿐이다.
   */
  cycle: string;
  /** 리스트 순서 */
  list_order_no: number;
  /** 인게임 스케줄러 등록 여부 ("true" | "false") */
  registration_flag: string;
  /** 완료 여부 ("true" | "false") */
  complete_flag: string;
}

/**
 * 캐릭터 스케줄러 수행 현황 (GET /scheduler/character-state).
 * 타입은 넥슨 SUCCESS(200) 스키마 기준. 단 미접속 기준일이면 응답 결과가 비어 있을 수 있어
 * 런타임 본문이 희소(배열 누락/빈 배열)할 수 있으므로, 해석은 scheduler-state.ts의
 * normalizeCharacterState()가 방어적으로(빈 배열·0 기본값) 처리한다.
 */
export interface CharacterStateResponse {
  /**
   * 조회 기준일. **YYYY-MM-DD 가 아니라 ISO datetime 이다** — 실측값 예:
   * "2026-07-29T00:00+09:00". 날짜만 필요하면 앞 10자를 자를 것.
   */
  date: string | null;
  character_name: string;
  world_name: string;
  character_level: number;
  character_class: string;
  /** 일일 콘텐츠 정보 (미접속 시 비어 있을 수 있음) */
  daily_contents: SchedulerContent[];
  /** 주간 콘텐츠 정보 (미접속 시 비어 있을 수 있음) */
  weekly_contents: SchedulerContent[];
  /** 보스 콘텐츠 정보 (미접속 시 비어 있을 수 있음) */
  boss_contents: SchedulerBoss[];
  /** 주간 보스 처치 완료 횟수 */
  weekly_boss_clear_count: number;
  /** 주간 보스 처치 제한 횟수 */
  weekly_boss_clear_limit_count: number;
}

/** 장착 심볼 항목 (아케인/어센틱 공통). 수치 필드는 문자열이므로 숫자 연산 전 변환 필요 */
export interface SymbolEquipmentEntry {
  /** 심볼 명 (예: "아케인심볼 : 소멸의 여로") */
  symbol_name: string;
  /** 심볼 아이콘 URL */
  symbol_icon: string;
  /** 심볼 설명 */
  symbol_description: string;
  /** 심볼 부가 효과 설명 */
  symbol_other_effect_description: string;
  /** 심볼로 인한 증가 수치(포스/아케인포스 등) */
  symbol_force: string;
  /** 심볼 레벨 */
  symbol_level: number;
  /** 심볼로 증가한 힘 */
  symbol_str: string;
  /** 심볼로 증가한 민첩 */
  symbol_dex: string;
  /** 심볼로 증가한 지력 */
  symbol_int: string;
  /** 심볼로 증가한 운 */
  symbol_luk: string;
  /** 심볼로 증가한 체력 */
  symbol_hp: string;
  /** 심볼로 증가한 아이템 드롭률 */
  symbol_drop_rate: string;
  /** 심볼로 증가한 메소 획득량 */
  symbol_meso_rate: string;
  /** 심볼로 증가한 경험치 획득량 */
  symbol_exp_rate: string;
  /** 현재 보유 성장치 */
  symbol_growth_count: number;
  /** 다음 레벨까지 필요한 성장치 */
  symbol_require_growth_count: number;
}

/** 장착 심볼 정보 (GET /character/symbol-equipment). 아케인+어센틱을 모두 포함 */
export interface CharacterSymbolEquipment {
  date: string | null;
  character_class: string;
  /** 장착한 심볼 목록 (미착용 시 비어 있을 수 있음) */
  symbol: SymbolEquipmentEntry[];
}

// ---- API 메서드 ----

/** 계정에 연결된 전체 캐릭터 목록 조회 */
export function getCharacterList(apiKey: string) {
  return request<CharacterListResponse>(apiKey, "/maplestory/v1/character/list");
}

/** 캐릭터명으로 ocid 조회 */
export function getOcid(apiKey: string, characterName: string) {
  return request<{ ocid: string }>(apiKey, "/maplestory/v1/id", {
    character_name: characterName,
  });
}

/**
 * 캐릭터 기본 정보 (2023-12-21 데이터부터 조회 가능). date는 KST YYYY-MM-DD.
 * 넥슨 데이터 자체가 일 단위 스냅샷이라 1시간 캐시 — 캐릭터가 많은 계정의 메인 화면 진입 시
 * 레이트리밋(개발단계 5건/초) 소모를 줄인다(레벨 등 최신값은 character/list 쪽 60초 캐시가 담당).
 */
export function getCharacterBasic(apiKey: string, ocid: string, date?: string) {
  return request<CharacterBasic>(
    apiKey,
    "/maplestory/v1/character/basic",
    { ocid, date },
    3600
  );
}

/** 캐릭터 종합 스탯 */
export function getCharacterStat(apiKey: string, ocid: string, date?: string) {
  return request<CharacterStat>(apiKey, "/maplestory/v1/character/stat", {
    ocid,
    date,
  });
}

/**
 * 캐릭터 스케줄러(일일/주간/보스) 수행 현황 조회.
 * 계정 귀속 API — API 키 소유 계정의 캐릭터만 조회 가능하며, 남의 ocid는 403을 반환한다.
 *
 * **date 를 넘기지 말 것(실측 확인).** 이 엔드포인트만 date 규칙이 다르다:
 *  - date 미지정 → 200, **오늘 데이터**. 이게 유일한 "오늘" 조회 방법이다.
 *  - date=오늘 날짜 → **400 (OPENAPI00004)**. 다른 엔드포인트처럼 KST 오늘 날짜를 계산해
 *    넣으면 100% 실패한다.
 *  - date=미래 → 400. date=어제 ~ 13일 전 → 200. 14일 전부터 다시 400.
 * date 파라미터는 과거 조회(백필)용으로만 남겨둔다.
 *
 * **캐시 0초**: 이 응답은 스냅샷이 아니라 **실시간**이다(방금 잡은 보스가 즉시
 * complete_flag="true" 로 반영되는 것을 확인했다). 기본값 60초를 쓰면 "보스 잡고 바로
 * 동기화했는데 미완료로 뜬다"가 되고, 그 증상은 완료 판정 버그와 사용자 눈에 구별되지 않아
 * 원인 추적이 매우 어려워진다. 대신 넥슨 레이트리밋(개발단계 초당 5건/일 1000건)을 그대로
 * 받으므로, 호출은 캐릭터 1건 단위 "숙제 동기화" 에서만 일어나야 한다.
 *
 * 기준일에 미접속이면 일일 데이터(daily_contents 대부분 + cycle="bossDaily" 보스)가 통째로
 * 빠진 채 응답이 온다. 응답이 완전히 비지는 않으므로 "빈 응답" 으로는 판별할 수 없다 —
 * scheduler-state.ts 의 hasDailyData/hasBossData 를 쓸 것.
 */
export function getCharacterState(apiKey: string, ocid: string, date?: string) {
  return request<CharacterStateResponse>(
    apiKey,
    "/maplestory/v1/scheduler/character-state",
    { ocid, date },
    0
  );
}

/** 장착 심볼(아케인/어센틱) 정보 (2023-12-21~). date는 KST YYYY-MM-DD. */
export function getCharacterSymbolEquipment(
  apiKey: string,
  ocid: string,
  date?: string
) {
  return request<CharacterSymbolEquipment>(
    apiKey,
    "/maplestory/v1/character/symbol-equipment",
    { ocid, date }
  );
}
