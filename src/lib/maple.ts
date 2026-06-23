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

/** 캐릭터 기본 정보 */
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
