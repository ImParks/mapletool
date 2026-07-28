"use client";

import { ErrorBoundaryDialog } from "@/components/ErrorBoundaryDialog";

export default function MainError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorBoundaryDialog
      error={error}
      message="메인 화면을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
      onRetry={reset}
    />
  );
}
