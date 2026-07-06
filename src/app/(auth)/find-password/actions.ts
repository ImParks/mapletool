"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface FindPasswordState {
  status: "idle" | "sent";
  error: string | null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * 비밀번호 재설정 메일 발송. 재설정 링크가 이동할 "새 비밀번호 입력" 콜백 화면은 이번 단계
 * 범위 밖(설계 문서에도 없음)이라 아직 없다 — 우선 로그인 화면으로 리다이렉트하도록 설정해
 * 두고, 콜백 라우트는 다음 단계에서 별도로 구현해야 한다.
 */
export async function findPasswordAction(
  _prevState: FindPasswordState,
  formData: FormData
): Promise<FindPasswordState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !isValidEmail(email)) {
    return { status: "idle", error: "올바른 이메일 주소를 입력해 주세요." };
  }

  const supabase = await createClient();
  const headerList = await headers();
  const origin = headerList.get("origin") ?? `https://${headerList.get("host") ?? ""}`;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // TODO: 다음 단계에서 실제 "새 비밀번호 입력" 콜백 라우트가 생기면 그 경로로 교체.
    redirectTo: `${origin}/login`,
  });

  if (error) {
    return { status: "idle", error: "메일 전송에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }

  return { status: "sent", error: null };
}
