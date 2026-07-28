import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, readSupabaseEnv } from "./env";

/** /main, /admin(및 하위 경로)은 로그인해야 접근 가능. 보호 라우트가 늘면 여기에 추가한다. */
const PROTECTED_PATH_PREFIXES = ["/main", "/admin"];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

/** 인증 코드가 콜백이 아닌 곳에 떨어졌을 때 구제할 경로. */
const AUTH_CODE_FALLBACK_PATHS = new Set(["/", "/login"]);

/**
 * 메일 링크가 `/auth/callback` 이 아닌 곳으로 떨어진 경우를 구제한다.
 *
 * Supabase 는 redirectTo 가 Redirect URL 허용목록에 없으면 **에러 없이 Site URL 로 폴백**한다.
 * 그러면 사용자는 `<Site URL>/?code=...` 에 도착하고, 그 화면(랜딩/로그인)은 코드를 처리할 줄
 * 몰라 아무 일도 일어나지 않는다 — "링크를 눌렀는데 그냥 로그인 화면이 뜬다"는 증상.
 * 설정이 어긋나 있거나 예전에 발송된 링크가 남아 있어도 재설정이 되도록 여기서 콜백으로 넘긴다.
 */
function rescueMisroutedAuthCode(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (!AUTH_CODE_FALLBACK_PATHS.has(pathname)) return null;
  if (!searchParams.has("code") && !searchParams.has("token_hash")) return null;

  const callbackUrl = request.nextUrl.clone();
  callbackUrl.pathname = "/auth/callback";
  if (!callbackUrl.searchParams.has("next")) {
    callbackUrl.searchParams.set("next", "/reset-password");
  }
  return NextResponse.redirect(callbackUrl);
}

/**
 * 모든 요청에서 Supabase 세션 쿠키를 갱신한다.
 *
 * 미들웨어는 matcher 에 걸린 **모든 경로**에서 돌기 때문에, 여기서 예외가 나면 정적으로
 * 프리렌더된 랜딩/로그인 화면까지 전부 500 이 된다("Application error: a server-side
 * exception has occurred" 가 사이트 전역에 뜨는 형태). 그래서 아래 updateSession 은
 * 실패 시에도 절대 throw 하지 않고 안전한 응답으로 대체한다(fail-safe).
 */
export async function updateSession(request: NextRequest) {
  try {
    return await updateSessionUnsafe(request);
  } catch (error) {
    // 로그에 남겨 원인을 추적할 수 있게 하되(Vercel Functions 로그에서 이 접두어로 검색),
    // 사용자에게는 500 대신 정상 응답을 준다.
    console.error("[middleware] updateSession failed:", error);
    // 보호 라우트는 "세션을 확인할 수 없음"이므로 열어주지 않고 로그인으로 보낸다.
    if (isProtectedPath(request.nextUrl.pathname)) {
      return redirectToLogin(request);
    }
    return NextResponse.next({ request });
  }
}

async function updateSessionUnsafe(request: NextRequest) {
  const rescued = rescueMisroutedAuthCode(request);
  if (rescued) return rescued;

  let response = NextResponse.next({ request });

  // 값이 없거나 형태가 깨져 있으면(개행/따옴표 혼입 등) createServerClient 가 URL 파싱에서
  // 터진다. 그 전에 걸러 세션 갱신만 건너뛴다 — 화면은 각 페이지의 설정 안내가 담당.
  if (!isSupabaseConfigured()) {
    return response;
  }

  const { url, anonKey } = readSupabaseEnv();

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() 호출로 토큰 갱신 트리거
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 인증 가드. 이건 "로그인 여부"만 확인하는 1차 방어이고, /admin의 진짜 방어선(role='admin'
  // 확인)은 각 서버 컴포넌트/서버 액션 안에 있다(src/app/admin/page.tsx, boss-preset-actions.ts).
  if (isProtectedPath(request.nextUrl.pathname) && !user) {
    return redirectToLogin(request);
  }

  return response;
}
