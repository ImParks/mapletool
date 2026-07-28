import { headers } from "next/headers";

/**
 * 메일 링크(비밀번호 재설정 등)에 넣을 "이 앱의 공개 주소"를 정한다.
 *
 * 우선순위:
 *  1. `NEXT_PUBLIC_SITE_URL` — 명시 설정. 커스텀 도메인을 쓰거나, 프록시 뒤라 요청 헤더의
 *     호스트가 실제 공개 주소와 다를 때 이 값으로 고정한다.
 *  2. 요청의 `origin` 헤더 — 로컬(`http://localhost:3000`), Vercel 프로덕션, 프리뷰 배포까지
 *     각 환경에서 그대로 맞는 값이 들어온다. 서버 액션 POST 에는 브라우저가 항상 붙여준다.
 *  3. `host` 헤더 — origin 이 없는 경우의 마지막 수단.
 *
 * 보안 메모: 2·3번은 요청 헤더라 이론적으로는 조작될 수 있다(재설정 링크를 공격자 도메인으로
 * 향하게 하는 시도). 실질적 방어선은 **Supabase 쪽 Redirect URL 허용목록**이다 — 허용되지 않은
 * 주소는 거부되고 Site URL 로 폴백한다. 그 방어선을 신뢰하지 않으려면 1번(NEXT_PUBLIC_SITE_URL)을
 * 반드시 설정한다.
 */
export async function resolveSiteOrigin(): Promise<string> {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured && isAbsoluteHttpUrl(configured)) {
    return configured;
  }

  const headerList = await headers();

  const origin = headerList.get("origin");
  if (origin && isAbsoluteHttpUrl(origin)) {
    return origin.replace(/\/+$/, "");
  }

  const host = headerList.get("host");
  if (host) {
    // 로컬 개발 외에는 항상 https 다. host 만 있는 상황에서 프로토콜을 알 방법이 없어
    // 호스트 이름으로 판단한다.
    const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    return `${isLocal ? "http" : "https"}://${host}`;
  }

  // 여기까지 오면 링크를 만들 수 없다. 호출부가 사용자에게 안내할 수 있도록 빈 문자열 대신
  // 예외로 알린다(조용히 깨진 링크를 메일로 보내는 것보다 낫다).
  throw new Error("사이트 주소를 결정할 수 없습니다. NEXT_PUBLIC_SITE_URL 을 설정해 주세요.");
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
