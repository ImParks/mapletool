import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { buildAllItems, type BossPreset, type QuestPreset } from "@/lib/checklist-data";
import { asResetType, currentPeriodKey, currentPeriodKeys } from "@/lib/period";
import { Card } from "@/components/ui/Card";
import { CenteredNotice } from "@/components/CenteredNotice";
import { NexonKeyCard } from "@/components/settings/NexonKeyCard";
import { MainScreenClient, type BossPresetDTO, type CharacterDTO, type ChecklistItemDTO } from "./MainScreenClient";

// 사용자별 넥슨/완료 데이터를 담는 페이지라 항상 요청마다 새로 렌더해야 한다. cookies() 사용이
// Next.js의 동적 렌더링을 암묵적으로 트리거하긴 하지만(Supabase env 미설정 시 그 분기 이전에
// return 하는 코드 경로가 있어 정적 분석이 헷갈릴 소지가 있었다 — 로컬 빌드 검증으로 실제 배포
// 조건에서는 정상적으로 동적 렌더링됨을 확인했다), 향후 리팩터로 우연히 정적 프리렌더되어
// 한 사용자의 캐릭터/완료 데이터가 다른 사용자에게 캐시되어 노출되는 사고를 원천 차단하기 위해
// 명시적으로 강제한다.
export const dynamic = "force-dynamic";

// 이 세그먼트에서 호출되는 server action 에도 적용된다. 넥슨 키 최초 등록(saveNexonKey)은
// 계정의 모든 캐릭터를 순차 워밍업하므로 기본 실행시간 제한(호스팅 플랜에 따라 10~15초)에
// 쉽게 걸린다. 타임아웃은 클라이언트에서 "던져진 예외"로 나타나 화면 전체를 error.tsx 로
// 바꿔버렸던 원인 중 하나라, 여유를 준다(예외 자체는 NexonKeyCard 에서도 흡수한다).
export const maxDuration = 60;

// 이 프로젝트에는 아직 생성된 Supabase Database 타입이 없어(@supabase/ssr 클라이언트가
// 제네릭 스키마로 동작) 쿼리 결과가 그대로 any 로 온다. 행 구조를 명시하기 위한 최소 인터페이스.
interface UserSecretRow {
  nexon_api_key: string | null;
  nexon_key_valid: boolean;
}
interface BossPresetRow {
  id: string;
  name: string;
  reset_type: string;
  req_level: number | null;
  symbol_type: string | null;
  req_force: number | null;
  rec_hexa: number | null;
}
interface QuestPresetRow {
  id: string;
  name: string;
  category: string;
  reset_type: string;
}
interface CompletionRow {
  character_ocid: string;
  item_id: string;
  period_key: string;
}
interface DurationRow {
  item_id: string;
  minutes: number;
}
interface BossSelectionRow {
  character_ocid: string;
  item_id: string;
}
interface ProfileRoleRow {
  role: string;
}
/** character_cache 행. 넥슨 라이브 호출 대신 이 캐시만 읽는다("동기화"/"숙제 동기화" 버튼으로만 갱신). */
interface CharacterCacheRow {
  ocid: string;
  character_name: string;
  world_name: string;
  character_class: string;
  character_level: number;
  image_url: string | null;
  combat_power: number | null;
  arcane_force: number | null;
  authentic_force: number | null;
  is_favorite: boolean;
  is_active: boolean;
}

/** 넥슨 키 원문을 마스킹해 표시용 문자열만 만든다. 원문은 이 함수 밖으로(클라이언트로) 전달하지 않는다. */
function maskNexonKey(key: string): string {
  const last4 = key.slice(-4);
  return `${"•".repeat(12)}${last4}`;
}

