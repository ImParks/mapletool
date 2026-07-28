/**
 * 인증 폼 공통 입력 검증. "use server" 파일은 async 함수만 export 할 수 있어(Next.js 제약)
 * 동기 검증 함수는 이렇게 별도 모듈에 두고 각 액션에서 import 한다.
 */

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * 비밀번호 규칙: 영문 + 숫자 조합 8자 이상. Supabase 쪽 최소 길이(config.toml
 * minimum_password_length = 6)보다 앱이 더 엄격하다 — 회원가입과 재설정에서 같은 규칙을
 * 써야 하므로 여기 한 곳에서만 정의한다.
 */
export function isValidPassword(value: string): boolean {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /[0-9]/.test(value);
}

/** 사용자에게 보여줄 비밀번호 규칙 안내 문구(회원가입/재설정 공용). */
export const PASSWORD_RULE_MESSAGE = "비밀번호는 영문 · 숫자 조합 8자 이상이어야 합니다.";
