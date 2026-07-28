"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * 현재 열려 있는 다이얼로그 스택(열린 순서). ESC 는 맨 위 다이얼로그 하나만 닫아야 하므로
 * (예: 설정 모달 위에 에러 모달이 떴을 때 둘 다 닫히면 안 된다) 모듈 스코프에서 공유한다.
 */
const OPEN_DIALOG_STACK: string[] = [];

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /** 다이얼로그 카드 최대 폭 클래스. 기본 440px(설정/확인 다이얼로그 기준). */
  widthClassName?: string;
  /**
   * 겹침 순서 클래스. 기본 z-[400](일반 모달). 에러/안내 모달처럼 "이미 열린 모달 위에" 떠야
   * 하는 경우에만 더 높은 값을 넘긴다(AlertDialog 참고).
   */
  zIndexClassName?: string;
}

/**
 * 최소 구현의 접근성 있는 모달(Dialog). scrim 클릭/ESC로 닫힘, role="dialog" + aria-modal.
 * 등장 애니메이션은 디자인 핸드오프의 페이드/라이즈를 그대로 따른다(프로토타입의 강제 무효화
 * 오버라이드는 프로토타입 뷰어 전용 땜빵이라 옮기지 않는다).
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  widthClassName,
  zIndexClassName,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const instanceId = useId();

  // onClose 는 호출부에서 인라인 화살표로 넘어오는 일이 많아 렌더마다 아이덴티티가 바뀐다.
  // 그때마다 아래 effect 가 재실행되면 스택 순서가 뒤엉키므로 ref 로 최신 값만 들고 있는다.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    OPEN_DIALOG_STACK.push(instanceId);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // 위에 다른 다이얼로그가 얹혀 있으면 그쪽이 먼저 닫힌다.
      if (OPEN_DIALOG_STACK[OPEN_DIALOG_STACK.length - 1] !== instanceId) return;
      onCloseRef.current();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      const index = OPEN_DIALOG_STACK.lastIndexOf(instanceId);
      if (index !== -1) OPEN_DIALOG_STACK.splice(index, 1);
    };
  }, [open, instanceId]);

  if (!open) return null;

  return (
    <div className={cn("fixed inset-0 flex items-center justify-center px-4 py-8", zIndexClassName ?? "z-[400]")}>
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