export default async function MainPage() {
  if (!isSupabaseConfigured()) {
    return (
      <CenteredNotice>
        <Card>
          <p className="text-sm text-maple-text-secondary">
            Supabase 환경변수가 설정되지 않았습니다. 관리자에게 문의해 주세요.
          </p>
        </Card>
      </CenteredNotice>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 방어적 처리(1차 방어는 미들웨어).
  if (!user) {
    redirect("/login");
  }

  const { data: secretRow } = await supabase
    .from("user_secrets")
    .select("nexon_api_key, nexon_key_valid")
    .eq("user_id", user.id)
    .maybeSingle<UserSecretRow>();

  // 넥슨 키 원문은 이 서버 컴포넌트 스코프 밖(클라이언트)으로 절대 전달하지 않는다.
  const apiKey = secretRow?.nexon_api_key ?? null;

  if (!apiKey) {
    return (
      <CenteredNotice>
        <Card>
          <NexonKeyCard registered={false} maskedKey={null} />
        </Card>
        <p className="mt-4 text-center text-xs text-maple-text-muted">
          넥슨 API 키를 등록하면 내 캐릭터의 숙제를 불러올 수 있어요.
        </p>
      </CenteredNotice>
    );
  }

  // 넥슨은 여기서 전혀 호출하지 않는다 — character_cache(캐시)만 읽는다. 최초 채움은 키 등록
  // 워밍업(saveNexonKey)이, 갱신은 캐릭터 상세의 "동기화"/"숙제 동기화" 버튼과 상단바 "캐릭터
  // 동기화"(refreshCharacterList)가 담당한다. 캐시가 비어있어도(워밍업 진행 중/실패) 에러를
  // 던지지 않고 빈 배열로 자연스럽게 처리한다.
  const [
    characterCacheResult,
    bossPresetsResult,
    questPresetsResult,
    completionsResult,
    durationsResult,
    bossSelectionResult,
    profileRoleResult,
  ] = await Promise.all([
    supabase
      .from("character_cache")
      .select(
        "ocid,character_name,world_name,character_class,character_level,image_url,combat_power,arcane_force,authentic_force,is_favorite,is_active"
      )
      .eq("user_id", user.id),
    supabase
      .from("boss_presets")
      .select("id,name,reset_type,req_level,symbol_type,req_force,rec_hexa")
      .order("list_order"),
    supabase.from("quest_presets").select("id,name,category,reset_type").order("list_order"),
    supabase
      .from("completions")
      .select("character_ocid,item_id,period_key")
      .eq("user_id", user.id)
      // 주기를 손으로 나열하지 않는다 — 예전에는 3개를 하드코딩해서, 새 주기(monthly)가
      // 추가되면 그 주기의 완료 기록이 화면에 아예 안 실렸다. 그 상태에서 사용자가 항목을
      // 체크하면 toggleCompletion 이 "이미 있는 행"을 찾아 **삭제**하고 done:false 를 반환하는데,
      // 클라이언트는 에러가 아니면 롤백하지 않으므로 화면엔 체크된 채 남고 DB 에선 완료가 사라진다.
      .in("period_key", currentPeriodKeys()),
    supabase.from("quest_durations").select("item_id,minutes").eq("user_id", user.id),
    supabase.from("character_boss_selection").select("character_ocid,item_id").eq("user_id", user.id),
    // 앱바의 관리자(방패) 아이콘 노출 여부 판정용. 일반 유저에게는 아이콘 자체를 숨긴다
    // (실제 접근 방어선은 src/app/admin/page.tsx의 role 재확인).
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle<ProfileRoleRow>(),
  ]);
  const isAdmin = profileRoleResult.data?.role === "admin";

  const bossPresetRows = (bossPresetsResult.data ?? []) as BossPresetRow[];
  // symbol_type 은 DB check 제약으로 값이 한정돼 있어 캐스팅으로 충분하지만, reset_type 은
  // 캐스팅하지 않고 asResetType 으로 좁힌다 — 코드가 모르는 주기가 흘러들면 currentPeriodKey 가
  // 엉뚱한 키를 만들어 완료 기록이 조용히 어긋난다(마이그레이션이 코드보다 먼저 배포된 경우 등).
  // 모르는 값이면 그 항목을 아예 내리지 않는다: 화면에서 사라지는 편이 잘못된 키로 완료를
  // 쓰는 것보다 낫다(사라진 항목은 코드 배포로 바로 복구되지만, 어긋난 완료 기록은 남는다).
  const bossPresets: BossPreset[] = bossPresetRows.flatMap((b) => {
    const resetType = asResetType(b.reset_type);
    if (!resetType) return [];
    return [
      {
        id: b.id,
        name: b.name,
        reset_type: resetType,
        req_level: b.req_level,
        symbol_type: b.symbol_type as BossPreset["symbol_type"],
        req_force: b.req_force,
        rec_hexa: b.rec_hexa,
      },
    ];
  });
  const questPresetRows = (questPresetsResult.data ?? []) as QuestPresetRow[];
  const questPresets: QuestPreset[] = questPresetRows.flatMap((q) => {
    const resetType = asResetType(q.reset_type);
    if (!resetType) return [];
    return [{ id: q.id, name: q.name, category: q.category as QuestPreset["category"], reset_type: resetType }];
  });
  const allItems = buildAllItems(bossPresets, questPresets);
  const items: ChecklistItemDTO[] = allItems.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    resetType: i.reset_type,
  }));
  // 보스 선택 편집 다이얼로그(#9)에서 레벨 잠금/비권장 배지를 계산하려면 req_level/symbol_type/
  // req_force 가 필요하다(rec_hexa 는 캐릭터 헥사 스탯 데이터가 없어 판정에 쓰지 않는다 — 정보 표시도 생략).
  const bossPresetDTOs: BossPresetDTO[] = bossPresets.map((b) => ({
    id: b.id,
    name: b.name,
    resetType: b.reset_type,
    reqLevel: b.req_level,
    symbolType: b.symbol_type,
    reqForce: b.req_force,
    recHexa: b.rec_hexa,
  }));

  // item_id → 그 항목이 지금 가져야 할 주기 키. 위 쿼리는 "현재 유효한 키 4종 중 하나"인 행을
  // 전부 가져오므로, 항목별로 **자기 주기의 키인지** 한 번 더 걸러야 한다.
  //
  // 걸르지 않으면: 어떤 항목의 reset_type 이 재분류되면(예: 일일 보스가 weekly_thu → daily)
  // 예전에 저장된 weekly_thu 키 행이 여전히 "현재 유효한 키"라 통과해 화면엔 완료로 보인다.
  // 그런데 해제 클릭은 새 주기(daily) 키로 조회하므로 지울 행을 못 찾고 오히려 INSERT 한다
  // → 완료 행이 하나 더 늘고 새로고침하면 되살아난다 = 영구 해제 불가.
  const expectedPeriodKeyByItemId = new Map(allItems.map((i) => [i.id, currentPeriodKey(i.reset_type)]));

  const doneByOcid = new Map<string, Set<string>>();
  for (const row of (completionsResult.data ?? []) as CompletionRow[]) {
    if (expectedPeriodKeyByItemId.get(row.item_id) !== row.period_key) continue;
    const set = doneByOcid.get(row.character_ocid) ?? new Set<string>();
    set.add(row.item_id);
    doneByOcid.set(row.character_ocid, set);
  }

  const bossSelectionByOcid = new Map<string, Set<string>>();
  for (const row of (bossSelectionResult.data ?? []) as BossSelectionRow[]) {
    const set = bossSelectionByOcid.get(row.character_ocid) ?? new Set<string>();
    set.add(row.item_id);
    bossSelectionByOcid.set(row.character_ocid, set);
  }

  const durations: Record<string, number> = {};
  for (const row of (durationsResult.data ?? []) as DurationRow[]) {
    durations[row.item_id] = row.minutes;
  }

  const characterCacheRows = (characterCacheResult.data ?? []) as CharacterCacheRow[];
  const characters: CharacterDTO[] = characterCacheRows.map((c) => {
    const bossSelection = bossSelectionByOcid.get(c.ocid);
    return {
      ocid: c.ocid,
      name: c.character_name,
      characterClass: c.character_class,
      level: c.character_level,
      world: c.world_name,
      imageUrl: c.image_url,
      combatPower: c.combat_power,
      arcaneForce: c.arcane_force,
      authenticForce: c.authentic_force,
      // 행이 하나도 없으면(undefined) 전체 보스 선택으로 간주(null) — supabase/README.md 참고.
      bossItemIds: bossSelection ? Array.from(bossSelection) : null,
      doneItemIds: Array.from(doneByOcid.get(c.ocid) ?? []),
      isFavorite: c.is_favorite,
      isActive: c.is_active,
    };
  });

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0" style={{ background: "var(--bg-glow)" }} />
      <MainScreenClient
        items={items}
        characters={characters}
        bossPresets={bossPresetDTOs}
        durations={durations}
        nexonKeyRegistered={Boolean(secretRow?.nexon_key_valid)}
        nexonKeyMasked={maskNexonKey(apiKey)}
        isAdmin={isAdmin}
      />
    </div>
  );
}
