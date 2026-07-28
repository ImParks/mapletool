"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/** 관리자 화면의 마지막 방어선. (없으면 Next.js 기본 에러 화면이 그대로 노출된다.) */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 py-10 text-center">
      <h1 className="text-lg font-extrabold text-maple-text-primary">문제가 발생했어요</h1>
      <p className="max-w-[32ch] text-sm text-maple-text-secondary">
        관리자 화면을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
      </p>
      {error.digest && <p className="font-mono text-[11px] text-maple-text-muted">오류 코드: {error.digest}</p>}
      <div className="flex gap-2.5">
        <Button variant="primary" onClick={reset}>
          다시 시도
        </Button>
        <Link href="/main">
          <Button variant="secondary">메인으로</Button>
        </Link>
      </div>
    </div>
  );
}
