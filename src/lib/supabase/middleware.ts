import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** 모든 요청에서 Supabase 세션 쿠키를 갱신한다. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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

  // 인증 가드: /main, /admin(및 하위 경로)은 로그인해야 접근 가능. 보호 라우트가 늘면 이 배열에
  // 추가한다. 이건 "로그인 여부"만 확인하는 1차 방어이고, /admin의 진짜 방어선(role='admin' 확인)은
  // 각 서버 컴포넌트/서버 액션 안에 있다(src/app/admin/page.tsx, boss-preset-actions.ts).
  const protectedPathPrefixes = ["/main", "/admin"];
  const pathname = request.nextUrl.pathname;
  const isProtectedRoute = protectedPathPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtectedRoute && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
