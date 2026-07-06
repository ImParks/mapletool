"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCharacterList, type AccountCharacter } from "@/lib/maple";
import { warmUpCharacter } from "@/lib/warmup";
import type { ActionResult } from "@/lib/action-result";

export interface NexonKeyState {
  error: string | null;
  success: boolean;
}

// 워밍업(전체 캐릭터 순차 조회) 사이의 딜레이. 넥슨 개발단계 키의 초당 5건 제한을 안전하게
// 피하기 위해 "동시성 제한"이 아니라 "순차 + 딜레이"로 처리한다(src/lib/async.ts 의
// mapWithConcurrency 는 여기 목적에 맞지 않아 재사용하지 않는다).
const WARMUP_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 넥슨 API 키 등록/교체. getCharacterList 로 실제 조회가 되는지 검증한 뒤 user_secrets 에
 * upsert 하고, 이어서 계정 전체 캐릭터를 순차(딜레이 포함)로 워밍업한다(최초 연결 시 전체
 * 스냅샷/숙제 현황을 미리 채워, 이후 페이지 진입에서는 넥슨을 전혀 호출하지 않게 한다).
 * 넥슨 원본 에러 텍스트는 그대로 노출하지 않는다(민감할 수 있음). 캐릭터 하나의 워밍업이
 * 실패해도 다음 캐릭터로 계속 진행한다(부분 실패 허용 — 실패한 캐릭터는 이후 캐릭터별
 * "동기화"/"숙제 동기화" 버튼으로 개별 재시도 가능).
 */
export async function saveNexonKey(_prevState: NexonKeyState, formData: FormData): Promise<NexonKeyState> {
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!apiKey) {
    return { error: "API 키를 입력해 주세요.", success: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "로그인이 필요합니다.", success: false };
  }

  let accountChars: AccountCharacter[];
  try {
    const characterList = await getCharacterList(apiKey);
    accountChars = characterList.account_list.flatMap((a) => a.character_list);
  } catch {
    return { error: "API 키가 유효하지 않습니다. 키를 다시 확인해 주세요.", success: false };
  }

  const { error } = await supabase
    .from("user_secrets")
    .upsert({ user_id: user.id, nexon_api_key: apiKey, nexon_key_valid: true }, { onConflict: "user_id" });

  if (error) {
    return { error: "키 저장 중 오류가 발생했습니다.", success: false };
  }

  for (const c of accountChars) {
    try {
      await warmUpCharacter(supabase, apiKey, user.id, c.ocid);
    } catch {
      // 캐릭터 하나 실패해도 전체 등록 자체는 성공으로 처리한다(개별 재시도 가능).
    }
    await sleep(WARMUP_DELAY_MS);
  }

  revalidatePath("/main");
  return { error: null, success: true };
}

/** 등록된 넥슨 API 키 삭제(행 자체를 삭제). */
export async function deleteNexonKey(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "로그인이 필요합니다." };
  }

  const { error } = await supabase.from("user_secrets").delete().eq("user_id", user.id);
  if (error) {
    return { error: "삭제 중 오류가 발생했습니다." };
  }

  revalidatePath("/main");
  return { error: null };
}

interface CachedOcidRow {
  ocid: string;
}

/**
 * 상단바 "캐릭터 동기화" 아이콘 버튼용 액션. getCharacterList 를 1회만 호출해 이름/레벨/직업/
 * 월드만 가볍게 갱신하고(캐릭터당 추가 호출 없음), character_cache 에 아직 없는(계정에 새로
 * 생긴) 캐릭터만 골라 그 캐릭터들에 한해서만 순차 워밍업을 돈다 — 기존 캐릭터는 이미
 * character_cache 에 스냅샷/숙제 현황이 있으므로 다시 불러오지 않는다(레이트리밋/불필요한
 * 호출 방지).
 */
export async function refreshCharacterList(): Promise<ActionResult<{ ok: true }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data: secretRow } = await supabase
    .from("user_secrets")
    .select("nexon_api_key")
    .eq("user_id", user.id)
    .maybeSingle<{ nexon_api_key: string | null }>();
  const apiKey = secretRow?.nexon_api_key;
  if (!apiKey) return { error: "넥슨 API 키가 등록되어 있지 않습니다." };

  let accountChars: AccountCharacter[];
  try {
    const characterList = await getCharacterList(apiKey);
    accountChars = characterList.account_list.flatMap((a) => a.character_list);
  } catch {
    return { error: "캐릭터 정보를 불러오지 못했습니다." };
  }

  const { data: cachedRows } = await supabase.from("character_cache").select("ocid").eq("user_id", user.id);
  const cachedOcids = new Set(((cachedRows ?? []) as CachedOcidRow[]).map((r) => r.ocid));

  // 가벼운 필드(name/world/class/level)만 upsert. 지정하지 않은 컬럼(image_url/combat_power/
  // arcane_force/authentic_force/synced_at)은 기존 행이면 그대로 유지되고, 신규 행이면 컬럼
  // 기본값(null/now())으로 채워진 뒤 아래 워밍업이 곧바로 실제 값을 채운다.
  for (const c of accountChars) {
    await supabase.from("character_cache").upsert(
      {
        user_id: user.id,
        ocid: c.ocid,
        character_name: c.character_name,
        world_name: c.world_name,
        character_class: c.character_class,
        character_level: c.character_level,
      },
      { onConflict: "user_id,ocid" }
    );
  }

  const newOcids = accountChars.map((c) => c.ocid).filter((ocid) => !cachedOcids.has(ocid));
  for (const ocid of newOcids) {
    try {
      await warmUpCharacter(supabase, apiKey, user.id, ocid);
    } catch {
      // 신규 캐릭터 워밍업 실패는 캐릭터 상세의 "동기화"/"숙제 동기화" 버튼으로 재시도 가능.
    }
    await sleep(WARMUP_DELAY_MS);
  }

  revalidatePath("/main");
  return { ok: true };
}
