import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/ui/Logo";
import { AdminPageClient, type AdminBossPresetDTO, type AdminStatDTO, type RecentAccessDTO } from "./AdminPageClient";

// 관리자별/시점별 통계·최근 접속·보스 목록을 담는 페이지라 요청마다 새로 렌더해야 한다
// (src/app/main/page.tsx의 동일 주석 참고 — 정적 프리렌더 시 한 관리자의 화면이 다른 세션에
// 캐시되어 노출되는 사고를 원천 차단하기 위해 명시적으로 강제한다).
export const dynamic = "force-dynamic";

interface ProfileRow {
  id: string;
  created_at: string;
  last_access_at: string | null;
  has_nexon_key: boolean;
}
interface RecentAccessRow {
  id: string;
  masked_email: string;
  last_access_at: string | null;
}
interface BossPresetRow {
  id: string;
  name: string;
  req_level: number | null;
  symbol_type: string | null;
  req_force: number | null;
  rec_hexa: number | null;
}

/**
 * 주어진 시각을 KST 기준 연/월/일/요일로 변환한다. src/lib/period.ts의 (export되지 않은) kstParts와
 * 동일한 기법(Intl.DateTimeFormat + Asia/Seoul)을 이 페이지 전용으로 작게 재구현한 것이다 —
 * period.ts는 ResetType/currentPeriodKey/RESET_LABEL 세 가지만 export하는 계약이라(다른 여러
 * 문서에 명시) 이 페이지만을 위해 export를 늘리지 않는다.
 */
function kstParts(now: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday as string],
  };
}

/** 지정한 KST 날짜 00:00에 해당하는 실제 시각(UTC 기준 Date). KST=UTC+9 고정(서머타임 없음). */
function kstMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000);
}

/** 오늘(KST) 00:00 시각. */
function todayStartKST(now: Date): Date {
  const { year, month, day } = kstParts(now);
  return kstMidnight(year, month, day);
}

/** 이번 주(KST) 월요일 00:00 시각. */
function thisWeekMondayStartKST(now: Date): Date {
  const { year, month, day, weekday } = kstParts(now);
  const mondayOffset = (weekday + 6) % 7; // 월요일=0 ... 일요일=6
  const todayMidnight = kstMidnight(year, month, day);
  return new Date(todayMidnight.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
}

function NotConfiguredNotice() {
  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0" style={{ background: "var(--bg-glow)" }} />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-6 px-5 py-10">
        <Logo size="lg" />
        <Card className="w-full max-w-[420px]">
          <p className="text-sm text-maple-text-secondary">
            Supabase 환경변수가 설정되지 않았습니다. 관리자에게 문의해 주세요.
          </p>
        </Card>
      </div>
    </div>
  );
}

export default async function AdminPage() {
  if (!isSupabaseConfigured()) {
    return <NotConfiguredNotice />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 방어적 처리(1차 방어는 미들웨어 — 로그인 여부만 확인).
  if (!user) {
    redirect("/login");
  }

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();

  // ★ 진짜 방어선: 일반 유저는 role이 'admin'이 아니므로 여기서 무조건 /main으로 돌려보낸다.
  // 미들웨어는 "로그인했는가"만 확인하고 role은 모르기 때문에, 이 서버 컴포넌트의 검사가
  // 실질적인 접근 제어다(RLS도 boss_presets 쓰기 등에서 이중으로 막지만, 페이지 자체 접근은
  // 여기서 막아야 한다).
  if (myProfile?.role !== "admin") {
    redirect("/main");
  }

  const [profilesResult, recentAccessResult, bossPresetsResult] = await Promise.all([
    supabase.from("profiles").select("id, created_at, last_access_at, has_nexon_key"),
    supabase.rpc("admin_recent_access", { p_limit: 20 }),
    supabase
      .from("boss_presets")
      .select("id, name, req_level, symbol_type, req_force, rec_hexa")
      .order("list_order"),
  ]);

  const profileRows = (profilesResult.data ?? []) as ProfileRow[];
  const now = new Date();
  const todayStart = todayStartKST(now).getTime();
  const weekStart = thisWeekMondayStartKST(now).getTime();

  const totalUsers = profileRows.length;
  const todayAccessCount = profileRows.filter(
    (p) => p.last_access_at !== null && new Date(p.last_access_at).getTime() >= todayStart
  ).length;
  const weeklySignupCount = profileRows.filter((p) => new Date(p.created_at).getTime() >= weekStart).length;
  const apiKeyRegisteredCount = profileRows.filter((p) => p.has_nexon_key).length;
  const apiKeyRate = totalUsers > 0 ? Math.round((apiKeyRegisteredCount / totalUsers) * 100) : 0;

  const stats: AdminStatDTO[] = [
    { label: "전체 유저", value: `${totalUsers.toLocaleString()}명` },
    { label: "오늘 접속", value: `${todayAccessCount.toLocaleString()}명` },
    { label: "이번 주 신규 가입", value: `${weeklySignupCount.toLocaleString()}명` },
    { label: "API 키 등록률", value: `${apiKeyRate}%` },
  ];

  const recentAccessRows = (recentAccessResult.data ?? []) as RecentAccessRow[];
  const recentAccess: RecentAccessDTO[] = recentAccessRows.map((r) => ({
    id: r.id,
    maskedEmail: r.masked_email,
    lastAccessAt: r.last_access_at,
  }));

  const bossPresetRows = (bossPresetsResult.data ?? []) as BossPresetRow[];
  const bossPresets: AdminBossPresetDTO[] = bossPresetRows.map((b) => ({
    id: b.id,
    name: b.name,
    reqLevel: b.req_level,
    symbolType: b.symbol_type === "authentic" ? "authentic" : b.symbol_type === "arcane" ? "arcane" : null,
    reqForce: b.req_force,
    recHexa: b.rec_hexa,
  }));

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0" style={{ background: "var(--bg-glow)" }} />
      <AdminPageClient stats={stats} recentAccess={recentAccess} bossPresets={bossPresets} />
    </div>
  );
}
