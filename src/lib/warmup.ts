// 서버 전용 모듈: 캐릭터 1건 단위로 "넥슨 라이브 호출 → 우리 DB 반영"을 수행하는 공용 로직.
// "use server" 파일이 아니다(순수 async 함수 모음, 서버 액션이 아니라 서버 액션이 호출하는
// 내부 헬퍼) — 인증/DB 클라이언트 생성/API 키 조회는 전혀 하지 않는다(호출부 책임). 반드시
// 서버 액션/서버 컴포넌트에서만 import 한다("use client" 파일에서 import 금지 — maple.ts 가
// 서버 전용이라 번들링 시 오류가 난다).
//
// 이 파일의 함수 3개는 다음 3곳에서 재사용된다:
//  - src/app/main/actions.ts 의 refreshCharacterSnapshot("동기화" 버튼) → syncCharacterSnapshot
//  - src/app/main/actions.ts 의 syncSchedulerState("숙제 동기화" 버튼) → syncCharacterSchedule
//  - src/app/main/nexon-key-actions.ts 의 saveNexonKey/refreshCharacterList(초기 워밍업) → warmUpCharacter
//    (스냅샷+숙제 동기화를 순서대로 실행하는 조합 함수)
import type { createClient } from "@/lib/supabase/server";
import {
  getCharacterBasic,
  getCharacterStat,
  getCharacterSymbolEquipment,
  getCharacterState,
} from "@/lib/maple";
import { normalizeCharacterState, findContentMatch, findBossMatch, normalizeName } from "@/lib/scheduler-state";
import { PRESET_ITEMS } from "@/lib/presets";
import { currentPeriodKey, type ResetType } from "@/lib/period";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface CharacterSnapshotResult {
  characterName: string;
  worldName: string;
  characterClass: string;
  level: number;
  imageUrl: string | null;
  combatPower: number | null;
  arcaneForce: number;
  authenticForce: number;
}

/**
 * 캐릭터 1건의 기본정보/스탯/심볼을 조회해 전투력·아케인/어센틱 포스를 계산하고
 * character_cache 에 upsert 한다("동기화" 버튼의 핵심 로직).
 *
 * 계산식은 기존 /api/characters/[ocid]/stats 라우트(삭제됨)에서 그대로 옮겨왔다 — 아케인/
 * 어센틱 포스 합산 규칙은 넥슨 공식 문서로 정확한 공식을 확인하지 못한 추정치다: 각 그룹
 * (아케인심볼/어센틱심볼) 심볼들의 symbol_force(문자열)를 symbol_name 접두어로 구분해 그대로
 * 합산한다.
 */
export async function syncCharacterSnapshot(
  supabase: SupabaseServerClient,
  apiKey: string,
  userId: string,
  ocid: string
): Promise<CharacterSnapshotResult> {
  const [basic, stat, symbols] = await Promise.all([
    getCharacterBasic(apiKey, ocid),
    getCharacterStat(apiKey, ocid),
    getCharacterSymbolEquipment(apiKey, ocid),
  ]);

  const combatPowerEntry = stat.final_stat.find((s) => s.stat_name === "전투력");
  const combatPower = combatPowerEntry ? Number(combatPowerEntry.stat_value) : null;

  let arcaneForce = 0;
  let authenticForce = 0;
  for (const symbol of symbols.symbol) {
    const force = Number(symbol.symbol_force) || 0;
    if (symbol.symbol_name.startsWith("아케인심볼")) {
      arcaneForce += force;
    } else if (symbol.symbol_name.startsWith("어센틱심볼")) {
      authenticForce += force;
    }
  }

  const imageUrl = basic.character_image ?? null;

  const { error } = await supabase.from("character_cache").upsert(
    {
      user_id: userId,
      ocid,
      character_name: basic.character_name,
      world_name: basic.world_name,
      character_class: basic.character_class,
      character_level: basic.character_level,
      image_url: imageUrl,
      combat_power: combatPower,
      arcane_force: arcaneForce,
      authentic_force: authenticForce,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "user_id,ocid" }
  );
  if (error) throw new Error("캐릭터 스냅샷 저장 중 오류가 발생했습니다.");

  return {
    characterName: basic.character_name,
    worldName: basic.world_name,
    characterClass: basic.character_class,
    level: basic.character_level,
    imageUrl,
    combatPower,
    arcaneForce,
    authenticForce,
  };
}

