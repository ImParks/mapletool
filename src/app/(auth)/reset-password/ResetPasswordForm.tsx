"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { safeFormAction } from "@/lib/safe-action";
import { PASSWORD_RULE_MESSAGE } from "@/lib/validation";
import { resetPasswordAction, type ResetPasswordState } from "./actions";

// "use server" 파일은 async 함수만 export 가능(Next.js 제약)이라, 초기 상태값은
// 이 클라이언트 컴포넌트에 둔다.
const initialResetPasswordState: ResetPasswordState = { error: null };

// 액션이 던진 예외가 화면 전체를 에러 페이지로 바꾸지 않게 폼 상태로 흡수한다.
const safeResetPasswordAction = safeFormAction<ResetPasswordState>(
  resetPasswordAction,
  (message) => ({ error: message }),
  "비밀번호 변경을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
);

export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState(safeResetPasswordAction, initialResetPasswordState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-lg bg-maple-danger-soft px-3 py-2 text-xs font-semibold text-maple-danger">
          {state.error}
        </p>
      )}

      <Input
        label="새 비밀번호"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="영문 · 숫자 조합 8자 이상"
        leadingIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
        helpText={PASSWORD_RULE_MESSAGE}
        required
      />
      <Input
        label="새 비밀번호 확인"
        name="passwordConfirm"
        type="password"
        autoComplete="new-password"
        placeholder="다시 한 번 입력"
        leadingIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
        required
      />

      <Button type="submit" variant="primary" block pending={isPending}>
        비밀번호 변경
      </Button>
    </form>
  );
}
