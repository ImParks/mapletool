"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentPeriodKeys } from "@/lib/period";
import type { ActionResult } from "@/lib/action-result";

interface ItemIdRow {
  item_id: string;
}
interface BossIdRow {
  id: string;
}

/**
 * 캐릭터가 실제로 잡는 주간 보스 선택을 저장한다(#9 보스 선택 편집 다이얼로그 "완료" 액션).
 * 기존 character_boss_selection 행을 전부 지우고 selectedItemIds 로 다시 채운다(supabase/README.md
 * "완료 토글 흐름"과 동일하게 user_id 는 항상 로그인 세션에서만 가져온다 — 클라이언트 입력 불신).
 *
 * 체크 해제되어 더 이상 선택되지 않는 보스는 그 캐릭터의 현재 주기(weekly_thu) 완료 기록도 함께
 * 지운다(디자인 스펙: "체크 해제 시 그 즉시 완료 상태도 초기화"). "이전에 선택된 보스" 집합은
 * character_boss_selection 행이 하나도 없던 경우 "행 없음=전체 선택" 정책(supabase/README.md 3)을
 * 그대로 따라 boss_presets 전체로 간주한다.
 */
export async function saveBossSelection(
  characterOcid: string,
  selectedItemIds: string[]
): Promise<ActionResult<{ selected: string[] }>> {
  if (!characterOcid) return { error: "잘못된 요청입니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const [existingResult, allBossResult] = await Promise.all([
    supabase
      .from("character_boss_selection")
      .select("item_id")
      .eq("user_id", user.id)
      .eq("character_ocid", characterOcid),
    supabase.from("boss_presets").select("id"),
  ]);

  const existingRows = (existingResult.data ?? []) as ItemIdRow[];
  const allBossIds = ((allBossResult.data ?? []) as BossIdRow[]).map((r) => r.id);
  // 행 없음 = 전체 선택으로 간주(README 정책).
  const previousIds = existingRows.length > 0 ? existingRows.map((r) => r.item_id) : allBossIds;

  const nextIds = Array.from(new Set(selectedItemIds));
  const nextIdSet = new Set(nextIds);
  const removedIds = previousIds.filter((id) => !nextIdSet.has(id));

  const { error: deleteError } = await supabase
    .from("character_boss_selection")
    .delete()
    .eq("user_id", user.id)
    .eq("character_ocid", characterOcid);
  if (deleteError) return { error: "보스 선택 저장 중 오류가 발생했습니다." };

  if (nextIds.length > 0) {
    const { error: insertError } = await supabase
      .from("character_boss_selection")
      .insert(nextIds.map((itemId) => ({ user_id: user.id, character_ocid: characterOcid, item_id: itemId })));
    if (insertError) return { error: "보스 선택 저장 중 오류가 발생했습니다." };
  }

  if (removedIds.length > 0) {
    // 현재 주기 키 **전체**를 대상으로 지운다. 예전에는 weekly_thu 하나로만 지워서, 일일
    // 보스(초기화 daily)나 월간 보스(검은 마법사)를 선택 해제하면 그 완료 기록이 남아
    // 유령 완료가 됐다. 항목 하나는 주기가 하나뿐이라 여러 키를 넘겨도 많아야 한 행만 맞는다.
    await supabase
      .from("completions")
      .delete()
      .eq("user_id", user.id)
      .eq("character_ocid", characterOcid)
      .in("period_key", currentPeriodKeys())
      .in("item_id", removedIds);
  }

  revalidatePath("/main");
  return { selected: nextIds };
}
