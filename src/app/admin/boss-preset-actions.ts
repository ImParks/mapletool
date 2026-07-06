"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/action-result";
import { clampInt } from "@/lib/num";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type AdminAuthResult =
  | { ok: true; supabase: SupabaseServerClient; userId: string }
  | { ok: false; error: string };

/**
 * 로그인 여부 + `profiles.role === 'admin'`을 서버에서 방어적으로 재확인한다.
 * `boss_presets` RLS(관리자만 insert/update/delete)가 최종 방어선이지만, 이 액션들에서도
 * 조기에 명확한 한국어 에러로 막는다(supabase/README.md "RLS 설계" 참고).
 */
async function requireAdmin(): Promise<AdminAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();

  if (profile?.role !== "admin") return { ok: false, error: "관리자만 사용할 수 있습니다." };

  return { ok: true, supabase, userId: user.id };
}

export interface BossPresetFields {
  reqLevel: number;
  symbolType: "arcane" | "authentic";
  reqForce: number;
  recHexa: number;
  /** 넥슨 스케줄러 API 원문 콘텐츠명(예: "스우"). 매칭 키 — 값이 없으면 자동 동기화 대상에서 제외. */
  nexonContentName: string | null;
  /** 넥슨 스케줄러 API 원문 난이도(예: "하드"). nexonContentName 과 둘 다 있어야 자동 매칭(오매칭 방지). */
  nexonDifficulty: string | null;
}

/** 빈 문자열/공백만 있는 입력을 null 로 정규화한다(폼의 빈 칸 = "매칭 안 함"). */
function normalizeNullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 관리자 페이지 "보스 관리" 행의 저장(#11). 행 단위 draft 전체를 한 번에 커밋한다
 * (실수로 여러 필드를 고치다 하나만 저장되는 일이 없도록 — 디자인 스펙).
 */
export async function updateBossPreset(id: string, fields: BossPresetFields): Promise<ActionResult<{ ok: true }>> {
  if (!id) return { error: "잘못된 요청입니다." };

  const auth = await requireAdmin();
  if (!auth.ok) return { error: auth.error };

  const { error } = await auth.supabase
    .from("boss_presets")
    .update({
      req_level: clampInt(fields.reqLevel, 0, 300),
      symbol_type: fields.symbolType === "authentic" ? "authentic" : "arcane",
      req_force: clampInt(fields.reqForce, 0, 99999),
      rec_hexa: clampInt(fields.recHexa, 0, 30),
      nexon_content_name: normalizeNullableText(fields.nexonContentName),
      nexon_difficulty: normalizeNullableText(fields.nexonDifficulty),
    })
    .eq("id", id);

  if (error) return { error: "보스 정보 저장 중 오류가 발생했습니다." };

  // /admin(이 화면)뿐 아니라 /main(캐릭터별 보스 선택 편집 다이얼로그의 레벨/포스 판정)도
  // 이 값을 쓰므로 함께 재검증한다.
  revalidatePath("/admin");
  revalidatePath("/main");
  return { ok: true };
}

export interface NewBossPresetFields extends BossPresetFields {
  name: string;
}

/**
 * 보스 추가 다이얼로그(#11) "추가". 새 `boss_presets` 행을 만들고 생성된 id를 반환한다.
 * `id`는 컬럼 기본값(`gen_random_uuid()::text`)에 맡기고 직접 지정하지 않는다.
 */
export async function addBossPreset(fields: NewBossPresetFields): Promise<ActionResult<{ id: string }>> {
  const name = fields.name.trim();
  if (!name) return { error: "보스 이름을 입력해 주세요." };

  const auth = await requireAdmin();
  if (!auth.ok) return { error: auth.error };

  // 새 보스를 기존 목록 맨 뒤에 붙인다(list_order 오름차순 표시 규칙 유지).
  const { data: maxRow } = await auth.supabase
    .from("boss_presets")
    .select("list_order")
    .order("list_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ list_order: number }>();
  const nextOrder = (maxRow?.list_order ?? -1) + 1;

  const { data, error } = await auth.supabase
    .from("boss_presets")
    .insert({
      name,
      reset_type: "weekly_thu",
      req_level: clampInt(fields.reqLevel, 0, 300),
      symbol_type: fields.symbolType === "authentic" ? "authentic" : "arcane",
      req_force: clampInt(fields.reqForce, 0, 99999),
      rec_hexa: clampInt(fields.recHexa, 0, 30),
      nexon_content_name: normalizeNullableText(fields.nexonContentName),
      nexon_difficulty: normalizeNullableText(fields.nexonDifficulty),
      list_order: nextOrder,
      created_by: auth.userId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) return { error: "보스 추가 중 오류가 발생했습니다." };

  revalidatePath("/admin");
  revalidatePath("/main");
  return { id: data.id };
}
