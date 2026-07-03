"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult<T> = T | { error: string };

/** 로그인 유저의 모든 완료 기록(completions)을 삭제한다(#8 초기화 확인 다이얼로그). */
export async function resetAllCompletions(): Promise<ActionResult<{ ok: true }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  // RLS 가 최종 방어선이지만, 액션에서도 user_id 조건을 명시해 본인 행만 지운다.
  const { error } = await supabase.from("completions").delete().eq("user_id", user.id);
  if (error) return { error: "완료 기록 초기화 중 오류가 발생했습니다." };

  revalidatePath("/main");
  return { ok: true };
}

/** 이 기기에서 로그아웃하고 로그인 화면으로 이동한다(확인 없이 즉시 실행). */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * 회원탈퇴(#10 확인 다이얼로그의 "탈퇴"). supabase/README.md "회원탈퇴(계정 삭제) 흐름" 절 그대로:
 * 1) 인자 없는 delete_own_account() RPC(SECURITY DEFINER, 호출자 본인 = auth.uid() 만 대상) 호출
 * 2) 성공하면 signOut() 으로 로컬 세션/쿠키 정리
 * 3) 랜딩("/")으로 리다이렉트
 * 다른 사용자의 id 를 넘기는 경로는 아예 없다(RPC 자체가 인자를 받지 않음).
 */
export async function deleteAccountAction(): Promise<ActionResult<{ ok: true }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { error } = await supabase.rpc("delete_own_account");
  if (error) return { error: "회원탈퇴 처리 중 오류가 발생했습니다." };

  await supabase.auth.signOut();
  redirect("/");
}
