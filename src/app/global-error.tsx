"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * 루트 레이아웃 자체가 터졌을 때만 쓰이는 최후의 방어선. 이 컴포넌트는 layout.tsx 를
 * 대체하므로 <html>/<body> 를 직접 렌더해야 한다(Next.js 규약).
 *
 * 여기까지 온다는 건 앱 셸이 렌더되지 못했다는 뜻이라 공용 UI 컴포넌트에 의존하지 않고
 * 최소한의 마크업만 쓴다.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko">
      <body className="min-h-screen bg-maple-surface-app font-sans text-maple-text-primary antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 py-10 text-center">
          <h1 className="text-lg font-extrabold">문제가 발생했어요</h1>
          <p className="max-w-[32ch] text-sm text-maple-text-secondary">
            앱을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
          {error.digest && <p className="font-mono text-[11px] text-maple-text-muted">오류 코드: {error.digest}</p>}
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-maple-orange px-4 py-2.5 text-sm font-extrabold text-maple-text-onaccent"
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
