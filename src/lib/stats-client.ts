// /api/characters/[ocid]/stats 호출 공용 헬퍼(클라이언트 전용 fetch).
// 호버 상태창(MainScreenClient)과 보스 선택 편집(BossEditDialog)이 같은 라우트를
// 각자 fetch/파싱하던 것을 한곳으로 모았다. 응답에는 계산된 수치만 있고 키 원문은 없다.

export interface CharacterStatsResult {
  combatPower: number | null;
  arcaneForce: number;
  authenticForce: number;
}

/** 성공 시 수치, 실패(비로그인/키 미등록/넥슨 오류/네트워크) 시 null. */
export async function fetchCharacterStats(ocid: string): Promise<CharacterStatsResult | null> {
  try {
    const res = await fetch(`/api/characters/${ocid}/stats`);
    const data: { combatPower?: number | null; arcaneForce?: number; authenticForce?: number; error?: string } =
      await res.json();
    if (!res.ok || data.error) return null;
    return {
      combatPower: data.combatPower ?? null,
      arcaneForce: data.arcaneForce ?? 0,
      authenticForce: data.authenticForce ?? 0,
    };
  } catch {
    return null;
  }
}