export interface SchedulerSyncResult {
  syncedItemIds: string[];
  alreadyDoneItemIds: string[];
  discoveredItemIds: string[];
  conflictItemIds: string[];
  unmatchedItemIds: string[];
}

interface QuestPresetRow {
  id: string;
  name: string;
  category: "daily" | "weekly";
  reset_type: string;
  nexon_content_name: string;
}
interface BossPresetRow {
  id: string;
  nexon_content_name: string | null;
  nexon_difficulty: string | null;
}
interface BossSelectionRow {
  item_id: string;
}
interface CompletionRow {
  item_id: string;
  period_key: string;
}

/**
 * 캐릭터 1건의 넥슨 스케줄러 현황을 조회해 완료 항목을 completions 에 반영하고, 우리
 * 프리셋(PRESET_ITEMS/quest_presets/boss_presets) 어디에도 없는 신규 콘텐츠를
 * discover_quest_preset/discover_boss_preset RPC 로 자동 등록한다("숙제 동기화" 버튼의 핵심
 * 로직). 완료 기록을 지우거나 done=false 로 되돌리는 동작은 절대 하지 않는다(누적만).
 */
export async function syncCharacterSchedule(
  supabase: SupabaseServerClient,
  apiKey: string,
  userId: string,
  ocid: string
): Promise<SchedulerSyncResult> {
  const rawState = await getCharacterState(apiKey, ocid);
  const state = normalizeCharacterState(rawState);

  const dailyKey = currentPeriodKey("daily");
  const weeklyMonKey = currentPeriodKey("weekly_mon");
  const weeklyThuKey = currentPeriodKey("weekly_thu");

  const [questPresetsResult, bossPresetsResult, bossSelectionResult, completionsResult] = await Promise.all([
    supabase.from("quest_presets").select("id,name,category,reset_type,nexon_content_name"),
    supabase.from("boss_presets").select("id,nexon_content_name,nexon_difficulty"),
    supabase.from("character_boss_selection").select("item_id").eq("user_id", userId).eq("character_ocid", ocid),
    supabase
      .from("completions")
      .select("item_id,period_key")
      .eq("user_id", userId)
      .eq("character_ocid", ocid)
      .in("period_key", [dailyKey, weeklyMonKey, weeklyThuKey]),
  ]);

  const questPresets = (questPresetsResult.data ?? []) as QuestPresetRow[];
  const bossPresets = (bossPresetsResult.data ?? []) as BossPresetRow[];
  const bossSelectionRows = (bossSelectionResult.data ?? []) as BossSelectionRow[];

  // "행 없음=전체 선택" 정책(supabase/README.md, boss-selection-actions.ts 와 동일하게 처리).
  const hasExplicitBossSelection = bossSelectionRows.length > 0;
  const selectedBossIds = new Set(bossSelectionRows.map((r) => r.item_id));
  const relevantBossPresets = hasExplicitBossSelection
    ? bossPresets.filter((b) => selectedBossIds.has(b.id))
    : bossPresets;

  const doneSet = new Set(
    ((completionsResult.data ?? []) as CompletionRow[]).map((r) => `${r.item_id}::${r.period_key}`)
  );

  const syncedItemIds: string[] = [];
  const alreadyDoneItemIds: string[] = [];
  const conflictItemIds: string[] = [];
  const unmatchedItemIds: string[] = [];
  const discoveredItemIds: string[] = [];

  /**
   * 완료 상태를 completions 에 반영한다. 넥슨이 미완료라고 해도 기존 완료 기록은 절대
   * 지우지 않는다(conflictItemIds 로만 보고 — 정보용, 데이터 변경 없음).
   */
  async function applyDone(itemId: string, resetType: ResetType, nexonDone: boolean, kind: "synced" | "discovered") {
    const periodKey = currentPeriodKey(resetType);
    const key = `${itemId}::${periodKey}`;
    const alreadyRecorded = doneSet.has(key);

    if (!nexonDone) {
      if (alreadyRecorded) conflictItemIds.push(itemId);
      return;
    }
    if (alreadyRecorded) {
      if (kind === "synced") alreadyDoneItemIds.push(itemId);
      return;
    }

    const { error } = await supabase.from("completions").upsert(
      { user_id: userId, character_ocid: ocid, item_id: itemId, period_key: periodKey },
      { onConflict: "user_id,character_ocid,item_id,period_key", ignoreDuplicates: true }
    );
    if (error) return; // 실패해도 전체 동기화를 막지 않는다(다음 동기화 때 다시 시도됨).

    doneSet.add(key);
    if (kind === "synced") syncedItemIds.push(itemId);
    else discoveredItemIds.push(itemId);
  }

  // 매칭에 성공한 넥슨 콘텐츠(정규화 이름/난이도)를 기록 — 아래 "신규 콘텐츠 자동 등록" 단계에서
  // "우리 프리셋 어디에도 없는 콘텐츠"를 가려내는 데 쓴다.
  const matchedDailyNames = new Set<string>();
  const matchedWeeklyNames = new Set<string>();
  const matchedBossKeys = new Set<string>();

  // 1) 이 캐릭터의 관련 항목: PRESET_ITEMS(daily/weekly, nexonMatch 있는 것만) + quest_presets 전체.
  const dailyCandidates = [
    ...PRESET_ITEMS.filter((p) => p.category === "daily" && (p.nexonMatch?.length ?? 0) > 0).map((p) => ({
      itemId: p.id,
      names: p.nexonMatch ?? [],
    })),
    ...questPresets
      .filter((q) => q.category === "daily")
      .map((q) => ({ itemId: q.id, names: [q.nexon_content_name] })),
  ];
  const weeklyCandidates = [
    ...PRESET_ITEMS.filter((p) => p.category === "weekly" && (p.nexonMatch?.length ?? 0) > 0).map((p) => ({
      itemId: p.id,
      names: p.nexonMatch ?? [],
    })),
    ...questPresets
      .filter((q) => q.category === "weekly")
      .map((q) => ({ itemId: q.id, names: [q.nexon_content_name] })),
  ];

  for (const c of dailyCandidates) {
    const match = findContentMatch(state.daily, c.names);
    if (!match) {
      unmatchedItemIds.push(c.itemId);
      continue;
    }
    matchedDailyNames.add(normalizeName(match.name));
    await applyDone(c.itemId, "daily", match.done, "synced");
  }
  for (const c of weeklyCandidates) {
    const match = findContentMatch(state.weekly, c.names);
    if (!match) {
      unmatchedItemIds.push(c.itemId);
      continue;
    }
    matchedWeeklyNames.add(normalizeName(match.name));
    await applyDone(c.itemId, "weekly_mon", match.done, "synced");
  }

  // 2) boss: 이 캐릭터가 선택한(또는 전체선택 정책의) boss_presets 중 매칭 키
  //    (nexon_content_name + nexon_difficulty 가 둘 다 not null)가 있는 것만 시도한다.
  //    둘 중 하나라도 없으면(b6 처럼 그룹 라벨) 매칭 키 없음으로 unmatched 처리한다.
  for (const b of relevantBossPresets) {
    if (!b.nexon_content_name || !b.nexon_difficulty) {
      unmatchedItemIds.push(b.id);
      continue;
    }
    const match = findBossMatch(state.boss, b.nexon_content_name, b.nexon_difficulty);
    if (!match) {
      unmatchedItemIds.push(b.id);
      continue;
    }
    matchedBossKeys.add(`${normalizeName(match.name)}::${normalizeName(match.difficulty)}`);
    await applyDone(b.id, "weekly_thu", match.done, "synced");
  }

  // 3) 신규 콘텐츠 자동 등록: 넥슨이 "인게임 스케줄러 등록됨"(registered)으로 내려줬는데
  //    위 매칭에서 전혀 찾지 못한 콘텐츠 = 우리 프리셋 어디에도 없는 신규 콘텐츠.
  //    req_level/req_force/rec_hexa 등 앱 고유 요구치 필드는 RPC 가 이미 최소값(0/null)으로
  //    채우므로 여기서 별도로 채울 값은 없다(관리자가 나중에 수정).
  for (const c of state.daily) {
    if (!c.registered || matchedDailyNames.has(normalizeName(c.name))) continue;
    const { data: newId, error } = await supabase.rpc("discover_quest_preset", {
      p_name: c.name,
      p_category: "daily",
      p_reset_type: "daily",
      p_nexon_content_name: c.name,
    });
    if (error || !newId) continue;
    await applyDone(newId as string, "daily", c.done, "discovered");
  }
  for (const c of state.weekly) {
    if (!c.registered || matchedWeeklyNames.has(normalizeName(c.name))) continue;
    const { data: newId, error } = await supabase.rpc("discover_quest_preset", {
      p_name: c.name,
      p_category: "weekly",
      p_reset_type: "weekly_mon",
      p_nexon_content_name: c.name,
    });
    if (error || !newId) continue;
    await applyDone(newId as string, "weekly_mon", c.done, "discovered");
  }
  for (const b of state.boss) {
    if (!b.registered) continue;
    const key = `${normalizeName(b.name)}::${normalizeName(b.difficulty)}`;
    if (matchedBossKeys.has(key)) continue;

    const { data: newId, error } = await supabase.rpc("discover_boss_preset", {
      p_name: `${b.difficulty} ${b.name}`,
      p_nexon_content_name: b.name,
      p_nexon_difficulty: b.difficulty,
    });
    if (error || !newId) continue;
    await applyDone(newId as string, "weekly_thu", b.done, "discovered");

    // 새로 발견된 보스를 이 캐릭터가 "잡는 보스"로 자동 선택한다(방금 게임에서 실제로 잡은
    // 보스이니 당연히 선택된 것으로 간주). 단, 이 캐릭터가 "행 없음=전체 선택" 정책을 그대로
    // 따르고 있었다면(선택 행이 원래 하나도 없었다면) 여기서 새 행을 만들면 오히려 "이제부터
    // 선택된 것만" 정책으로 바뀌어버리므로, 그 경우는 행을 만들지 않고 전체선택 정책에 맡긴다
    // (신규 보스도 자동으로 포함됨).
    if (hasExplicitBossSelection && !selectedBossIds.has(newId as string)) {
      await supabase
        .from("character_boss_selection")
        .upsert(
          { user_id: userId, character_ocid: ocid, item_id: newId as string },
          { onConflict: "user_id,character_ocid,item_id", ignoreDuplicates: true }
        );
      selectedBossIds.add(newId as string);
    }
  }

  return { syncedItemIds, alreadyDoneItemIds, discoveredItemIds, conflictItemIds, unmatchedItemIds };
}

/**
 * 캐릭터 1건에 대해 스냅샷 동기화 + 스케줄러 동기화를 순서대로 수행한다. 최초 넥슨 키 등록
 * 워밍업(saveNexonKey)과 상단바 "캐릭터 동기화"의 신규 캐릭터 워밍업(refreshCharacterList)에서
 * 캐릭터별로 순차 호출된다 — 여기서는 딜레이를 넣지 않는다(호출부가 캐릭터 사이 딜레이를 둔다).
 * 두 단계 중 하나가 실패하면 예외를 그대로 던져 호출부(순차 루프)가 캐릭터 단위로 catch 하게 한다.
 */
export async function warmUpCharacter(
  supabase: SupabaseServerClient,
  apiKey: string,
  userId: string,
  ocid: string
): Promise<void> {
  await syncCharacterSnapshot(supabase, apiKey, userId, ocid);
  await syncCharacterSchedule(supabase, apiKey, userId, ocid);
}
