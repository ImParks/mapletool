"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

interface ProgressOverlayProps {
  open: boolean;
  /** 굵게 표시할 한 줄(예: "API 호출중입니다"). */
  title: string;
  /** 보조 설명. 왜 기다려야 하는지 한 줄로. */
  description?: string;
  /** 완료 건수 / 전체 건수. total 이 0 이면 진행률 바 없이 스피너만 보여준다. */
  done: number;
  total: number;
}

/**
 * 화면 전체를 덮는 진행률 오버레이. 넥슨 캐릭터 워밍업처럼 "끝날 때까지 화면을 연결하면 안 되는"
 * 작업에 쓴다. Dialog 와 달리 닫기 수단이 없다(사용자가 중간에 끊으면 캐시가 반쯤 찬 상태로
 * 남으므로 의도적으로 막는다).
 *
 * z-index 는 일반 모달(Dialog, z-400)보다 위, 에러/안내 모달(AlertDialog, z-500)보다 아래다 —
 * 설정 모달 안에서 키를 등록해도 이 오버레이가 그 위에 덮이고, 워밍업이 끝난 뒤 뜨는 실패 안내
 * 모달은 다시 이 위에 뜬다.
 */
export function ProgressOverlay({ open, title, description, done, total }: ProgressOverlayProps) {
  if (!open) return null;

  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-[450] flex items-center justify-center px-4 py-8" role="status" aria-live="polite">
      <div
        aria-hidden="true"
        className="fixed inset-0 animate-maple-fade bg-maple-surface-scrim motion-reduce:animate-none"
      />
      <div className="relative z-10 w-full max-w-[360px] animate-maple-pop rounded-2xl border border-maple-line bg-maple-surface-overlay p-6 text-center shadow-xl motion-reduce:animate-none">
        <Loader2
          className="mx-auto h-8 w-8 animate-spin text-maple-orange motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p className="mt-4 text-sm font-extrabold text-maple-text-primary">{title}</p>
        {description && <p className="mt-1.5 text-xs leading-relaxed text-maple-text-secondary">{description}</p>}

        {total > 0 && (
          <>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-maple-surface-inset">
              <div
                className={cn("h-full rounded-full bg-maple-orange transition-all duration-280 ease-out")}
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2 text-xs font-semibold tabular-nums text-maple-text-muted">
              {total}명 중 {done}명
            </p>
          </>
        )}
      </div>
    </div>
  );
}
