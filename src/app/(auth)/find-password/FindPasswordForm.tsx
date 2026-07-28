"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Mail, Check } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { safeFormAction } from "@/lib/safe-action";
import { findPasswordAction, type FindPasswordState } from "./actions";

// "use server" 파일은 async 함수만 export 가능(Next.js 제약)이라, 초기 상태값은
// 이 클라이언트 컴포넌트에 둔다.
const initialFindPasswordState: FindPasswordState = { status: "idle", error: null };

// 액션이 던진 예외가 화면 전체를 에러 페이지로 바꾸지 않게 폼 상태로 흡수한다.
const safeFindPasswordAction = safeFormAction<FindPasswordState>(
  findPasswordAction,
  (message) => ({ status: "idle", error: message }),
  "메일 전송을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
);

export function FindPasswordForm() {
  const [state, formAction, isPending] = useActionState(safeFindPasswordAction, initialFindPasswordState);

  if (state.status === "sent") {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-maple-success-soft text-maple-success-text">
          <Check className="h-7 w-7" strokeWidth={2.6} aria-hidden="true" />
        </div>
        <div className="text-base font-extrabold text-maple-text-primary">메일을 보냈어요</div>
        <p className="max-w-[30ch] text-[13px] leading-relaxed text-maple-text-muted">
          받은 편지함에서 재설정 링크를 확인해 주세요.
        </p>
        <Link
          href="/login"
          className={cn(buttonClassName({ variant: "secondary", block: true }), "mt-1")}
        >
          로그인으로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        {state.error && (
          <p role="alert" className="rounded-lg bg-maple-danger-soft px-3 py-2 text-xs font-semibold text-maple-danger">
            {state.error}
          </p>
        )}
        <Input
          label="가입 이메일"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          leadingIcon={<Mail className="h-4 w-4" aria-hidden="true" />}
        />
        <Button type="submit" variant="primary" block pending={isPending}>
          재설정 링크 보내기
        </Button>
      </form>
      <div className="text-center">
        <Link href="/login" className="text-[13px] font-bold text-maple-text-link">
          로그인으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
