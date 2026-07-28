"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * 인증 화면(랜딩/로그인/가입/비밀번호 찾기)의 마지막 방어선.
 *
 * 정상 경로의 실패(이메일/비밀번호 오류, 환경변수 미설정 등)는 각 폼이 `state.error` 로
 * 화면 안에서 안내한다. 여기까지 오는 건 그 밖의 예기치 못한 예외뿐이며, 그 경우에도
 * Next.js 기본 에러 화면 대신 앱 디자인에 맞는 안내를 보여준다.
 */
export default function AuthError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 py-10 text-center">
      <h1 className="text-lg font-extrabold text-maple-text-primary">문제가 발생했어요</h1>
      <p className="max-w-[32ch] text-sm text-maple-text-secondary">
        잠시 후 다시 시도해 주세요. 문제가 계속되면 새로고침 후 다시 로그인해 주세요.
      </p>
      {error.digest && <p className="font-mono text-[11px] text-maple-text-muted">오류 코드: {error.digest}</p>}
      <div className="flex gap-2.5">
        <Button variant="primary" onClick={reset}>
          다시 시도
        </Button>
        <Link href="/login">
          <Button variant="secondary">로그인 화면으로</Button>
        </Link>
      </div>
    </div>
  );
}
