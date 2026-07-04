/**
 * 서버 액션 공통 반환 타입. 성공 페이로드 T 또는 사용자에게 보여줄 한국어 에러 메시지.
 * 사용처: `if ("error" in result) { ... }` 로 분기한다.
 * (여러 액션 파일에 같은 타입이 중복 정의되는 것을 막기 위한 공용 모듈 — 타입 전용이라
 *  "use server" 파일에서 import 해도 런타임 영향이 없다.)
 */
export type ActionResult<T> = T | { error: string };
