"use client";

import { useActionState, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import Link from "next/link";
import { Mail, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { safeFormAction } from "@/lib/safe-action";
import { loginAction, type LoginState } from "./actions";

const REMEMBER_EMAIL_KEY = "mapletool:rememberedEmail";
// "use server" 파일은 async 함수만 export 가능(Next.js 제약)이라, 초기 상태값은
// 이 클라이언트 컴포넌트에 둔다.
const initialLoginState: LoginState = { error: null };

// 액션이 던진 예외가 화면 전체를 에러 페이지로 바꾸지 않게 폼 상태로 흡수한다.
const safeLoginAction = safeFormAction<LoginState>(
  loginAction,
  (message) => ({ error: message }),
  "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
);

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(safeLoginAction, initialLoginState);
  const [rememberId, setRememberId] = useState(true);
  const [email, setEmail] = useState("");

  // "아이디 저장" 이 켜져 있으면 다음 로그인 시 이메일을 프리필한다.
  useEffect(() => {
    const saved = window.localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (saved) {
      setEmail(saved);
    }
  }, []);

  function handleSubmit(formData: FormData) {
    const submittedEmail = String(formData.get("email") ?? "").trim();
    if (rememberId && submittedEmail) {
      window.localStorage.setItem(REMEMBER_EMAIL_KEY, submittedEmail);
    } else {
      window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
    formAction(formData);
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-lg bg-maple-danger-soft px-3 py-2 text-xs font-semibold text-maple-danger">
          {state.error}
        </p>
      )}

      <Input
        label="이메일"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
        leadingIcon={<Mail className="h-4 w-4" aria-hidden="true" />}
        required
      />
      <Input
        label="비밀번호"
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="비밀번호"
        leadingIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
        required
      />

      <div className="-mt-0.5 flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={rememberId} onChange={setRememberId} ariaLabel="아이디 저장" />
          <span className="text-xs text-maple-text-secondary">아이디 저장</span>
        </label>
        <Link href="/find-password" className="text-xs font-bold text-maple-text-link">
          비밀번호 찾기
        </Link>
      </div>

      <Button type="submit" variant="primary" block pending={isPending}>
        로그인
      </Button>

      <div className="text-center text-[13px] text-maple-text-secondary">
        계정이 없으신가요?{" "}
        <Link href="/signup" className="font-extrabold text-maple-text-link">
          회원가입
        </Link>
      </div>
    </form>
  );
}
