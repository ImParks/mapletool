"use server";

import { headers } from "next/headers";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isValidEmail } from "@/lib/validation";

export interface FindPasswordState {
  status: "idle" | "sent";
  error: string | null;
}

// env 미설정 시 500 스택트레이스 대신 폼에 명확한 안내를 돌려준다(login/actions.ts 와 동일 방침).
const ENV_MISSING_ERROR =
  "서버에 Supabase 환경변수가 설정되지 않았습니다. .env(.env.local)의 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 값을 확인해 주세요.";

/**
 * 비밀번호 재설정 메일 발송.
 *
 * 메일 링크의 최종 목적지는 `/auth/callback?next=/reset-password` 다 — 콜백이 일회용 코드를
 * 세션 쿠키로 교환하고, `/reset-password` 가 그 세션으로 새 비밀번호를 저장한다.
 * 주의: PKCE 흐름이라 **메일을 요청한 것과 같은 브라우저**에서 링크를 열어야 한다
 * (code verifier 쿠키가 그 브라우저에만 있다). 다른 브라우저에서 열면 재설정 화면이
 * "링크가 만료되었어요" 안내로 대체된다.
 */
export async function findPasswordAction(
  _prevState: FindPasswordState,
  formData: FormData
): Promise<FindPasswordState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !isValidEmail(email)) {
    return { status: "idle", error: "올바른 이메일 주소를 입력해 주세요." };
  }
  if (!isSupabaseConfigured()) {
    return { status: "idle", error: ENV_MISSING_ERROR };
  }

  // 여기서부터는 외부(Supabase/SMTP)에 의존하므로 예외가 날 수 있다. 잡지 않으면 서버 액션이
  // 500 으로 끝나고, 클라이언트에서는 화면 전체가 "Application error ... Digest: xxx" 로
  // 교체된다(사용자에게는 원인이 전혀 보이지 않는다). 로그에는 남기고 폼에는 안내를 돌려준다.
  try {
    const supabase = await createClient();
    const headerList = await headers();
    const origin = headerList.get("origin") ?? `https://${headerList.get("host") ?? ""}`;

    // 메일 링크는 /auth/callback 으로 보낸다 — 거기서 일회용 코드를 세션 쿠키로 교환한 뒤
    // ?next 의 화면으로 넘긴다. (예전에는 /login 으로 보내서, 링크를 눌러도 재설정 화면이
    // 나오지 않고 그냥 로그인 폼이 떴다.)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=%2Freset-password`,
    });

    if (error) {
      // 이 경로로 가장 자주 오는 원인은 메일 발송 한도 초과다(Supabase 내장 SMTP는 시간당
      // 발송량이 매우 낮다 — DEPLOY.md "남은 과제" 참고). 상태 코드로 구분해 안내를 달리한다.
      console.error("[find-password] resetPasswordForEmail failed:", error);
      if (error.status === 429) {
        return {
          status: "idle",
          error: "메일 발송 한도를 초과했습니다. 잠시 후(약 1시간) 다시 시도해 주세요.",
        };
      }
      return { status: "idle", error: "메일 전송에 실패했습니다. 잠시 후 다시 시도해 주세요." };
    }

    return { status: "sent", error: null };
  } catch (error) {
    console.error("[find-password] unexpected failure:", error);
    return {
      status: "idle",
      error: "메일 전송을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}
