"use client";

import { ErrorBoundaryDialog } from "@/components/ErrorBoundaryDialog";

/**
 * 하위 세그먼트에 자체 error.tsx 가 없는 경로(로그인/회원가입 등)를 덮는 기본 error boundary.
 * 이게 없으면 Next.js 기본 오류 화면으로 넘어가 UI가 통째로 달라 보인다.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBoundaryDialog error={error} onRetry={reset} />;
}
