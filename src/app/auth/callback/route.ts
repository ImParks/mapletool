import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * 메일 링크(비밀번호 재설정 등)가 최종적으로 도착하는 콜백. Supabase 가 붙여주는 일회용
 * 코드를 세션 쿠키로 교환한 뒤 목적지 화면으로 보낸다.
 *
 * 두 가지 링크 형태를 모두 받는다:
 *  - `?code=...`          PKCE 흐름(@supabase/ssr 서버 클라이언트의 기본). 쿠키에 저장된
 *                         code verifier 와 함께 exchangeCodeForSession 으로 교환한다.
 *  - `?token_hash=&type=` Supabase 권장 메일 템플릿({{ .TokenHash }})을 쓰는 경우.
 *
 * 실패(만료·이미 사용·다른 브라우저에서 클릭)해도 500 을 내지 않고 목적지에 error 파라미터를
 * 붙여 보내, 화면에서 "링크가 만료되었어요 → 다시 요청" 을 안내하게 한다.
 */

/** 오픈 리다이렉트 방지: 같은 사이트의 절대 경로만 허용한다. */
function sanitizeNext(value: string | null): string {
  if (!value) return "/reset-password";
  if (!value.startsWith("/") || value.startsWith("//")) return "/reset-password";
  return value;
}

function withError(origin: string, next: string, reason: string): NextResponse {
  const url = new URL(next, origin);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = sanitizeNext(searchParams.get("next"));

  if (!isSupabaseConfigured()) {
    return withError(origin, next, "config");
  }

  // Supabase 가 검증에 실패하면 코드 대신 error 파라미터를 붙여 보낸다(만료된 링크 등).
  const providerError = searchParams.get("error") ?? searchParams.get("error_code");
  if (providerError) {
    console.error("[auth/callback] provider returned error:", providerError, searchParams.get("error_description"));
    return withError(origin, next, "link_invalid");
  }

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (!code && !tokenHash) {
    return withError(origin, next, "link_invalid");
  }

  try {
    const supabase = await createClient();

    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type ?? "recovery" });

    if (error) {
      console.error("[auth/callback] session exchange failed:", error);
      return withError(origin, next, "link_invalid");
    }
  } catch (error) {
    console.error("[auth/callback] unexpected failure:", error);
    return withError(origin, next, "link_invalid");
  }

  return NextResponse.redirect(new URL(next, origin));
}
