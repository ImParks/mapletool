"use client";

import { ErrorBoundaryDialog } from "@/components/ErrorBoundaryDialog";
import "./globals.css";

/**
 * 루트 레이아웃 자체가 실패했을 때의 최후 boundary. 이 경우 RootLayout 이 렌더되지 않으므로
 * html/body 를 직접 그린다(Next.js 요구사항).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-maple-surface-app font-sans text-maple-text-primary antialiased">
        <ErrorBoundaryDialog
          error={error}
          message="앱을 불러오는 중 오류가 발생했습니다. 새로고침해도 계속된다면 잠시 후 다시 시도해 주세요."
          onRetry={reset}
        />
      </body>
    </html>
  );
}
