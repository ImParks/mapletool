import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { kstMidnight, kstParts } from "@/lib/period";
import { Card } from "@/components/ui/Card";
import { CenteredNotice } from "@/components/CenteredNotice";
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

/** 오늘(KST) 00:00 시각. (KST 변환은 period.ts의 공용 kstParts/kstMidnight 재사용) */
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

export default async function AdminPage() {
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
