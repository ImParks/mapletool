"use client";

import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /** 다이얼로그 카드 최대 폭 클래스. 기본 440px(설정/확인 다이얼로그 기준). */
  widthClassName?: string;
}

/**
 * 최소 구현의 접근성 있는 모달(Dialog). scrim 클릭/ESC로 닫힘, role="dialog" + aria-modal.
 * 등장 애니메이션은 디자인 핸드오프의 페이드/라이즈를 그대로 따른다(프로토타입의 강제 무효화
 * 오버라이드는 프로토타입 뷰어 전용 땜빵이라 옮기지 않는다).
 */
export function Dialog({ open, title, description, onClose, children, widthClassName }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center px-4 py-8">
      <div
        aria-hidden="true"
        className="fixed inset-0 animate-maple-fade bg-maple-surface-scrim motion-reduce:animate-none"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "relative z-10 max-h-[calc(100vh-4rem)] w-full animate-maple-pop overflow-y-auto rounded-2xl border border-maple-line bg-maple-surface-overlay p-5 shadow-xl motion-reduce:animate-none",
          widthClassName ?? "max-w-[440px]"
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-extrabold text-maple-text-primary">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-maple-text-secondary">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-maple-text-muted transition-colors hover:bg-maple-surface-inset"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
