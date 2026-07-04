"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentPeriodKey, type ResetType } from "@/lib/period";
import { findPresetItem } from "@/lib/checklist-data";
import type { ActionResult } from "@/lib/action-result";
import { clampInt } from "@/lib/num";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 항목의 reset_type 을 찾는다: daily/weekly 는 presets.ts(코드), boss 는 boss_presets(DB).
 * supabase/README.md "완료 토글 흐름" 절대로 — period_key 는 항상 서버에서 이 값으로 계산한다.
 */
async function resolveResetType(supabase: SupabaseServerClient, itemId: string): Promise<ResetType | null> {
  const preset = findPresetItem(itemId);
  if (preset) return preset.reset_type;

  const { data } = await supabase.from("boss_presets").select("reset_type").eq("id", itemId).maybeSingle();
  if (!data) return null;
  // reset_type 컬럼은 DB check 제약으로 ResetType 값만 허용된다.
  return data.reset_type as ResetType;
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
