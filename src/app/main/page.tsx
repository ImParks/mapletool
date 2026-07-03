import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCharacterBasic, getCharacterList, MapleApiError } from "@/lib/maple";
import { buildAllItems, type BossPreset } from "@/lib/checklist-data";
import { currentPeriodKey } from "@/lib/period";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/ui/Logo";
import { NexonKeyCard } from "@/components/settings/NexonKeyCard";
import { MainScreenClient, type BossPresetDTO, type CharacterDTO, type ChecklistItemDTO } from "./MainScreenClient";

// 사용자별 넥슨/완료 데이터를 담는 페이지라 항상 요청마다 새로 렌더해야 한다. cookies() 사용이
// Next.js의 동적 렌더링을 암묵적으로 트리거하긴 하지만(Supabase env 미설정 시 그 분기 이전에
// return 하는 코드 경로가 있어 정적 분석이 헷갈릴 소지가 있었다 — 로컬 빌드 검증으로 실제 배포
// 조건에서는 정상적으로 동적 렌더링됨을 확인했다), 향후 리팩터로 우연히 정적 프리렌더되어
// 한 사용자의 캐릭터/완료 데이터가 다른 사용자에게 캐시되어 노출되는 사고를 원천 차단하기 위해
// 명시적으로 강제한다.
export const dynamic = "force-dynamic";

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

/** 넥슨 키 원문을 마스킹해 표시용 문자열만 만든다. 원문은 이 함수 밖으로(클라이언트로) 전달하지 않는다. */
function maskNexonKey(key: string): string {
  const last4 = key.slice(-4);
  return `${"•".repeat(12)}${last4}`;
}

function CenteredNotice({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0" style={{ background: "var(--bg-glow)" }} />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-6 px-5 py-10">
        <Logo size="lg" />
        <div className="w-full max-w-[420px]">{children}</div>
      </div>
    </div>
  );
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

  let accountChars;
  try {
    const characterList = await getCharacterList(apiKey);
    accountChars = characterList.account_list.flatMap((a) => a.character_list);
  } catch (error) {
    const message = error instanceof MapleApiError ? error.message : "캐릭터 정보를 불러오지 못했습니다.";
    return (
      <CenteredNotice>
        <p role="alert" className="mb-4 rounded-lg bg-maple-danger-soft px-3 py-2 text-center text-xs font-semibold text-maple-danger">
          {message}
        </p>
        <Card>
          <NexonKeyCard registered={Boolean(secretRow?.nexon_key_valid)} maskedKey={maskNexonKey(apiKey)} />
        </Card>
      </CenteredNotice>
    );
  }

  // 계정 캐릭터별 character_image 를 병렬로 보강(일반적인 계정 규모 가정, 넥슨 개발단계 5건/초
  // 제한을 크게 넘지 않는다). 개별 캐릭터 조회가 실패해도 전체 화면을 막지 않고 이미지만 비운다.
  const basics = await Promise.all(
    accountChars.map(async (c) => {
      try {
        const basic = await getCharacterBasic(apiKey, c.ocid);
        return { ocid: c.ocid, imageUrl: basic.character_image ?? null };
      } catch {
        return { ocid: c.ocid, imageUrl: null };
      }
    })
  );
  const imageByOcid = new Map(basics.map((b) => [b.ocid, b.imageUrl]));

  const dailyKey = currentPeriodKey("daily");
  const weeklyMonKey = currentPeriodKey("weekly_mon");
  const weeklyThuKey = currentPeriodKey("weekly_thu");

  const [bossPresetsResult, completionsResult, durationsResult, bossSelectionResult, profileRoleResult] =
    await Promise.all([
      supabase
        .from("boss_presets")
        .select("id,name,reset_type,req_level,symbol_type,req_force,rec_hexa")
        .order("list_order"),
      supabase
        .from("completions")
        .select("character_ocid,item_id,period_key")
        .eq("user_id", user.id)
        .in("period_key", [dailyKey, weeklyMonKey, weeklyThuKey]),
      supabase.from("quest_durations").select("item_id,minutes").eq("user_id", user.id),
      supabase.from("character_boss_selection").select("character_ocid,item_id").eq("user_id", user.id),
      // 앱바의 관리자(방패) 아이콘 노출 여부 판정용. 일반 유저에게는 아이콘 자체를 숨긴다
      // (실제 접근 방어선은 src/app/admin/page.tsx의 role 재확인).
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle<ProfileRoleRow>(),
    ]);
  const isAdmin = profileRoleResult.data?.role === "admin";

  const bossPresetRows = (bossPresetsResult.data ?? []) as BossPresetRow[];
  // reset_type/symbol_type 은 DB check 제약으로 값이 한정돼 있다(마이그레이션 참고).
  const bossPresets: BossPreset[] = bossPresetRows.map((b) => ({
    id: b.id,
    name: b.name,
    reset_type: b.reset_type as BossPreset["reset_type"],
    req_level: b.req_level,
    symbol_type: b.symbol_type as BossPreset["symbol_type"],
    req_force: b.req_force,
    rec_hexa: b.rec_hexa,
  }));
  const allItems = buildAllItems(bossPresets);
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

  const doneByOcid = new Map<string, Set<string>>();
  for (const row of (completionsResult.data ?? []) as CompletionRow[]) {
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

  const characters: CharacterDTO[] = accountChars.map((c) => {
    const bossSelection = bossSelectionByOcid.get(c.ocid);
    return {
      ocid: c.ocid,
      name: c.character_name,
      characterClass: c.character_class,
      level: c.character_level,
      world: c.world_name,
      imageUrl: imageByOcid.get(c.ocid) ?? null,
      // 행이 하나도 없으면(undefined) 전체 보스 선택으로 간주(null) — supabase/README.md 참고.
      bossItemIds: bossSelection ? Array.from(bossSelection) : null,
      doneItemIds: Array.from(doneByOcid.get(c.ocid) ?? []),
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
