"use client";

import { useActionState, useState } from "react";
import { Mail, Lock, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { signupAction, type SignupState } from "./actions";

// "use server" 파일은 async 함수만 export 가능(Next.js 제약)이라, 초기 상태값은
// 이 클라이언트 컴포넌트에 둔다.
const initialSignupState: SignupState = { error: null };

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(signupAction, initialSignupState);
  const [agree, setAgree] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-3.5">
      {state.error && (
        <p role="alert" className="rounded-lg bg-maple-danger-soft px-3 py-2 text-xs font-semibold text-maple-danger">
          {state.error}
        </p>
      )}

      <Input
        label="이메일"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        leadingIcon={<Mail className="h-4 w-4" aria-hidden="true" />}
      />
      <Input
        label="비밀번호"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        placeholder="8자 이상"
        helpText="영문 · 숫자 조합 8자 이상"
        leadingIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
      />
      <Input
        label="비밀번호 확인"
        name="passwordConfirm"
        type="password"
        required
        autoComplete="new-password"
        placeholder="비밀번호 재입력"
        leadingIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
      />
      <Input
        label="닉네임"
        name="nickname"
        autoComplete="nickname"
        placeholder="표시할 이름"
        leadingIcon={<User className="h-4 w-4" aria-hidden="true" />}
      />

      <label className="mt-0.5 flex cursor-pointer items-center gap-2.5">
        <Checkbox checked={agree} onChange={setAgree} ariaLabel="약관 동의" name="agree" />
        <span className="text-[13px] text-maple-text-secondary">서비스 이용약관 및 개인정보 처리방침에 동의합니다.</span>
      </label>

      <Button type="submit" variant="primary" block disabled={!agree} pending={isPending}>
        가입하기
      </Button>
    </form>
  );
}
