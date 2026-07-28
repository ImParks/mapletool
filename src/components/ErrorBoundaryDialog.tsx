"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ErrorBoundaryDialogProps {
  /** 콘솔에 남길 원본 에러(사용자에게는 노출하지 않는다). */
  error?: Error & { digest?: string };
  title?: string;
  message?: string;
  /** Next.js error boundary 의 reset. 세그먼트를 다시 렌더한다. */
  onRetry?: () => void;
}

/**
 * 라우트 error boundary 전용 화면. React 가 세그먼트 UI를 이미 언마운트한 뒤라
 * 기존 화면 위에 진짜 모달을 얹을 수는 없지만, scrim + 다이얼로그 카드로 렌더해
 * "완전히 다른 페이지로 바뀐 것"이 아니라 "모달이 떴다"로 읽히게 한다.
 * (에러 다이얼로그의 시각 사양은 ui/Dialog 와 동일하게 맞춘다.)
 */
export function ErrorBoundaryDialog({
  error,
  title = "문제가 발생했어요",
  message = "화면을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  onRetry,
}: ErrorBoundaryDialogProps) {
  useEffect(() => {
    if (error) console.error(error);
  }, [error]);

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center px-4 py-8">
      <div aria-hidden="true" className="fixed inset-0 bg-maple-surface-scrim" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-boundary-title"
        aria-describedby="error-boundary-message"
        className="relative z-10 w-full max-w-[420px] animate-maple-pop rounded-2xl border border-maple-line bg-maple-surface-overlay p-5 shadow-xl motion-reduce:animate-none"
      >
        <h2 id="error-boundary-title" className="mb-4 text-lg font-extrabold text-maple-text-primary">
          {title}
        </h2>
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-maple-danger-soft text-maple-danger">
              <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <p
              id="error-boundary-message"
              className="min-w-0 flex-1 pt-[7px] text-sm leading-relaxed text-maple-text-secondary"
            >
              {message}
            </p>
          </div>
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => window.location.reload()}>
              새로고침
            </Button>
            {onRetry && (
              <Button variant="primary" onClick={onRetry}>
                다시 시도
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
