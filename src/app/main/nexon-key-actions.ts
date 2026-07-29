"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCharacterList, type AccountCharacter } from "@/lib/maple";
import type { ActionResult } from "@/lib/action-result";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface NexonKeyState {
  error: string | null;
  success: boolean;
  /**
   * 등록 직후 클라이언트가 순차 워밍업할 캐릭터 ocid 목록(= character_cache 에 아직 없던 캐릭터).
   * 최초 등록이면 계정 전체가, 키 교체면 새로 생긴 캐릭터만 담긴다. 실패 시 빈 배열.
   */
  ocids: string[];
}

interface CachedOcidRow {
  ocid: string;
}

/**
 * 넥슨 계정의 현재 캐릭터 목록을 character_cache 에 반영한다(이름/월드/직업/레벨 등 가벼운
 * 필드만 — 이미지/전투력/포스는 캐릭터별 워밍업이 따로 채운다).
 *
 * 세 방향을 모두 처리한다:
 *  - 그대로 있는 캐릭터 → 가벼운 필드만 갱신(레벨업 등이 바로 보이게)
 *  - 새로 생긴 캐릭터   → 행을 만들고 ocid 를 newOcids 로 돌려준다(호출부가 워밍업)
 *  - 계정에서 사라진 캐릭터 → **하드 딜리트**. character_cache 뿐 아니라 그 캐릭터에 매달린
 *    completions / character_boss_selection 행까지 지운다(고아 행이 남으면 통계·초기화가
 *    존재하지 않는 캐릭터를 계속 센다). quest_durations 는 캐릭터가 아니라 항목 단위라 제외.
 *
 * 안전장치 2가지 — 둘 다 "사용자 데이터를 통째로 날리는" 사고를 막는다:
 *  1. accountChars 가 비어 있으면 삭제를 아예 건너뛴다(넥슨이 일시적으로 빈 목록을 돌려준 경우).
 *  2. 캐시와 계정 캐릭터가 **하나도 겹치지 않으면** 삭제를 건너뛴다(다른 계정 키로 교체한 경우).
 */
async function reconcileCharacterCache(
  supabase: SupabaseServerClient,
  userId: string,
  accountChars: AccountCharacter[]
): Promise<{ newOcids: string[] }> {
  const { data: cachedRows } = await supabase.from("character_cache").select("ocid").eq("user_id", userId);
  const cachedOcids = new Set(((cachedRows ?? []) as CachedOcidRow[]).map((r) => r.ocid));

  if (accountChars.length === 0) return { newOcids: [] };

  // 지정하지 않은 컬럼(image_url/combat_power/arcane_force/authentic_force/synced_at)은 기존
  // 행이면 그대로 유지되고, 신규 행이면 컬럼 기본값(null/now())으로 채워진 뒤 호출부의 워밍업이
  // 곧바로 실제 값을 채운다.
  for (const c of accountChars) {
    await supabase.from("character_cache").upsert(
      {
        user_id: userId,
        ocid: c.ocid,
        character_name: c.character_name,
        world_name: c.world_name,
        character_class: c.character_class,
        character_level: c.character_level,
      },
      { onConflict: "user_id,ocid" }
    );
  }

  const accountOcids = new Set(accountChars.map((c) => c.ocid));
  const removedOcids = [...cachedOcids].filter((ocid) => !accountOcids.has(ocid));

  // "캐릭터가 삭제됐다" 와 "넥슨 계정 자체가 바뀌었다" 를 구분한다.
  //
  // 겹치는 캐릭터가 하나도 없다는 건 캐릭터를 지운 게 아니라 **다른 계정의 키로 교체**했다는
  // 뜻이다(부계정 숙제를 보려고 키를 바꾸는 건 흔한 사용 패턴이다). 그 경우까지 하드 딜리트하면
  // 이전 계정에서 쌓은 완료 기록과 보스 선택이 확인 절차도 없이 영구히 사라지고, 키를 되돌려도
  // 복구되지 않는다. 캐시 행이 남아 있어도 그 캐릭터는 화면에 안 뜨므로(현재 키로 조회되지 않음)
  // 남겨두는 쪽의 손해가 훨씬 작다.
  //
  // 실제로 캐릭터를 지운 경우는 나머지 캐릭터가 그대로 남아 있어 겹침이 존재하므로 정상 삭제된다.
  const hasOverlap = [...cachedOcids].some((ocid) => accountOcids.has(ocid));
  const looksLikeAccountSwitch = cachedOcids.size > 0 && !hasOverlap;

  if (removedOcids.length > 0 && !looksLikeAccountSwitch) {
    await supabase.from("completions").delete().eq("user_id", userId).in("character_ocid", removedOcids);
    await supabase.from("character_boss_selection").delete().eq("user_id", userId).in("character_ocid", removedOcids);
    await supabase.from("character_cache").delete().eq("user_id", userId).in("ocid", removedOcids);
  }

  return { newOcids: accountChars.map((c) => c.ocid).filter((ocid) => !cachedOcids.has(ocid)) };
}

