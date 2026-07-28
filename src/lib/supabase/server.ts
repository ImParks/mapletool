import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readSupabaseEnv } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = readSupabaseEnv();

  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component에서 호출된 경우 무시 (미들웨어가 갱신 담당)
          }
        },
      },
    }
  );
}

// 환경변수 검증은 Edge 런타임(middleware)에서도 필요해 ./env 로 옮겼다. 기존 import 경로
// (`@/lib/supabase/server`)를 유지하기 위해 여기서 다시 내보낸다.
export { isSupabaseConfigured } from "./env";
