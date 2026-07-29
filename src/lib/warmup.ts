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
import {
  normalizeCharacterState,
  findContentMatch,
  findBossMatch,
  normalizeName,
  type DoneState,
} from "@/lib/scheduler-state";
import { PRESET_ITEMS } from "@/lib/presets";
import { asResetType, currentPeriodKey, currentPeriodKeys, type ResetType } from "@/lib/period";

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
  /** 넥슨이 "완료"라고 확인해줘서 이번에 완료로 기록한 기존 항목 */
  syncedItemIds: string[];
  /** 넥슨도 완료라고 하는데 이미 완료로 기록돼 있던 항목 */
  alreadyDoneItemIds: string[];
  /** 자동 등록된 신규 프리셋 중 완료까지 기록된 항목 */
  discoveredItemIds: string[];
  /**
   * 이번 동기화로 **새로 만들어진 프리셋** 전체(완료 여부 무관).
   * discoveredItemIds 와 분리한 이유: 클라이언트가 discoveredItemIds 를 완료 상태로
   * 낙관 반영하기 때문에, "새로 생겼지만 완료는 아닌" 항목까지 거기 넣으면 체크된 것처럼
   * 잘못 표시된다. 화면 갱신(router.refresh) 트리거는 이 필드로 판단한다.
   */
  newPresetItemIds: string[];
  /** 넥슨이 "미완료"라고 하는데 우리 기록은 완료인 항목(정보용 — 기록을 지우지는 않는다) */
  conflictItemIds: string[];
  /**
   * 넥슨 응답만으로는 완료 여부를 **판정할 수 없는** 항목(max_count=0 콘텐츠 등).
   * conflictItemIds 와 반드시 구분한다 — 예전에는 판정 불가를 미완료로 뭉개서
   * "게임에서는 아직 미완료로 표시돼요" 라는 사실과 다른 안내를 냈다.
   */
  undeterminedItemIds: string[];
  /** 넥슨 응답에 대응하는 콘텐츠가 아예 없어 매칭에 실패한 항목 */
  unmatchedItemIds: string[];
  /** 이 캐릭터에 보스 데이터가 존재하는지(false 면 보스 항목 판정 자체가 불가) */
  hasBossData: boolean;
  /** 조회 기준일에 일일 스냅샷이 있었는지(false 면 그날 미접속으로 일일 판정 불가) */
  hasDailyData: boolean;
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
  /**
   * 이 보스의 초기화 주기. **완료 기록의 period_key 는 반드시 이 DB 값으로 계산한다** —
   * 수동 체크(actions.ts 의 resolveResetType)도 같은 컬럼을 읽으므로, 여기서만 넥슨 cycle
   * 유래 값을 쓰면 같은 항목이 자동 동기화와 수동 체크에서 서로 다른 period_key 로 갈린다.
   * (DB 값 자체를 넥슨 cycle 에 맞추는 일은 마이그레이션이 일괄로 처리한다.)
   */
  reset_type: string;
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

  const [questPresetsResult, bossPresetsResult, bossSelectionResult, completionsResult] = await Promise.all([
    supabase.from("quest_presets").select("id,name,category,reset_type,nexon_content_name"),
    supabase.from("boss_presets").select("id,reset_type,nexon_content_name,nexon_difficulty"),
    supabase.from("character_boss_selection").select("item_id").eq("user_id", userId).eq("character_ocid", ocid),
    supabase
      .from("completions")
      .select("item_id,period_key")
      .eq("user_id", userId)
      .eq("character_ocid", ocid)
      // 주기를 손으로 나열하지 않는다 — 예전에는 3개를 하드코딩해서 새 주기(monthly)가
      // 추가되면 그 주기의 완료가 doneSet 에 절대 안 들어가고 집계가 조용히 틀렸다.
      .in("period_key", currentPeriodKeys()),
  ]);

  // 조회 실패를 "결과 0건" 으로 강등하면 안 된다. 예컨대 boss_presets 읽기가 실패했는데 빈
  // 배열로 넘어가면, (a) 실제로 완료인 보스가 전부 집계에서 빠지고, (b) 아래 신규 등록 단계가
  // "우리 프리셋에 하나도 없다" 고 판단해 넥슨이 준 보스 수십 건에 대해 discover RPC 를 호출한다.
  // 그 RPC 는 find-or-create 라 **기존 행의 id 를 그대로 돌려주므로**, 사용자에겐 "77개 새 항목을
  // 발견했어요" 라는 거짓 안내가 뜨고 그 기존 항목들의 완료가 DB 의 reset_type 이 아니라 넥슨
  // cycle 파생값으로 기록돼 period_key 가 갈린다. 판정 근거를 못 읽은 상태의 부분 진행보다
  // 실패가 낫다(이 시점엔 아직 DB 를 쓰지 않았다).
  if (
    questPresetsResult.error ||
    bossPresetsResult.error ||
    bossSelectionResult.error ||
    completionsResult.error
  ) {
    throw new Error("숙제 동기화에 필요한 데이터를 불러오지 못했습니다.");
  }

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
  const undeterminedItemIds: string[] = [];
  const unmatchedItemIds: string[] = [];
  const discoveredItemIds: string[] = [];
  const newPresetItemIds: string[] = [];

  /**
   * 완료 상태를 completions 에 반영한다. 넥슨이 미완료라고 해도 기존 완료 기록은 절대
   * 지우지 않는다(conflictItemIds 로만 보고 — 정보용, 데이터 변경 없음).
   *
   * 세 번째 인자가 boolean 이 아니라 DoneState 인 것이 핵심이다 — "판정 불가"를 미완료와
   * 같이 취급하면 넥슨이 하지도 않은 말을 사용자에게 통보하게 된다(무릉도장처럼 max_count=0
   * 이라 원리적으로 판정할 수 없는 콘텐츠).
   */
  async function applyDone(itemId: string, resetType: ResetType, state: DoneState, kind: "synced" | "discovered") {
    const periodKey = currentPeriodKey(resetType);
    const key = `${itemId}::${periodKey}`;
    const alreadyRecorded = doneSet.has(key);

    if (state === "unknown") {
      // 완료로 기록하지도, 충돌로 보고하지도 않는다. 사용자의 수동 체크를 그대로 존중한다.
      undeterminedItemIds.push(itemId);
      return;
    }
    if (state === "not_done") {
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

  // 매칭에 성공한 넥슨 콘텐츠(정규화 이름)를 기록 — 아래 "신규 콘텐츠 자동 등록" 단계에서
  // "우리 프리셋 어디에도 없는 콘텐츠"를 가려내는 데 쓴다.
  // (보스에는 이 방식의 짝이 없다 — 아래 allBossPresetKeys 주석 참고.)
  const matchedDailyNames = new Set<string>();
  const matchedWeeklyNames = new Set<string>();

  // 보스 신규 등록 판정만은 "이 캐릭터가 매칭한 보스"가 아니라 **전체 boss_presets** 를 기준으로
  // 한다. 캐릭터 단위로 판정하면, 선택하지 않았을 뿐 이미 존재하는 보스를 신규로 착각해
  // (a) 매 동기화마다 재발견되어 사용자의 선택 해제가 무효화되고,
  // (b) 그때 넘긴 넥슨 cycle 유래 주기가 DB 에 저장된 주기와 달라 같은 항목이 두 개의
  //     period_key 로 갈라졌다.
  // 대가로 "이미 등록된 보스를 다른 캐릭터가 새로 잡았을 때 자동 선택해 주는" 편의는 사라진다
  // (아래 자동 선택 블록은 서비스 전체에서 그 보스를 처음 발견한 경우에만 도달한다).
  // 사용자가 명시적으로 뺀 보스를 되살리지 않는 쪽이 옳다고 보고 감수한다.
  const allBossPresetKeys = new Set(
    bossPresets
      .filter((b) => b.nexon_content_name && b.nexon_difficulty)
      .map((b) => `${normalizeName(b.nexon_content_name)}::${normalizeName(b.nexon_difficulty)}`)
  );

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
    await applyDone(c.itemId, "daily", match.doneState, "synced");
  }
  for (const c of weeklyCandidates) {
    const match = findContentMatch(state.weekly, c.names);
    if (!match) {
      unmatchedItemIds.push(c.itemId);
      continue;
    }
    matchedWeeklyNames.add(normalizeName(match.name));
    // ⚠️ 미검증 단정: 넥슨은 주간 콘텐츠의 초기화 **요일**을 알려주지 않는다. weekly_contents
    // 를 전부 월요일 초기화로 보는 것은 버그2(보스 주기 단정)와 구조가 같은 가정이다.
    // 목요일 초기화 주간 콘텐츠가 섞여 있으면 그 항목만 잘못된 시점에 초기화된다. 판별하려면
    // 콘텐츠명을 하드코딩해야 하는데 그건 scheduler-state.ts 의 "이름 하드코딩 금지" 규약과
    // 충돌하므로, 현재는 알면서 감수한다.
    await applyDone(c.itemId, "weekly_mon", match.doneState, "synced");
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
    // 주기는 **DB 값**을 쓴다(넥슨 cycle 유래 값이 아니라). 수동 체크가 같은 컬럼을 읽으므로
    // 여기서만 다른 근거를 쓰면 같은 항목이 두 개의 period_key 로 갈라진다.
    // 예전에는 리터럴 "weekly_thu" 였고, 그래서 일일 보스는 매일 초기화되지 않고 검은 마법사는
    // 매주 초기화됐다(버그2).
    const resetType = asResetType(b.reset_type);
    if (!resetType) {
      // DB 에 코드가 모르는 주기가 들어 있다. 아무 주기로나 단정해 기록하면 초기화 시점이
      // 어긋나므로 자동 판정을 포기하고 수동 체크로 남긴다.
      unmatchedItemIds.push(b.id);
      continue;
    }
    await applyDone(b.id, resetType, match.done ? "done" : "not_done", "synced");
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
    newPresetItemIds.push(newId as string);
    await applyDone(newId as string, "daily", c.doneState, "discovered");
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
    newPresetItemIds.push(newId as string);
    await applyDone(newId as string, "weekly_mon", c.doneState, "discovered");
  }
  for (const b of state.boss) {
    if (!b.registered) continue;
    const key = `${normalizeName(b.name)}::${normalizeName(b.difficulty)}`;
    // 이 캐릭터가 선택하지 않은 보스라도 **프리셋이 이미 존재하면** 신규 등록 대상이 아니다.
    if (allBossPresetKeys.has(key)) continue;

    // 신규 보스의 주기는 넥슨 cycle 에서 가져온다(이 시점엔 DB 에 행이 없으므로 이게 유일한 근거).
    // 주기를 모르면 등록 자체를 하지 않는다 — 틀린 주기로 만들어두면 그 뒤로 계속 잘못된
    // 시점에 초기화되고, 관리자 UI 에는 주기를 고칠 수단이 없다.
    if (!b.resetType) continue;

    const { data: newId, error } = await supabase.rpc("discover_boss_preset", {
      p_name: `${b.difficulty} ${b.name}`,
      p_reset_type: b.resetType,
      p_nexon_content_name: b.name,
      p_nexon_difficulty: b.difficulty,
    });
    if (error || !newId) continue;
    newPresetItemIds.push(newId as string);
    await applyDone(newId as string, b.resetType, b.done ? "done" : "not_done", "discovered");

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

  return {
    syncedItemIds,
    alreadyDoneItemIds,
    discoveredItemIds,
    newPresetItemIds,
    conflictItemIds,
    undeterminedItemIds,
    unmatchedItemIds,
    hasBossData: state.hasBossData,
    hasDailyData: state.hasDailyData,
  };
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

