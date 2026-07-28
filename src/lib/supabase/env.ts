/**
 * Supabase 환경변수 읽기/검증. server.ts(Node) 와 middleware.ts(Edge) 양쪽에서 쓰이므로
 * next/headers 같은 런타임 의존이 없는 별도 모듈로 둔다.
 */

/**
 * env 값을 공백/개행을 제거해 반환한다. 대시보드에서 값을 복사할 때 줄바꿈이나 따옴표가
 * 섞여 들어오는 사고가 흔하고, 그런 값은 `new URL()` 단계에서 예외로 터져 "설정 실수"가
 * "서버 500"으로 나타난다.
 */
export function readSupabaseEnv(): { url: string; anonKey: string } {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/^["']|["']$/g, ""),
    anonKey: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim().replace(/^["']|["']$/g, ""),
  };
}

/**
 * 환경변수가 "존재하고 실제로 쓸 수 있는 형태인지" 확인한다(설정 안내 화면 분기용).
 *
 * 존재 여부만 보던 예전 구현은 값이 깨져 있어도 통과시켰고, 그러면 곧바로 뒤따르는
 * createServerClient() 가 URL 파싱에서 예외를 던져 **화면 전체가 500**이 됐다. URL 형태까지
 * 여기서 검증해, 그런 경우에도 안내 화면으로 흘러가게 한다.
 */
export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = readSupabaseEnv();
  if (!url || !anonKey) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
