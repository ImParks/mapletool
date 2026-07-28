"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

interface ErrorDialogProps {
  /** 표시할 에러 메시지. null 이면 열리지 않는다. */
  message: string | null;
  onClose: () => void;
  /** "다시 시도" 버튼을 노출하고 싶을 때. 누르면 onClose 후 이 콜백이 실행된다. */
  onRetry?: () => void;
  title?: string;
}

/**
 * 앱 공통 에러 모달.
 *
 * 설정/보스편집 같은 일반 모달(z-400) **위에** 떠야 하므로 z-500 을 쓴다. 예전에는 에러를
 * 본문 상단 인라인 배너로만 그려서, 모달을 열어둔 채 실패하면 배너가 스크림 뒤에 가려
 * 사용자 눈에는 "아무 일도 안 일어남"으로 보였다.
 */
export function ErrorDialog({ message, onClose, onRetry, title }: ErrorDialogProps) {
  return (
    <Dialog
      open={message !== null}
      title={title ?? "문제가 발생했어요"}
      onClose={onClose}
      widthClassName="max-w-[420px]"
      zIndexClassName="z-[500]"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl bg-maple-danger-soft px-3.5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-maple-danger" aria-hidden="true" />
          <p role="alert" className="text-[13px] font-semibold leading-relaxed text-maple-danger">
            {message}
          </p>
        </div>
        <div className="flex justify-end gap-2.5">
          {onRetry && (
            <Button
              variant="secondary"
              onClick={() => {
                onClose();
                onRetry();
              }}
            >
              다시 시도
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            확인
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
