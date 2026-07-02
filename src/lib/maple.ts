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
  params?: Record<string, string | undefined>
): Promise<T> {
  const url = new URL(BASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "x-nxopen-api-key": apiKey },
    // 넥슨 데이터는 자주 바뀌지 않으므로 짧게 캐싱
    next: { revalidate: 60 },
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
  /** 현재 완료 횟수/점수 */
  now_count: number;
  /** 최대 완료 가능 횟수/점수 */
  max_count: number;
  /** 퀘스트 진행 상태 ("0":기타, "1":진행 중, "2":완료) */
  quest_state: string;
}

/** 스케줄러 보스 콘텐츠 항목 */
export interface SchedulerBoss {
  /** 보스 명 */
  content_name: string;
  /** 보스 난이도 */
  difficulty: string;
  /** 보스 초기화 주기 */
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
  /** 조회 기준일 (YYYY-MM-DD). 미접속 등으로 응답이 비면 null일 수 있음 */
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

/** 캐릭터 기본 정보 (2023-12-21 데이터부터 조회 가능). date는 KST YYYY-MM-DD. */
export function getCharacterBasic(apiKey: string, ocid: string, date?: string) {
  return request<CharacterBasic>(apiKey, "/maplestory/v1/character/basic", {
    ocid,
    date,
  });
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
 * 해당 기준일에 미접속이면 응답 결과가 비어 있을 수 있다(date 미지정 시 오늘).
 */
export function getCharacterState(apiKey: string, ocid: string, date?: string) {
  return request<CharacterStateResponse>(
    apiKey,
    "/maplestory/v1/scheduler/character-state",
    { ocid, date }
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
