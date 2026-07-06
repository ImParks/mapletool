"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface SignupState {
  error: string | null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPassword(value: string): boolean {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /[0-9]/.test(value);
}

/**
 * Supabase Auth 회원가입. 닉네임은 `raw_user_meta_data ->> 'nickname'` 로 읽는
 * `handle_new_user` 트리거(supabase/migrations)와 계약을 맞추기 위해 반드시 `nickname` 키로
 * 넘긴다. 성공 시 `/main`(임시 자리표시 화면)으로 리다이렉트한다.
 */
export async function signupAction(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  const nickname = String(formData.get("nickname") ?? "").trim();
  const agree = formData.get("agree") === "on";

  if (!email || !isValidEmail(email)) {
    return { error: "올바른 이메일 주소를 입력해 주세요." };
  }
  if (!isValidPassword(password)) {
    return { error: "비밀번호는 영문 · 숫자 조합 8자 이상이어야 합니다." };
  }
  if (password !== passwordConfirm) {
    return { error: "비밀번호가 일치하지 않습니다." };
  }
  if (!agree) {
    return { error: "서비스 이용약관 및 개인정보 처리방침에 동의해 주세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: nickname ? { nickname } : undefined,
    },
  });

  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return { error: "이미 가입된 이메일입니다." };
    }
    if (error.code === "weak_password") {
      return { error: "비밀번호가 너무 약합니다. 다른 비밀번호를 입력해 주세요." };
    }
    return { error: "회원가입 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }

  // 참고: Supabase 프로젝트에서 "이메일 확인(Confirm email)" 설정이 켜져 있으면 signUp() 직후
  // session 이 없을 수 있다(사용자가 메일함에서 인증 링크를 눌러야 세션이 생성됨). 이번 단계
  // 설계 문서(#3 회원가입)는 별도의 "메일 확인 대기" 화면을 요구하지 않으므로 성공 시 바로
  // /main 으로 이동시킨다. 세션이 아직 없는 상태에서 /main 진입 시 처리(로그인 유도 등)는
  // 다음 단계(메인 화면 구현, 인증 가드 도입) 에서 다룰 미해결 사항이다.
  redirect("/main");
}
