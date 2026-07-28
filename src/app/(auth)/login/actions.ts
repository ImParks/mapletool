"use server";

import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export interface LoginState {
  error: string | null;
}

// env 미설정 시 createClient 가 스택트레이스와 함께 500 을 던지는 대신, 폼에 명확한
// 한국어 안내를 돌려준다(.env 인코딩 문제 등 설정 실수를 빠르게 알아차릴 수 있게).
const ENV_MISSING_ERROR =
  "서버에 Supabase 환경변수가 설정되지 않았습니다. .env(.env.local)의 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 값을 확인해 주세요.";

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
  if (!isSupabaseConfigured()) {
    return { error: ENV_MISSING_ERROR };
  }

  // 외부 의존(Supabase) 구간만 감싼다 — redirect() 는 예외를 던져 동작하므로 try 밖에 둬야 한다.
  // 잡지 않으면 액션이 500 으로 끝나고 화면 전체가 에러 페이지로 교체된다.
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
    }

    // 관리자 페이지 "최근 접속"(admin_recent_access RPC)이 참조하는 값. RLS가 본인 update를
    // 이미 허용하므로 별도 권한 작업 없이 갱신 가능(supabase/README.md "앱 코드에서 주의할 점" 참고).
    // 실패해도 로그인 자체를 막을 이유는 없어 에러는 무시한다(통계 정확도에만 영향).
    await supabase.from("profiles").update({ last_access_at: new Date().toISOString() }).eq("id", data.user.id);
  } catch (error) {
    console.error("[login] unexpected failure:", error);
    return { error: "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }

  redirect("/main");
}
