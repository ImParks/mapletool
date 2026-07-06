"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface LoginState {
  error: string | null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * 이메일/비밀번호로 Supabase Auth 로그인을 시도한다. 성공 시 세션 쿠키가 설정되고
 * 접속 시각(profiles.last_access_at)을 갱신한 뒤 `/main`으로 리다이렉트한다.
 */
export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !isValidEmail(email)) {
    return { error: "올바른 이메일 주소를 입력해 주세요." };
  }
  if (!password) {
    return { error: "비밀번호를 입력해 주세요." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  // 관리자 페이지 "최근 접속"(admin_recent_access RPC)이 참조하는 값. RLS가 본인 update를
  // 이미 허용하므로 별도 권한 작업 없이 갱신 가능(supabase/README.md "앱 코드에서 주의할 점" 참고).
  // 실패해도 로그인 자체를 막을 이유는 없어 에러는 무시한다(통계 정확도에만 영향).
  await supabase.from("profiles").update({ last_access_at: new Date().toISOString() }).eq("id", data.user.id);

  redirect("/main");
}
