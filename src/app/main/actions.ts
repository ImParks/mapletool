"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentPeriodKey, type ResetType } from "@/lib/period";
import { findPresetItem } from "@/lib/checklist-data";
import type { ActionResult } from "@/lib/action-result";
import { clampInt } from "@/lib/num";
import { MapleApiError } from "@/lib/maple";
import { syncCharacterSnapshot, syncCharacterSchedule } from "@/lib/warmup";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 항목의 reset_type 을 찾는다: daily/weekly 코드 프리셋은 presets.ts, daily/weekly 자동등록
 * 콘텐츠는 quest_presets(DB), boss 는 boss_presets(DB). supabase/README.md "완료 토글 흐름"
 * 절대로 — period_key 는 항상 서버에서 이 값으로 계산한다.
 */
async function resolveResetType(supabase: SupabaseServerClient, itemId: string): Promise<ResetType | null> {
  const preset = findPresetItem(itemId);
  if (preset) return preset.reset_type;

  const { data: bossData } = await supabase.from("boss_presets").select("reset_type").eq("id", itemId).maybeSingle();
  // reset_type 컬럼은 DB check 제약으로 ResetType 값만 허용된다.
  if (bossData) return bossData.reset_type as ResetType;

  const { data: questData } = await supabase.from("quest_presets").select("reset_type").eq("id", itemId).maybeSingle();
  if (questData) return questData.reset_type as ResetType;

  return null;
}

/** 로그인 유저의 저장된 넥슨 API 키를 조회한다. 키 원문은 이 함수 밖으로(클라이언트로) 전달하지 않는다. */
async function getNexonApiKey(supabase: SupabaseServerClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("user_secrets")
    .select("nexon_api_key")
    .eq("user_id", userId)
    .maybeSingle<{ nexon_api_key: string | null }>();
  return data?.nexon_api_key ?? null;
}

/**
 * 캐릭터의 항목 완료를 토글한다. period_key 는 클라이언트가 아니라 항상 서버에서
 * currentPeriodKey(reset_type) 로 계산한다(클라이언트 입력 불신).
 */
export async function toggleCompletion(
  characterOcid: string,
  itemId: string
): Promise<ActionResult<{ done: boolean }>> {
  if (!characterOcid || !itemId) return { error: "잘못된 요청입니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const resetType = await resolveResetType(supabase, itemId);
  if (!resetType) return { error: "존재하지 않는 항목입니다." };

  const periodKey = currentPeriodKey(resetType);

  const { data: existing, error: selectError } = await supabase
    .from("completions")
    .select("id")
    .eq("user_id", user.id)
    .eq("character_ocid", characterOcid)
    .eq("item_id", itemId)
    .eq("period_key", periodKey)
    .maybeSingle();

  if (selectError) return { error: "완료 상태를 확인하지 못했습니다." };

  if (existing) {
    const { error: deleteError } = await supabase.from("completions").delete().eq("id", existing.id);
    if (deleteError) return { error: "완료 취소 중 오류가 발생했습니다." };
    revalidatePath("/main");
    return { done: false };
  }

  const { error: insertError } = await supabase.from("completions").upsert(
    { user_id: user.id, character_ocid: characterOcid, item_id: itemId, period_key: periodKey },
    { onConflict: "user_id,character_ocid,item_id,period_key", ignoreDuplicates: true }
  );
  if (insertError) return { error: "완료 처리 중 오류가 발생했습니다." };

  revalidatePath("/main");
  return { done: true };
}

/** 항목별 예상 소요시간(분) 저장. 0~999 로 clamp 후 quest_durations 에 upsert. */
export async function saveDuration(itemId: string, minutes: number): Promise<ActionResult<{ minutes: number }>> {
  if (!itemId) return { error: "잘못된 요청입니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const clamped = clampInt(minutes, 0, 999);

  const { error } = await supabase
    .from("quest_durations")
    .upsert({ user_id: user.id, item_id: itemId, minutes: clamped }, { onConflict: "user_id,item_id" });

  if (error) return { error: "저장 중 오류가 발생했습니다." };

  revalidatePath("/main");
  return { minutes: clamped };
}

/**
 * "동기화" 버튼(캐릭터 1개 스코프). 이미지/레벨/전투력/아케인·어센틱 포스를 넥슨에서 새로
 * 조회해 character_cache 를 갱신한다. 핵심 로직은 src/lib/warmup.ts 의 syncCharacterSnapshot —
 * 이 액션은 로그인/키 조회만 담당한다.
 */
export async function refreshCharacterSnapshot(
  characterOcid: string
): Promise<
  ActionResult<{
    imageUrl: string | null;
    level: number;
    characterClass: string;
    combatPower: number | null;
    arcaneForce: number;
    authenticForce: number;
  }>
> {
  if (!characterOcid) return { error: "잘못된 요청입니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const apiKey = await getNexonApiKey(supabase, user.id);
  if (!apiKey) return { error: "넥슨 API 키가 등록되어 있지 않습니다. 설정에서 먼저 등록해 주세요." };

  try {
    const snapshot = await syncCharacterSnapshot(supabase, apiKey, user.id, characterOcid);
    return {
      imageUrl: snapshot.imageUrl,
      level: snapshot.level,
      characterClass: snapshot.characterClass,
      combatPower: snapshot.combatPower,
      arcaneForce: snapshot.arcaneForce,
      authenticForce: snapshot.authenticForce,
    };
  } catch (error) {
    const message = error instanceof MapleApiError ? error.message : "캐릭터 정보를 불러오지 못했습니다.";
    return { error: message };
  }
}

/**
 * "숙제 동기화" 버튼(캐릭터 1개 스코프). 넥슨 스케줄러 현황을 조회해 완료 항목을
 * completions 에 반영하고, 우리 프리셋에 없는 신규 콘텐츠를 자동 등록한다. 핵심 로직은
 * src/lib/warmup.ts 의 syncCharacterSchedule — 이 액션은 로그인/키 조회만 담당한다.
 *
 * revalidatePath 를 호출하지 않는다 — discoveredItemIds(신규 등록된 프리셋)가 있으면 화면이
 * 그 항목을 즉시 보여줘야 하므로, 클라이언트가 결과를 보고 필요 시 자체적으로 router.refresh()
 * 한다(낙관적 머지만으로는 "새로 생긴 항목"의 존재 자체를 클라이언트가 알 수 없기 때문).
 */
export async function syncSchedulerState(characterOcid: string): Promise<
  ActionResult<{
    syncedItemIds: string[];
    alreadyDoneItemIds: string[];
    discoveredItemIds: string[];
    conflictItemIds: string[];
    unmatchedItemIds: string[];
  }>
> {
  if (!characterOcid) return { error: "잘못된 요청입니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const apiKey = await getNexonApiKey(supabase, user.id);
  if (!apiKey) return { error: "넥슨 API 키가 등록되어 있지 않습니다. 설정에서 먼저 등록해 주세요." };

  try {
    return await syncCharacterSchedule(supabase, apiKey, user.id, characterOcid);
  } catch (error) {
    const message = error instanceof MapleApiError ? error.message : "숙제 동기화 중 오류가 발생했습니다.";
    return { error: message };
  }
}
