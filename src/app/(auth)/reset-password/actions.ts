"use server";

import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { PASSWORD_RULE_MESSAGE, isValidPassword } from "@/lib/validation";

export interface ResetPasswordState {
  error: string | null;
}

// env 미설정 시 500 스택트레이스 대신 폼에 명확한 안내를 돌려준다(login/actions.ts 와 동일 방침).
const ENV_MISSING_ERROR =
  "서버에 Supabase 환경변수가 설정되지 않았습니다. .env(.env.local)의 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 값을 확인해 주세요.";

const SESSION_MISSING_ERROR =
  "재설정 링크가 만료되었거나 이미 사용되었습니다. 비밀번호 찾기를 다시 진행해 주세요.";

/**
 * 메일 링크로 만들어진 복구 세션을 이용해 비밀번호를 실제로 교체한다.
 *
 * 인증 수단은 폼 값이 아니라 **쿠키의 세션**이다(/auth/callback 이 심어둔다). 그래서 여기서
 * 사용자 id 나 이메일을 입력값으로 받지 않는다 — 받으면 남의 비밀번호를 바꿀 통로가 된다.
 * 성공하면 그 세션이 그대로 로그인 상태이므로 /main 으로 보낸다.
 */
export async function resetPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");

  if (!isValidPassword(password)) {
    return { error: PASSWORD_RULE_MESSAGE };
  }
  if (password !== passwordConfirm) {
    return { error: "비밀번호가 일치하지 않습니다." };
  }
  if (!isSupabaseConfigured()) {
    return { error: ENV_MISSING_ERROR };
  }

  // 외부 의존(Supabase) 구간만 감싼다 — redirect() 는 예외를 던져 동작하므로 try 밖에 둬야 한다.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 복구 세션이 없으면 updateUser 가 실패한다. 원인을 사용자 말로 먼저 걸러낸다.
    if (!user) {
      return { error: SESSION_MISSING_ERROR };
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      console.error("[reset-password] updateUser failed:", error);
      if (error.code === "weak_password") {
        return { error: "비밀번호가 너무 약합니다. 다른 비밀번호를 입력해 주세요." };
      }
      if (error.code === "same_password") {
        return { error: "기존과 다른 비밀번호를 입력해 주세요." };
      }
      if (error.status === 401 || error.status === 403) {
        return { error: SESSION_MISSING_ERROR };
      }
      return { error: "비밀번호 변경에 실패했습니다. 잠시 후 다시 시도해 주세요." };
    }
  } catch (error) {
    console.error("[reset-password] unexpected failure:", error);
    return { error: "비밀번호 변경을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  redirect("/main");
}