/**
 * 넥슨 API 키 등록/교체. getCharacterList 로 실제 조회가 되는지 검증한 뒤 user_secrets 에
 * upsert 하고, 계정 캐릭터 목록을 character_cache 에 반영한다.
 *
 * 여기서는 캐릭터별 상세(이미지/전투력/포스)를 부르지 않는다 — 예전에는 이 액션이 계정 전체를
 * 루프로 워밍업해서 캐릭터가 많으면 서버리스 실행시간 제한에 그대로 걸렸다. 지금은 워밍업할
 * ocid 목록만 돌려주고, 실제 호출은 클라이언트가 캐릭터 1건씩 순차로 진행한다
 * (src/lib/character-warmup.ts) — 타임아웃이 사라지고 진행률도 보여줄 수 있다.
 *
 * 넥슨 원본 에러 텍스트는 그대로 노출하지 않는다(민감할 수 있음).
 */
export async function saveNexonKey(_prevState: NexonKeyState, formData: FormData): Promise<NexonKeyState> {
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!apiKey) {
    return { error: "API 키를 입력해 주세요.", success: false, ocids: [] };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "로그인이 필요합니다.", success: false, ocids: [] };
  }

  let accountChars: AccountCharacter[];
  try {
    const characterList = await getCharacterList(apiKey);
    accountChars = characterList.account_list.flatMap((a) => a.character_list);
  } catch {
    return { error: "API 키가 유효하지 않습니다. 키를 다시 확인해 주세요.", success: false, ocids: [] };
  }

  const { error } = await supabase
    .from("user_secrets")
    .upsert({ user_id: user.id, nexon_api_key: apiKey, nexon_key_valid: true }, { onConflict: "user_id" });

  if (error) {
    return { error: "키 저장 중 오류가 발생했습니다.", success: false, ocids: [] };
  }

  const { newOcids } = await reconcileCharacterCache(supabase, user.id, accountChars);

  // ⚠️ 여기서 revalidatePath("/main") 을 부르면 안 된다.
  //
  // 서버 액션 응답에는 액션 결과와 **재검증된 /main RSC 트리가 함께** 실려서 한 커밋으로
  // 반영된다. 그런데 최초 등록 사용자에게 NexonKeyCard 를 렌더하는 건 page.tsx 의
  // `if (!apiKey)` 분기뿐이라(page.tsx:112), 키가 저장된 새 트리에서는 그 분기가 사라지고
  // MainScreenClient 가 대신 렌더된다 → NexonKeyCard 가 언마운트된다.
  // 그 결과 `state.success` 를 보고 워밍업을 시작하는 useEffect 가 **한 번도 실행되지 않아**,
  // 캐릭터 이미지/전투력/포스가 전부 빈 채로 화면이 열린다("API 호출중입니다" 오버레이도
  // 나타나지 않는다). 게다가 character_cache 행은 이미 만들어진 뒤라 상단바 "캐릭터 동기화"의
  // newOcids 도 빈 배열이 되어 일괄 재시도 경로까지 막힌다.
  //
  // 화면 전환은 워밍업이 끝난 뒤 NexonKeyCard 가 부르는 router.refresh() 하나로 일원화한다.
  return { error: null, success: true, ocids: newOcids };
}

/** 등록된 넥슨 API 키 삭제(행 자체를 삭제). character_cache 는 건드리지 않는다(캐시는 유효). */
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

/**
 * 상단바 "캐릭터 동기화" 아이콘 버튼용 액션. getCharacterList 를 1회만 호출해 계정의 현재
 * 캐릭터 목록과 우리 캐시를 대조한다 — 이름/레벨/직업/월드는 그 자리에서 갱신하고, 사라진
 * 캐릭터는 지우고, 새로 생긴 캐릭터의 ocid 만 돌려준다(그 캐릭터들의 상세 조회는 호출부인
 * 클라이언트가 순차로 진행한다). 기존 캐릭터는 이미 스냅샷이 있으므로 다시 부르지 않는다.
 */
export async function refreshCharacterList(): Promise<ActionResult<{ newOcids: string[] }>> {
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

  const { newOcids } = await reconcileCharacterCache(supabase, user.id, accountChars);

  // saveNexonKey 와 같은 이유로 revalidatePath 를 부르지 않는다 — 여기서 트리를 갈아끼우면
  // 신규 캐릭터 워밍업이 끝나기도 전에 이미지 없는 캐릭터가 화면에 먼저 튀어나온다.
  // 호출부(MainScreenClient.handleSync)가 워밍업을 마친 뒤 router.refresh() 한다.
  return { newOcids };
}
