"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";

export type AlertTone = "error" | "success" | "info";

const TONE_ICON = {
  error: AlertTriangle,
  success: CheckCircle2,
  info: Info,
} as const;

const TONE_BADGE_CLASS: Record<AlertTone, string> = {
  error: "bg-maple-danger-soft text-maple-danger",
  success: "bg-maple-success-soft text-maple-success-text",
  info: "bg-maple-surface-inset text-maple-text-secondary",
};

export const TONE_DEFAULT_TITLE: Record<AlertTone, string> = {
  error: "문제가 발생했어요",
  success: "완료되었어요",
  info: "알려드려요",
};

interface AlertDialogProps {
  open: boolean;
  tone: AlertTone;
  title: string;
  message: string;
  onClose: () => void;
  confirmLabel?: string;
  /** "새로고침" 같은 복구 동작을 추가로 제공할 때. 없으면 확인 버튼만 노출한다. */
  secondaryAction?: { label: string; onClick: () => void };
}

/**
 * 에러/안내를 "화면 레이아웃을 바꾸지 않고" 모달로 띄우는 공용 컴포넌트.
 * 인라인 배너(role="alert")로 안내하면 본문이 밀려 UI가 달라 보이기 때문에,
 * 사용자에게 알려야 하는 결과는 전부 이 다이얼로그를 통해 보여준다.
 */
export function AlertDialog({
  open,
  tone,
  title,
  message,
  onClose,
  confirmLabel,
  secondaryAction,
}: AlertDialogProps) {
  const Icon = TONE_ICON[tone];

  return (
    <Dialog open={open} title={title} onClose={onClose} widthClassName="max-w-[420px]">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-9 w-9 flex-none items-center justify-center rounded-full",
              TONE_BADGE_CLASS[tone]
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <p
            role={tone === "error" ? "alert" : "status"}
            className="min-w-0 flex-1 whitespace-pre-line pt-[7px] text-sm leading-relaxed text-maple-text-secondary"
          >
            {message}
          </p>
        </div>
        <div className="flex justify-end gap-2.5">
          {secondaryAction && (
            <Button variant="secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {confirmLabel ?? "확인"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
